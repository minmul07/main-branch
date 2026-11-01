from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi.testclient import TestClient
from httpx import Response
from pytest import MonkeyPatch, fixture, mark
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app import database
from backend.app.database import get_db
from backend.app.init_db import init_db
from backend.app.main import app
from backend.app.routers import documents as documents_router
from backend.app.routers.documents import UploadSettings, get_upload_settings
from backend.tests.pdf_samples import blank_pdf, encrypted_pdf, scanned_pdf, text_pdf

MAX_SIZE = 1024 * 1024


@fixture
def upload_dir(tmp_path: Path) -> Path:
    return tmp_path / "uploads"


@fixture
def upload_settings(upload_dir: Path) -> UploadSettings:
    return UploadSettings(upload_dir=upload_dir, max_size_bytes=MAX_SIZE)


def use_engine(engine: Engine) -> None:
    testing_session = sessionmaker(bind=engine)

    def override_get_db() -> Iterator[Session]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db


@fixture
def client(temp_database_engine: Engine, upload_settings: UploadSettings) -> Iterator[TestClient]:
    init_db(temp_database_engine)
    use_engine(temp_database_engine)
    app.dependency_overrides[get_upload_settings] = lambda: upload_settings
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def create_subject(client: TestClient, name: str = "운영체제") -> int:
    response = client.post("/subjects", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


def post_document(
    client: TestClient,
    subject_id: Any = None,
    week_number: Any = 3,
    data: bytes | None = None,
    filename: str = "3주차.pdf",
    omit: tuple[str, ...] = (),
) -> Response:
    form = {"subject_id": str(subject_id), "week_number": str(week_number)}
    files = {"file": (filename, text_pdf() if data is None else data, "application/pdf")}
    for name in omit:
        form.pop(name, None)
        files.pop(name, None)
    return client.post("/documents", data=form, files=files or None)


def count_documents(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(text("SELECT COUNT(*) FROM documents")).scalar_one()


def stored_files(upload_dir: Path) -> list[Path]:
    return sorted(upload_dir.iterdir()) if upload_dir.exists() else []


def test_upload_list_detail_and_file_flow(client: TestClient, upload_dir: Path) -> None:
    subject_id = create_subject(client)
    data = text_pdf()

    created = post_document(client, subject_id, data=data)

    assert created.status_code == 201
    body = created.json()
    assert set(body) == {
        "id",
        "subject_id",
        "week_number",
        "filename",
        "uploaded_at",
        "file_size_bytes",
        "page_count",
    }
    assert body["subject_id"] == subject_id
    assert body["week_number"] == 3
    assert body["filename"] == "3주차.pdf"
    assert body["file_size_bytes"] == len(data)
    assert body["page_count"] == 1
    assert body["uploaded_at"].endswith("Z")

    listed = client.get("/documents", params={"subject_id": subject_id})
    assert listed.status_code == 200
    assert listed.json() == [body]

    detail = client.get(f"/documents/{body['id']}")
    assert detail.status_code == 200
    assert detail.json() == body

    original = client.get(f"/documents/{body['id']}/file")
    assert original.status_code == 200
    assert original.content == data
    assert original.headers["content-type"] == "application/pdf"
    assert original.headers["content-length"] == str(len(data))
    assert original.headers["content-disposition"] == (
        f"inline; filename*=utf-8''{quote('3주차.pdf')}"
    )
    assert len(stored_files(upload_dir)) == 1


def test_ascii_filename_content_disposition(client: TestClient) -> None:
    subject_id = create_subject(client)
    document_id = post_document(client, subject_id, filename="week3.pdf").json()["id"]

    response = client.get(f"/documents/{document_id}/file")

    assert response.headers["content-disposition"] == 'inline; filename="week3.pdf"'


def test_file_supports_range_request(client: TestClient) -> None:
    subject_id = create_subject(client)
    data = text_pdf()
    document_id = post_document(client, subject_id, data=data).json()["id"]

    response = client.get(f"/documents/{document_id}/file", headers={"Range": "bytes=0-9"})

    assert response.status_code == 206
    assert response.content == data[:10]
    assert response.headers["content-range"] == f"bytes 0-9/{len(data)}"


def test_list_separates_subjects_and_orders_by_id(client: TestClient) -> None:
    first = create_subject(client, "운영체제")
    second = create_subject(client, "자료구조")
    post_document(client, first, filename="a.pdf")
    post_document(client, second, filename="b.pdf")
    post_document(client, first, filename="c.pdf")

    documents = client.get("/documents", params={"subject_id": first}).json()

    assert [document["filename"] for document in documents] == ["a.pdf", "c.pdf"]
    assert [document["id"] for document in documents] == sorted(d["id"] for d in documents)
    assert [d["filename"] for d in client.get(f"/documents?subject_id={second}").json()] == [
        "b.pdf"
    ]


def test_list_empty_subject_returns_empty_list(client: TestClient) -> None:
    subject_id = create_subject(client)

    response = client.get("/documents", params={"subject_id": subject_id})

    assert response.status_code == 200
    assert response.json() == []


def test_list_missing_subject_returns_404(client: TestClient) -> None:
    assert client.get("/documents", params={"subject_id": 999}).status_code == 404


@mark.parametrize("query", ["", "?subject_id=", "?subject_id=0", "?subject_id=-1", "?subject_id=abc", "?subject_id=1.0"])
def test_list_invalid_subject_id_returns_422(client: TestClient, query: str) -> None:
    create_subject(client)

    assert client.get(f"/documents{query}").status_code == 422


def test_missing_document_returns_404(client: TestClient) -> None:
    assert client.get("/documents/999").status_code == 404
    assert client.get("/documents/999/file").status_code == 404


@mark.parametrize("document_id", ["0", "-1", "abc", "1.5"])
def test_invalid_document_id_returns_422(client: TestClient, document_id: str) -> None:
    assert client.get(f"/documents/{document_id}").status_code == 422
    assert client.get(f"/documents/{document_id}/file").status_code == 422


def test_upload_missing_subject_returns_404(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path
) -> None:
    response = post_document(client, 999)

    assert response.status_code == 404
    assert count_documents(temp_database_engine) == 0
    assert stored_files(upload_dir) == []


@mark.parametrize("field", ["file", "subject_id", "week_number"])
def test_upload_missing_field_returns_422(
    client: TestClient, temp_database_engine: Engine, field: str
) -> None:
    subject_id = create_subject(client)

    response = post_document(client, subject_id, omit=(field,))

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert count_documents(temp_database_engine) == 0


@mark.parametrize("week_number", ["0", "-1", "3.5", "3.0", "abc", ""])
def test_upload_invalid_week_number_returns_422(
    client: TestClient, temp_database_engine: Engine, week_number: str
) -> None:
    subject_id = create_subject(client)

    response = post_document(client, subject_id, week_number=week_number)

    assert response.status_code == 422
    assert count_documents(temp_database_engine) == 0


@mark.parametrize("subject_id", ["0", "1.0", "abc"])
def test_upload_invalid_subject_id_returns_422(client: TestClient, subject_id: str) -> None:
    create_subject(client)

    assert post_document(client, subject_id).status_code == 422


@mark.parametrize(
    "data",
    [b"", b"not a pdf", encrypted_pdf(), blank_pdf(0), text_pdf()[:100]],
    ids=["empty", "not-pdf", "encrypted", "no-pages", "truncated"],
)
def test_upload_invalid_pdf_returns_422(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path, data: bytes
) -> None:
    subject_id = create_subject(client)

    response = post_document(client, subject_id, data=data)

    assert response.status_code == 422
    assert "detail" in response.json()
    assert count_documents(temp_database_engine) == 0
    assert stored_files(upload_dir) == []


def test_upload_scanned_pdf_succeeds(client: TestClient) -> None:
    subject_id = create_subject(client)

    response = post_document(client, subject_id, data=scanned_pdf())

    assert response.status_code == 201
    assert response.json()["page_count"] == 1


def test_upload_invalid_filename_returns_422(client: TestClient) -> None:
    subject_id = create_subject(client)

    assert post_document(client, subject_id, filename="folder/").status_code == 422


def test_upload_path_traversal_filename_is_sanitized(
    client: TestClient, upload_dir: Path, tmp_path: Path
) -> None:
    subject_id = create_subject(client)

    response = post_document(client, subject_id, filename="../../outside.pdf")

    assert response.status_code == 201
    assert response.json()["filename"] == "outside.pdf"
    assert [path.parent for path in stored_files(upload_dir)] == [upload_dir]
    assert not (tmp_path / "outside.pdf").exists()


def test_same_file_upload_creates_separate_documents(client: TestClient, upload_dir: Path) -> None:
    subject_id = create_subject(client)

    first = post_document(client, subject_id).json()
    second = post_document(client, subject_id).json()

    assert first["id"] != second["id"]
    assert first["filename"] == second["filename"]
    assert len(stored_files(upload_dir)) == 2


def test_upload_too_large_returns_413(
    client: TestClient, upload_settings: UploadSettings, upload_dir: Path, temp_database_engine: Engine
) -> None:
    subject_id = create_subject(client)
    data = text_pdf()
    small = UploadSettings(upload_dir=upload_dir, max_size_bytes=len(data) - 1)
    app.dependency_overrides[get_upload_settings] = lambda: small

    response = post_document(client, subject_id, data=data)

    assert response.status_code == 413
    assert count_documents(temp_database_engine) == 0
    assert stored_files(upload_dir) == []


def test_upload_rejects_large_content_length_before_parsing(
    client: TestClient, upload_dir: Path, monkeypatch: MonkeyPatch
) -> None:
    subject_id = create_subject(client)
    small = UploadSettings(upload_dir=upload_dir, max_size_bytes=1024)
    app.dependency_overrides[get_upload_settings] = lambda: small

    def must_not_run(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("upload service must not run")

    monkeypatch.setattr(documents_router.document_service, "upload_document", must_not_run)
    data = text_pdf() + b"\n" * (documents_router.MULTIPART_OVERHEAD_BYTES + 2048)

    response = post_document(client, subject_id, data=data)

    assert response.status_code == 413
    assert stored_files(upload_dir) == []


def test_storage_failure_returns_500(client: TestClient, tmp_path: Path) -> None:
    subject_id = create_subject(client)
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    broken = UploadSettings(upload_dir=blocker / "uploads", max_size_bytes=MAX_SIZE)
    app.dependency_overrides[get_upload_settings] = lambda: broken

    response = post_document(client, subject_id)

    assert response.status_code == 500
    assert "detail" in response.json()


def test_missing_original_file_returns_404(client: TestClient, upload_dir: Path) -> None:
    subject_id = create_subject(client)
    document_id = post_document(client, subject_id).json()["id"]
    for path in stored_files(upload_dir):
        path.unlink()

    assert client.get(f"/documents/{document_id}").status_code == 200
    assert client.get(f"/documents/{document_id}/file").status_code == 404


def test_documents_persist_after_reinit_and_reconnect(
    client: TestClient, temp_database_engine: Engine, tmp_path: Path
) -> None:
    subject_id = create_subject(client)
    data = text_pdf()
    document_id = post_document(client, subject_id, data=data).json()["id"]
    database_path = Path(temp_database_engine.url.database or "")
    temp_database_engine.dispose()

    new_engine = database.create_sqlite_engine(database_path)
    try:
        init_db(new_engine)
        use_engine(new_engine)

        listed = client.get("/documents", params={"subject_id": subject_id}).json()
        assert [document["id"] for document in listed] == [document_id]
        assert client.get(f"/documents/{document_id}/file").content == data
        assert client.get("/subjects").json() == [{"id": subject_id, "name": "운영체제"}]
    finally:
        new_engine.dispose()


def test_cors_allows_configured_frontend_origin(client: TestClient) -> None:
    allowed = client.options(
        "/subjects",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    blocked = client.get("/subjects", headers={"Origin": "http://evil.example"})

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert "access-control-allow-origin" not in blocked.headers
