from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import Event
from time import monotonic, sleep

from fastapi.testclient import TestClient
from pypdf import PageObject
from pytest import MonkeyPatch, fixture, mark
from sqlalchemy import Engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from backend.app import config, database
from backend.app.init_db import init_db
from backend.app.main import app
from backend.app.models.document import Document
from backend.app.models.document_processing import DocumentProcessing
from backend.app.models.note import Note
from backend.app.models.page import Page
from backend.app.models.subject import Subject
from backend.app.repositories import page as page_repository
from backend.app.services import deletion, document_processing, documents
from backend.app.services.text_extraction import read_pdf_page_results
from backend.tests.pdf_samples import build_pdf, multi_page_pdf, stream_object, text_pdf


@fixture
def engine(temp_database_engine: Engine, monkeypatch: MonkeyPatch) -> Engine:
    init_db(temp_database_engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=temp_database_engine))
    return temp_database_engine


def upload(engine: Engine, data: bytes) -> Document:
    with Session(engine, expire_on_commit=False) as session:
        subject = Subject(name="운영체제")
        session.add(subject)
        session.commit()
        return documents.upload_document(
            session, subject_id=subject.id, week_number=1, filename="1.pdf",
            upload_dir=config.UPLOAD_DIR, max_size_bytes=1024 * 1024, file=BytesIO(data),
        )


def wait_for_status(client: TestClient, url: str, status: str) -> dict:
    deadline = monotonic() + 5
    while True:
        response = client.get(url)
        assert response.status_code == 200
        body = response.json()
        if body["status"] == status or monotonic() >= deadline:
            assert body["status"] == status, body
            return body
        sleep(0.02)


@mark.parametrize(
    ("content", "expected"),
    [
        (b"BT /F1 12 Tf (Native text) Tj ET", "text"),
        (b"q 612 0 0 792 0 0 cm /Im1 Do Q", "image"),
        (b"q 612 0 0 792 0 0 cm /Im1 Do Q BT /F1 12 Tf (Caption) Tj ET", "mixed"),
        (b"q BI /W 1 /H 1 /CS /G /BPC 8 ID \xff EI Q", "image"),
        (b"", "blank"),
        (b"BT /F1 12 Tf (   ) Tj ET", "blank"),
        (b"10 10 500 500 re f", "unknown"),
        (b"q /Fm1 Do Q", "unknown"),
    ],
)
def test_classifies_drawn_content_without_decoding_image_pixels(
    tmp_path: Path, content: bytes, expected: str
) -> None:
    pdf = build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R /Fm1 7 0 R >> >> >>",
        stream_object(b"", content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        stream_object(b"/Type /XObject /Subtype /Image /Width 1 /Height 1 "
                      b"/ColorSpace /DeviceGray /BitsPerComponent 8", b"\xff"),
        stream_object(b"/Type /XObject /Subtype /Form /BBox [0 0 1 1]", b"0 0 1 1 re f"),
    ])
    path = tmp_path / "page.pdf"
    path.write_bytes(pdf)
    assert [kind for _, kind in read_pdf_page_results(path)] == [expected]


def test_upload_worker_and_status_api(engine: Engine, monkeypatch: MonkeyPatch) -> None:
    started = Event()
    release = Event()

    def wait_before_extraction(path: Path):
        started.set()
        assert release.wait(10), "worker was not released"
        return read_pdf_page_results(path)

    monkeypatch.setattr(document_processing, "read_pdf_page_results", wait_before_extraction)
    data = multi_page_pdf(["Alpha", None, "", "Beta"])
    with TestClient(app) as client:
        try:
            subject = client.post("/subjects", json={"name": "운영체제"}).json()
            upload_args = {
                "data": {"subject_id": subject["id"], "week_number": 1},
                "files": {"file": ("1.pdf", data, "application/pdf")},
            }
            created = client.post("/documents", **upload_args)
            assert created.status_code == 201
            document_id = created.json()["id"]
            url = f"/documents/{document_id}/processing"
            assert started.wait(5)
            assert client.get(url).json() == {
                "document_id": document_id, "status": "processing", "error_code": None,
                "page_kinds": None,
            }
            second = client.post("/documents", **upload_args).json()["id"]
            second_url = f"/documents/{second}/processing"
            assert client.get(second_url).json()["status"] == "pending"
            assert client.post(f"{url}/retry").status_code == 409
            assert client.post(f"{second_url}/retry").status_code == 409
            original = client.get(f"/documents/{document_id}/file", headers={"Range": "bytes=0-7"})
            assert (original.status_code, original.content) == (206, data[:8])
            assert client.get(f"/documents/{document_id}").json() == created.json()
        finally:
            release.set()

        assert wait_for_status(client, url, "completed")["page_kinds"] == [
            "text", "image", "blank", "text",
        ]
        wait_for_status(client, second_url, "completed")
        assert client.post(f"{url}/retry").status_code == 409
        assert client.get("/documents/999/processing").status_code == 404
        assert client.post("/documents/999/processing/retry").status_code == 404
        assert client.get("/documents/0/processing").status_code == 422
        assert client.post("/documents/0/processing/retry").status_code == 422
        assert client.delete(f"/documents/{document_id}").status_code == 204
        assert client.get(url).status_code == 404

    with Session(engine) as session:
        pages = page_repository.list_pages_by_document(session, second)
        assert [(page.page_number, page.text) for page in pages] == [
            (1, "Alpha"), (2, ""), (3, ""), (4, "Beta"),
        ]


