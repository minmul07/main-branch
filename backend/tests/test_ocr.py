"""스캔 PDF OCR(#31)의 인식·처리 흐름·실패·재시도·DB 업그레이드 검증."""

import shutil
import subprocess
from io import BytesIO
from time import monotonic, sleep

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from pytest import MonkeyPatch, fixture, mark, raises, skip
from sqlalchemy import Engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app import config, database
from backend.app.init_db import init_db
from backend.app.main import app
from backend.app.models.document import Document
from backend.app.models.document_processing import DocumentProcessing
from backend.app.models.page import Page
from backend.app.models.subject import Subject
from backend.app.repositories import page as page_repository
from backend.app.services import document_processing, documents, ocr
from backend.tests.pdf_samples import build_pdf, multi_page_pdf, stream_object

# conftest의 fake_ocr가 모듈 속성을 바꾸기 전에 실제 함수를 잡아 둔다.
real_recognize_pages = ocr.recognize_pages


@fixture
def engine(temp_database_engine: Engine, monkeypatch: MonkeyPatch) -> Engine:
    init_db(temp_database_engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=temp_database_engine))
    return temp_database_engine


@fixture
def require_tesseract() -> None:
    try:
        ocr._find_tesseract()
    except ocr.OcrUnavailableError as error:
        skip(f"tesseract를 쓸 수 없음: {error}")


def upload(engine: Engine, data: bytes) -> Document:
    with Session(engine, expire_on_commit=False) as session:
        subject = Subject(name="운영체제")
        session.add(subject)
        session.commit()
        return documents.upload_document(
            session, subject_id=subject.id, week_number=1, filename="scan.pdf",
            upload_dir=config.UPLOAD_DIR, max_size_bytes=10 * 1024 * 1024, file=BytesIO(data),
        )


def process_next(engine: Engine) -> None:
    claimed = document_processing.claim_next_document(engine)
    assert claimed is not None
    document_processing.process_document(engine, claimed, config.UPLOAD_DIR)


def job_state(engine: Engine, document_id: int) -> tuple[str, str | None]:
    with Session(engine) as session:
        job = session.get(DocumentProcessing, document_id)
        return job.status, job.error_code


def page_state(engine: Engine, document_id: int) -> list[tuple[int, str | None, str | None]]:
    with Session(engine) as session:
        pages = page_repository.list_pages_by_document(session, document_id)
        return [(page.page_number, page.text, page.ocr_text) for page in pages]


def wait_until_finished(client: TestClient, url: str, timeout: float = 10) -> dict:
    deadline = monotonic() + timeout
    while True:
        body = client.get(url).json()
        if body["status"] in ("completed", "failed") or monotonic() >= deadline:
            return body
        sleep(0.02)


def scanned_text_pdf(lines: list[str]) -> bytes:
    """글자를 그린 이미지 한 장으로만 이루어진 스캔 형태의 PDF."""
    image = Image.new("L", (1700, 2200), 255)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=80)
    for index, line in enumerate(lines):
        draw.text((150, 300 + index * 160), line, font=font, fill=0)
    output = BytesIO()
    image.save(output, format="PDF", resolution=200)
    return output.getvalue()


def mixed_page_pdf() -> bytes:
    """이미지와 추출 가능한 텍스트가 한 페이지에 있는 PDF."""
    return build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> >>",
        stream_object(b"", b"q 612 0 0 792 0 0 cm /Im1 Do Q BT /F1 12 Tf (Caption) Tj ET"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        stream_object(b"/Type /XObject /Subtype /Image /Width 1 /Height 1 "
                      b"/ColorSpace /DeviceGray /BitsPerComponent 8", b"\xff"),
    ])


# --- 인식 함수 ---


