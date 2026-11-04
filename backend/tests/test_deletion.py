from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

from fastapi.testclient import TestClient
from pytest import MonkeyPatch, fixture, mark, raises
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from backend.app import database
from backend.app.database import get_db
from backend.app.init_db import init_db
from backend.app.main import app
from backend.app.models.document import Document
from backend.app.models.subject import Subject
from backend.app.repositories import document as document_repository
from backend.app.routers.documents import UploadSettings, get_upload_settings
from backend.tests.pdf_samples import text_pdf


@fixture
def upload_dir(tmp_path: Path) -> Path:
    return tmp_path / "uploads"


@fixture
def client(temp_database_engine: Engine, upload_dir: Path) -> Iterator[TestClient]:
    init_db(temp_database_engine)
    factory = sessionmaker(bind=temp_database_engine)

    def override_db() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_upload_settings] = lambda: UploadSettings(upload_dir, 1048576)
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def subject(client: TestClient) -> int:
    response = client.post("/subjects", json={"name": "운영체제"})
    assert response.status_code == 201
    return response.json()["id"]


def test_subject_name_confirmation_deletes_all_documents(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
) -> None:
    target, other = subject(client), subject(client)
    ids = [document(client, target), document(client, target)]
    kept = document(client, other)
    paths = [original(temp_database_engine, upload_dir, item) for item in ids]
    assert client.delete(f"/subjects/{target}").status_code == 409
    assert client.delete(f"/subjects/{target}", params={"confirmed_name": "wrong"}).status_code == 409
    assert all(path.exists() for path in paths)
    assert client.delete(f"/subjects/{target}", params={"confirmed_name": "운영체제"}).status_code == 204
    assert all(not path.exists() for path in paths)
    assert client.get(f"/documents/{kept}/file").status_code == 200
    assert client.get(f"/documents?subject_id={target}").status_code == 404


def test_subject_cascade_failure_restores_all_originals(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path, monkeypatch: MonkeyPatch,
) -> None:
    target = subject(client)
    ids = [document(client, target), document(client, target)]
    paths = [original(temp_database_engine, upload_dir, item) for item in ids]
    saved = {path: path.read_bytes() for path in paths}
    real_delete = document_repository.delete_document
    calls = 0

    def fail_second(session: Session, item: Document) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated failure")
        real_delete(session, item)

    monkeypatch.setattr(document_repository, "delete_document", fail_second)
    assert client.delete(f"/subjects/{target}", params={"confirmed_name": "운영체제"}).status_code == 500
    assert len(client.get(f"/documents?subject_id={target}").json()) == 2
    assert all(path.read_bytes() == data for path, data in saved.items())
    assert not list(upload_dir.glob(".delete-*"))


def document(client: TestClient, subject_id: int) -> int:
    response = client.post(
        "/documents", data={"subject_id": subject_id, "week_number": 1},
        files={"file": ("lecture.pdf", text_pdf(), "application/pdf")},
    )
    assert response.status_code == 201
    return response.json()["id"]


def original(engine: Engine, upload_dir: Path, document_id: int) -> Path:
    with Session(engine) as session:
        return upload_dir / session.get(Document, document_id).stored_name


def test_delete_flow_persists_and_preserves_others(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
) -> None:
    first, other = subject(client), subject(client)
    deleted, kept, unrelated = document(client, first), document(client, first), document(client, other)
    deleted_path = original(temp_database_engine, upload_dir, deleted)
    preserved = {p: p.read_bytes() for p in upload_dir.iterdir() if p != deleted_path}
    assert client.delete(f"/subjects/{first}").status_code == 409
    response = client.delete(f"/documents/{deleted}")
    assert response.status_code == 204 and response.content == b""
    assert not deleted_path.exists()
    assert [d["id"] for d in client.get(f"/documents?subject_id={first}").json()] == [kept]
    assert client.get(f"/documents/{deleted}").status_code == 404
    assert client.get(f"/documents/{deleted}/file").status_code == 404
    assert client.delete(f"/documents/{deleted}").status_code == 404
    for path, data in preserved.items():
        assert path.read_bytes() == data
    assert client.delete(f"/subjects/{first}").status_code == 409
    assert client.delete(f"/documents/{kept}").status_code == 204
    response = client.delete(f"/subjects/{first}")
    assert response.status_code == 204 and response.content == b""
    assert client.delete(f"/subjects/{first}").status_code == 404
    # 새 엔진/세션과 초기화 재실행 후에도 삭제 및 다른 과목 원본 보존.
    fresh = database.create_sqlite_engine(Path(temp_database_engine.url.database))
    try:
        init_db(fresh)
        with Session(fresh) as session:
            assert session.get(Document, deleted) is None
            assert session.get(Document, kept) is None
            assert session.get(Document, unrelated) is not None
            assert session.get(Subject, first) is None
            assert session.get(Subject, other) is not None
        assert client.get("/subjects").json() == [{"id": other, "name": "운영체제"}]
        assert client.get(f"/documents/{unrelated}/file").content == text_pdf()
    finally:
        fresh.dispose()
    assert not list(upload_dir.glob(".delete-*"))