@mark.parametrize("failure", ["missing", "corrupt", "second_page", "db_write"])
def test_processing_failure_rolls_back_and_only_one_retry_is_accepted(
    engine: Engine, monkeypatch: MonkeyPatch, failure: str
) -> None:
    data = multi_page_pdf(["Alpha", "Beta"])
    document = upload(engine, data)
    url = f"/documents/{document.id}/processing"
    path = config.UPLOAD_DIR / document.stored_name
    with Session(engine) as session, session.begin():
        existing = page_repository.create_page(session, document_id=document.id, page_number=1,
                                               text="Previously committed")
        existing_id = existing.id

    real_extract = PageObject.extract_text
    real_save = page_repository.save_page
    extracted = 0

    def fail_second_page(page: PageObject, *args, **kwargs):
        nonlocal extracted
        extracted += 1
        if extracted == 2:
            raise ValueError("could not read second page")
        return real_extract(page, *args, **kwargs)

    def fail_after_write(*args, **kwargs):
        real_save(*args, **kwargs)
        raise RuntimeError("write failed after flush")

    with monkeypatch.context() as patch:
        if failure == "missing":
            path.unlink()
        elif failure == "corrupt":
            path.write_bytes(b"not a PDF")
        elif failure == "second_page":
            patch.setattr(PageObject, "extract_text", fail_second_page)
        else:
            patch.setattr(page_repository, "save_page", fail_after_write)
        with ThreadPoolExecutor(max_workers=2) as pool:
            claimed = list(pool.map(document_processing.claim_next_document, [engine, engine]))
        (job,) = [job for job in claimed if job is not None]
        document_processing.process_document(engine, job, config.UPLOAD_DIR)

    expected_error = {"missing": "original_missing", "db_write": "processing_error"}.get(
        failure, "invalid_pdf"
    )
    with Session(engine) as session:
        job = session.get(DocumentProcessing, document.id)
        assert (job.status, job.error_code, job.page_kinds) == ("failed", expected_error, None)
        (page,) = page_repository.list_pages_by_document(session, document.id)
        assert (page.id, page.text) == (existing_id, "Previously committed")

    path.write_bytes(data)
    # Lifespan을 실행하기 전 두 HTTP 요청이 같은 실패 상태를 재등록하도록 경합시킨다.
    with ThreadPoolExecutor(max_workers=2) as pool:
        def retry(_number: int):
            return TestClient(app).post(f"{url}/retry")

        responses = list(pool.map(retry, range(2)))
    assert sorted(response.status_code for response in responses) == [202, 409]
    assert next(response.json() for response in responses if response.status_code == 202) == {
        "document_id": document.id, "status": "pending", "error_code": None, "page_kinds": None,
    }

    with TestClient(app) as client:
        assert wait_for_status(client, url, "completed")["page_kinds"] == ["text", "text"]
    with Session(engine) as session:
        first, second = page_repository.list_pages_by_document(session, document.id)
        assert (first.id, first.text, second.text) == (existing_id, "Previously committed", "Beta")


def test_startup_recovers_interrupted_job_and_runs_pending_jobs(engine: Engine) -> None:
    interrupted = upload(engine, text_pdf("Interrupted"))
    pending = upload(engine, text_pdf("Pending"))
    assert document_processing.claim_next_document(engine).id == interrupted.id
    engine.dispose()
    init_db(engine)

    with TestClient(app) as client:
        pending_url = f"/documents/{pending.id}/processing"
        failed_url = f"/documents/{interrupted.id}/processing"
        assert wait_for_status(client, pending_url, "completed")["page_kinds"] == ["text"]
        assert client.get(failed_url).json()["error_code"] == "interrupted"
        assert client.get(f"/documents/{interrupted.id}/file").status_code == 200
        assert client.post(f"{failed_url}/retry").status_code == 202
        wait_for_status(client, failed_url, "completed")


def test_stale_work_does_not_write_to_reused_document_id(engine: Engine) -> None:
    old = upload(engine, text_pdf("Old"))
    claimed_old = document_processing.claim_next_document(engine)
    original_results = read_pdf_page_results(config.UPLOAD_DIR / old.stored_name)
    with Session(engine) as session:
        deletion.delete_document(session, old.id, config.UPLOAD_DIR)
        assert session.get(DocumentProcessing, old.id) is None

    new = upload(engine, text_pdf("New"))
    assert old.id == new.id
    claimed_new = document_processing.claim_next_document(engine)
    document_processing._finish_processing(engine, claimed_old, original_results)
    with Session(engine) as session:
        assert session.get(DocumentProcessing, new.id).status == "processing"
        assert page_repository.list_pages_by_document(session, new.id) == []
    document_processing.process_document(engine, claimed_new, config.UPLOAD_DIR)
    with Session(engine) as session:
        assert page_repository.get_page(session, new.id, 1).text == "New"


def test_init_db_adds_jobs_to_old_schema_without_replacing_data(temp_database_engine: Engine) -> None:
    engine = temp_database_engine
    database.Base.metadata.create_all(
        engine, tables=[Subject.__table__, Document.__table__, Page.__table__, Note.__table__]
    )
    assert "document_processing" not in inspect(engine).get_table_names()
    with Session(engine) as session, session.begin():
        subject = Subject(name="자료구조")
        session.add(subject)
        session.flush()
        document = Document(subject_id=subject.id, filename="legacy.pdf", stored_name="old.pdf",
                            file_size_bytes=40, week_number=1, page_count=None)
        session.add(document)
        session.flush()
        document_id = document.id
        page_repository.create_page(session, document_id=document_id, page_number=1, text="기존 텍스트")
        session.add(Note(document_id=document_id, page_number=1, title="기존 메모"))
    init_db(engine)
    init_db(engine)
    with Session(engine) as session:
        assert session.get(DocumentProcessing, document_id).status == "pending"
        assert page_repository.get_page(session, document_id, 1).text == "기존 텍스트"
        assert session.query(Note).one().title == "기존 메모"
        assert session.get(Document, document_id).stored_name == "old.pdf"