def test_no_image_pages_does_not_require_tesseract(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    assert real_recognize_pages(BytesIO(b"not used"), []) == {}


def test_missing_tesseract_is_unavailable(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    with raises(ocr.OcrUnavailableError):
        real_recognize_pages(BytesIO(multi_page_pdf([None])), [1])


def test_missing_language_data_is_unavailable(monkeypatch: MonkeyPatch) -> None:
    def fake_run(args, **_kwargs):
        assert args[1:] == ["--list-langs"]
        return subprocess.CompletedProcess(args, 0, 'List of available languages in "x" (2):\neng\nosd\n', "")

    monkeypatch.setattr(ocr, "OCR_LANGUAGES", "kor+eng")
    monkeypatch.setattr(shutil, "which", lambda _name: "/usr/bin/tesseract")
    monkeypatch.setattr(subprocess, "run", fake_run)
    with raises(ocr.OcrUnavailableError, match="kor"):
        real_recognize_pages(BytesIO(multi_page_pdf([None])), [1])


@mark.parametrize("failure", ["exit_code", "timeout"])
def test_tesseract_error_or_timeout_is_failed(monkeypatch: MonkeyPatch, failure: str) -> None:
    def fake_recognize(args, **kwargs):
        if failure == "timeout":
            raise subprocess.TimeoutExpired(args, kwargs["timeout"])
        return subprocess.CompletedProcess(args, 1, b"", b"Error during processing.")

    monkeypatch.setattr(ocr, "_find_tesseract", lambda: "/usr/bin/tesseract")
    monkeypatch.setattr(subprocess, "run", fake_recognize)
    with raises(ocr.OcrFailedError):
        real_recognize_pages(BytesIO(multi_page_pdf([None])), [1])


def test_unreadable_pdf_is_failed(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(ocr, "_find_tesseract", lambda: "/usr/bin/tesseract")
    with raises(ocr.OcrFailedError):
        real_recognize_pages(BytesIO(b"%PDF-1.4 broken"), [1])


def test_form_feed_and_whitespace_only_output_are_normalized(monkeypatch: MonkeyPatch) -> None:
    outputs = iter([b"  Deadlock\n\x0c", b" \n\x0c"])
    monkeypatch.setattr(ocr, "_find_tesseract", lambda: "/usr/bin/tesseract")
    monkeypatch.setattr(
        subprocess, "run", lambda args, **_kw: subprocess.CompletedProcess(args, 0, next(outputs), b"")
    )
    assert real_recognize_pages(BytesIO(multi_page_pdf([None, None])), [1, 2]) == {
        1: "Deadlock", 2: "",
    }


@mark.real_ocr
def test_real_tesseract_reads_scanned_page(require_tesseract: None) -> None:
    result = real_recognize_pages(BytesIO(scanned_text_pdf(["PROCESS SCHEDULING"])), [1])
    assert "PROCESS SCHEDULING" in result[1]


# --- 처리 흐름 연결 ---


def test_only_image_pages_are_sent_to_ocr_and_stored_separately(
    engine: Engine, monkeypatch: MonkeyPatch
) -> None:
    requested: list[list[int]] = []

    def fake_recognize(_source: BytesIO, page_numbers: list[int]) -> dict[int, str]:
        requested.append(page_numbers)
        return {page_number: f"OCR {page_number}" for page_number in page_numbers}

    monkeypatch.setattr(ocr, "recognize_pages", fake_recognize)
    # 텍스트, 이미지, 빈 페이지, 이미지 순서
    document = upload(engine, multi_page_pdf(["Alpha", None, "", None]))
    process_next(engine)

    assert requested == [[2, 4]]
    assert job_state(engine, document.id) == ("completed", None)
    # 추출 텍스트(text)는 그대로 두고 OCR 결과는 ocr_text에만 저장한다.
    assert page_state(engine, document.id) == [
        (1, "Alpha", None), (2, "", "OCR 2"), (3, "", None), (4, "", "OCR 4"),
    ]


def test_mixed_and_text_pages_are_not_sent_to_ocr(engine: Engine, monkeypatch: MonkeyPatch) -> None:
    requested: list[list[int]] = []
    monkeypatch.setattr(
        ocr, "recognize_pages", lambda _source, pages: requested.append(pages) or {}
    )
    mixed = upload(engine, mixed_page_pdf())
    text_only = upload(engine, multi_page_pdf(["Alpha"]))
    process_next(engine)
    process_next(engine)

    assert requested == [[], []]
    assert page_state(engine, mixed.id) == [(1, "Caption", None)]
    assert page_state(engine, text_only.id) == [(1, "Alpha", None)]


@mark.parametrize(
    ("error", "expected_code"),
    [
        (ocr.OcrUnavailableError("tesseract executable not found"), "ocr_unavailable"),
        (ocr.OcrFailedError("tesseract exited with 1"), "ocr_failed"),
    ],
)
def test_ocr_failure_keeps_pages_and_retry_completes(
    engine: Engine, monkeypatch: MonkeyPatch, error: Exception, expected_code: str
) -> None:
    document = upload(engine, multi_page_pdf(["Alpha", None]))

    def fail(_source: BytesIO, _pages: list[int]) -> dict[int, str]:
        raise error

    with monkeypatch.context() as patch:
        patch.setattr(ocr, "recognize_pages", fail)
        process_next(engine)
    # 실패한 실행은 페이지를 쓰지 않으므로 이미 있던 결과도 바뀌지 않는다.
    assert job_state(engine, document.id) == ("failed", expected_code)
    assert page_state(engine, document.id) == []

    monkeypatch.setattr(ocr, "recognize_pages", lambda _source, pages: dict.fromkeys(pages, "복구됨"))
    with TestClient(app) as client:
        url = f"/documents/{document.id}/processing"
        failed = client.get(url).json()
        assert (failed["status"], failed["error_code"]) == ("failed", expected_code)
        assert client.post(f"{url}/retry").status_code == 202
        assert wait_until_finished(client, url)["status"] == "completed"
    assert page_state(engine, document.id) == [(1, "Alpha", None), (2, "", "복구됨")]


def test_ocr_failure_does_not_affect_other_documents(engine: Engine, monkeypatch: MonkeyPatch) -> None:
    scanned = upload(engine, multi_page_pdf([None]))
    other = upload(engine, multi_page_pdf(["Beta"]))

    def fail_on_images(_source: BytesIO, pages: list[int]) -> dict[int, str]:
        if pages:
            raise ocr.OcrFailedError("boom")
        return {}

    monkeypatch.setattr(ocr, "recognize_pages", fail_on_images)
    process_next(engine)
    process_next(engine)
    assert job_state(engine, scanned.id) == ("failed", "ocr_failed")
    assert job_state(engine, other.id) == ("completed", None)
    assert page_state(engine, other.id) == [(1, "Beta", None)]


@mark.real_ocr
def test_real_upload_runs_ocr_end_to_end(engine: Engine, require_tesseract: None) -> None:
    data = scanned_text_pdf(["DEADLOCK AVOIDANCE"])
    with TestClient(app) as client:
        subject = client.post("/subjects", json={"name": "운영체제"}).json()
        created = client.post(
            "/documents",
            data={"subject_id": subject["id"], "week_number": 3},
            files={"file": ("scan.pdf", data, "application/pdf")},
        )
        assert created.status_code == 201
        url = f"/documents/{created.json()['id']}/processing"
        assert wait_until_finished(client, url) == {
            "document_id": created.json()["id"], "status": "completed", "error_code": None,
            "page_kinds": ["image"],
        }
    ((_, page_text, ocr_text),) = page_state(engine, created.json()["id"])
    assert page_text == ""
    assert "DEADLOCK AVOIDANCE" in ocr_text


# --- 기존 DB 업그레이드 ---


def test_init_db_adds_ocr_text_to_existing_pages_table(temp_database_engine: Engine) -> None:
    engine = temp_database_engine
    database.Base.metadata.create_all(engine, tables=[Subject.__table__, Document.__table__])
    with engine.begin() as connection:
        # #31 이전 pages 테이블(ocr_text 없음)
        connection.execute(text(
            "CREATE TABLE pages (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL "
            "REFERENCES documents(id), page_number INTEGER NOT NULL, text TEXT, "
            "CONSTRAINT uq_pages_document_page_number UNIQUE (document_id, page_number), "
            "CONSTRAINT ck_pages_page_number_positive CHECK (page_number > 0))"
        ))
    with Session(engine) as session, session.begin():
        subject = Subject(name="자료구조")
        session.add(subject)
        session.flush()
        document = Document(subject_id=subject.id, filename="old.pdf", stored_name="old.pdf",
                            file_size_bytes=40, week_number=1, page_count=1)
        session.add(document)
        session.flush()
        document_id = document.id
        session.execute(text(
            "INSERT INTO pages (document_id, page_number, text) VALUES (:d, 1, '기존 텍스트')"
        ), {"d": document_id})
    assert "ocr_text" not in {c["name"] for c in inspect(engine).get_columns("pages")}

    init_db(engine)
    init_db(engine)  # 다시 실행해도 안전하다.

    assert "ocr_text" in {c["name"] for c in inspect(engine).get_columns("pages")}
    with Session(engine) as session:
        page = session.query(Page).one()
        assert (page.document_id, page.text, page.ocr_text) == (document_id, "기존 텍스트", None)