@mark.parametrize("resource", ["subjects", "documents"])
@mark.parametrize("invalid", ["0", "-1", "abc", "3.0", "3.5"])
def test_invalid_id(client: TestClient, resource: str, invalid: str) -> None:
    assert client.delete(f"/{resource}/{invalid}").status_code == 422


@mark.parametrize("resource", ["subjects", "documents"])
def test_missing_target(client: TestClient, resource: str) -> None:
    assert client.delete(f"/{resource}/999").status_code == 404


def test_missing_original_can_be_deleted(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
) -> None:
    sid = subject(client)
    did = document(client, sid)
    original(temp_database_engine, upload_dir, did).unlink()
    assert client.delete(f"/documents/{did}").status_code == 204
    assert client.delete(f"/subjects/{sid}").status_code == 204


@mark.parametrize("resource", ["subjects", "documents"])
@mark.parametrize("method", ["commit", "flush"])
def test_database_failure_preserves_target(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
    monkeypatch: MonkeyPatch, resource: str, method: str,
) -> None:
    sid = subject(client)
    target = document(client, sid) if resource == "documents" else sid
    before = {p: p.read_bytes() for p in upload_dir.iterdir()} if upload_dir.exists() else {}

    def fail(*args, **kwargs):
        raise RuntimeError("database failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, method, fail)
        assert client.delete(f"/{resource}/{target}").status_code == 500
    if resource == "documents":
        assert client.get(f"/documents/{target}/file").content == text_pdf()
    assert len(client.get("/subjects").json()) == 1
    for path, data in before.items():
        assert path.read_bytes() == data
    assert not list(upload_dir.glob(".delete-*"))


def test_move_failure_preserves_row_and_file(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path, monkeypatch: MonkeyPatch,
) -> None:
    did = document(client, subject(client))
    path = original(temp_database_engine, upload_dir, did)

    def fail(*args, **kwargs):
        raise PermissionError("move denied")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "rename", fail)
        assert client.delete(f"/documents/{did}").status_code == 500
    assert path.read_bytes() == text_pdf()
    assert client.get(f"/documents/{did}").status_code == 200
    assert list(upload_dir.iterdir()) == [path]


def test_unlink_failure_reports_committed_deletion_and_recoverable_file(
    client: TestClient, upload_dir: Path, monkeypatch: MonkeyPatch, caplog,
) -> None:
    did = document(client, subject(client))

    def fail(*args, **kwargs):
        raise PermissionError("unlink denied")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", fail)
        assert client.delete(f"/documents/{did}").status_code == 500
    assert client.get(f"/documents/{did}").status_code == 404
    [quarantine] = upload_dir.glob(f".delete-{did}-*.pdf")
    assert quarantine.read_bytes() == text_pdf()
    assert str(quarantine) in caplog.text
    quarantine.unlink()  # 문서화한 행 없는 격리 파일 복구 절차.


def test_restore_failure_preserves_quarantine_for_manual_recovery(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
    monkeypatch: MonkeyPatch, caplog,
) -> None:
    did = document(client, subject(client))
    path = original(temp_database_engine, upload_dir, did)
    rename = Path.rename

    def fail_restore(source, target):
        if source.name.startswith(".delete-"):
            raise PermissionError("restore denied")
        return rename(source, target)

    def fail_commit(*args):
        raise RuntimeError("commit failed")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "rename", fail_restore)
        patch.setattr(Session, "commit", fail_commit)
        assert client.delete(f"/documents/{did}").status_code == 500
    assert client.get(f"/documents/{did}").status_code == 200
    [quarantine] = upload_dir.glob(f".delete-{did}-*.pdf")
    assert quarantine.read_bytes() == text_pdf()
    assert str(path) in caplog.text and str(quarantine) in caplog.text
    quarantine.rename(path)
    assert client.get(f"/documents/{did}/file").content == text_pdf()


def test_unsafe_stored_path_preserves_external_file(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path, tmp_path: Path,
) -> None:
    did = document(client, subject(client))
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"keep")
    with Session(temp_database_engine) as session:
        session.get(Document, did).stored_name = "../outside.pdf"
        session.commit()
    assert client.delete(f"/documents/{did}").status_code == 500
    assert outside.read_bytes() == b"keep"
    assert client.get(f"/documents/{did}").status_code == 200


def test_non_file_original_preserved(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
) -> None:
    did = document(client, subject(client))
    path = original(temp_database_engine, upload_dir, did)
    path.unlink()
    path.mkdir()
    assert client.delete(f"/documents/{did}").status_code == 500
    assert path.is_dir()
    assert client.get(f"/documents/{did}").status_code == 200


@mark.parametrize("resource", ["subjects", "documents"])
def test_delete_cors(client: TestClient, resource: str) -> None:
    response = client.options(f"/{resource}/1", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE",
    })
    assert response.status_code == 200
    assert "DELETE" in response.headers["access-control-allow-methods"]
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.options(f"/{resource}/1", headers={
        "Origin": "https://untrusted.example", "Access-Control-Request-Method": "DELETE",
    })
    assert "access-control-allow-origin" not in response.headers


def test_concurrent_delete_is_serialized(
    client: TestClient, upload_dir: Path, monkeypatch: MonkeyPatch,
) -> None:
    did = document(client, subject(client))
    reached, release = Event(), Event()
    delete = document_repository.delete_document

    def paused_delete(session, target):
        reached.set()
        assert release.wait(timeout=5)
        delete(session, target)

    monkeypatch.setattr(document_repository, "delete_document", paused_delete)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.delete, f"/documents/{did}")
        try:
            assert reached.wait(timeout=5)
            second = pool.submit(client.delete, f"/documents/{did}")
        finally:
            release.set()
        assert first.result(timeout=10).status_code == 204
        assert second.result(timeout=10).status_code == 404
    assert list(upload_dir.iterdir()) == []


def test_restore_never_overwrites_new_file(
    client: TestClient, temp_database_engine: Engine, upload_dir: Path,
    monkeypatch: MonkeyPatch, caplog,
) -> None:
    did = document(client, subject(client))
    path = original(temp_database_engine, upload_dir, did)

    def fail_commit(*args):
        path.write_bytes(b"unrelated new file")
        raise RuntimeError("commit failed")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        assert client.delete(f"/documents/{did}").status_code == 500
    assert path.read_bytes() == b"unrelated new file"
    [quarantine] = upload_dir.glob(f".delete-{did}-*.pdf")
    assert quarantine.read_bytes() == text_pdf()
    assert client.get(f"/documents/{did}").status_code == 200
    assert str(quarantine) in caplog.text


def test_foreign_keys_prevent_orphans_even_outside_delete_service(
    client: TestClient, temp_database_engine: Engine,
) -> None:
    sid = subject(client)
    did = document(client, sid)
    with Session(temp_database_engine) as session:
        session.delete(session.get(Subject, sid))
        with raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.get(Document, did) is not None
        assert session.get(Subject, sid) is not None
    empty = subject(client)
    assert client.delete(f"/subjects/{empty}").status_code == 204
    with Session(temp_database_engine) as session:
        session.add(Document(
            subject_id=empty, week_number=1, filename="late.pdf", stored_name="late.pdf",
            file_size_bytes=1, page_count=1,
        ))
        with raises(IntegrityError):
            session.commit()
