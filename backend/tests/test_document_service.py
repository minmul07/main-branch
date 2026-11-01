from collections.abc import Generator
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from pytest import MonkeyPatch, fixture, mark, raises
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from backend.app import database
from backend.app.init_db import init_db
from backend.app.repositories.document import list_documents_by_subject
from backend.app.repositories.subject import create_subject
from backend.app.services import documents as document_service
from backend.app.services.documents import (
    InvalidFilenameError,
    InvalidPdfError,
    StorageError,
    SubjectNotFoundError,
    UploadTooLargeError,
    get_document_file_path,
    normalize_filename,
    upload_document,
)
from backend.tests.pdf_samples import blank_pdf, encrypted_pdf, scanned_pdf, text_pdf

MAX_SIZE = 1024 * 1024


@fixture
def engine(tmp_path: Path) -> Generator[Engine, None, None]:
    engine = database.create_sqlite_engine(tmp_path / "test.db")
    init_db(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@fixture
def upload_dir(tmp_path: Path) -> Path:
    return tmp_path / "uploads"


@fixture
def subject_id(engine: Engine) -> int:
    with Session(engine) as session:
        subject = create_subject(session, "운영체제")
        session.commit()
        return subject.id


def upload(
    engine: Engine, upload_dir: Path, subject_id: int, data: bytes, **overrides: Any
) -> int:
    values: dict[str, Any] = {
        "upload_dir": upload_dir,
        "max_size_bytes": MAX_SIZE,
        "subject_id": subject_id,
        "week_number": 3,
        "filename": "3주차.pdf",
        "file": BytesIO(data),
    }
    values.update(overrides)
    with Session(engine) as session:
        return upload_document(session, **values).id


def count_documents(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(text("SELECT COUNT(*) FROM documents")).scalar_one()


def stored_files(upload_dir: Path) -> list[Path]:
    if not upload_dir.exists():
        return []
    return sorted(upload_dir.iterdir())


def test_upload_stores_file_and_metadata(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    data = text_pdf()
    before = datetime.now(UTC)

    document_id = upload(engine, upload_dir, subject_id, data)

    with Session(engine) as session:
        [document] = list_documents_by_subject(session, subject_id)
        assert document.id == document_id
        assert document.week_number == 3
        assert document.filename == "3주차.pdf"
        assert document.file_size_bytes == len(data)
        assert document.page_count == 1
        assert before <= document.uploaded_at.replace(tzinfo=UTC) <= datetime.now(UTC)
        path = get_document_file_path(upload_dir, document)
    assert path is not None
    assert path.read_bytes() == data
    assert stored_files(upload_dir) == [path]


@mark.parametrize(
    ("data", "page_count"),
    [(scanned_pdf(), 1), (blank_pdf(3), 3)],
    ids=["scanned", "multi-page"],
)
def test_upload_accepts_valid_pdfs(
    engine: Engine, upload_dir: Path, subject_id: int, data: bytes, page_count: int
) -> None:
    upload(engine, upload_dir, subject_id, data)

    with Session(engine) as session:
        [document] = list_documents_by_subject(session, subject_id)
        assert document.page_count == page_count


@mark.parametrize(
    "data",
    [
        b"",
        b"plain text renamed to pdf",
        b"%PDF-1.4\nbroken",
        text_pdf()[: len(text_pdf()) // 2],
        encrypted_pdf(),
        encrypted_pdf(password=""),
        blank_pdf(0),
    ],
    ids=["empty", "not-pdf", "garbage", "truncated", "encrypted", "encrypted-empty", "no-pages"],
)
def test_upload_rejects_invalid_pdfs(
    engine: Engine, upload_dir: Path, subject_id: int, data: bytes
) -> None:
    with raises(InvalidPdfError):
        upload(engine, upload_dir, subject_id, data)

    assert count_documents(engine) == 0
    assert stored_files(upload_dir) == []


def test_upload_rejects_too_large_file(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    data = text_pdf()

    with raises(UploadTooLargeError):
        upload(engine, upload_dir, subject_id, data, max_size_bytes=len(data) - 1)

    assert count_documents(engine) == 0
    assert stored_files(upload_dir) == []


def test_upload_accepts_file_at_size_limit(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    data = text_pdf()

    upload(engine, upload_dir, subject_id, data, max_size_bytes=len(data))

    assert count_documents(engine) == 1


def test_upload_rejects_missing_subject(engine: Engine, upload_dir: Path, subject_id: int) -> None:
    with raises(SubjectNotFoundError):
        upload(engine, upload_dir, subject_id + 1, text_pdf())

    assert count_documents(engine) == 0
    assert stored_files(upload_dir) == []


def test_same_file_uploads_create_separate_documents(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    data = text_pdf()

    first = upload(engine, upload_dir, subject_id, data)
    second = upload(engine, upload_dir, subject_id, data)

    assert first != second
    assert len(stored_files(upload_dir)) == 2


@mark.parametrize(
    ("raw", "expected"),
    [
        ("강의자료 3주차.pdf", "강의자료 3주차.pdf"),
        ("../../evil.pdf", "evil.pdf"),
        ("C:\\Users\\me\\lecture.pdf", "lecture.pdf"),
        ("/etc/passwd.pdf", "passwd.pdf"),
        ("  spaced.pdf  ", "spaced.pdf"),
    ],
)
def test_normalize_filename(raw: str, expected: str) -> None:
    assert normalize_filename(raw) == expected


@mark.parametrize("raw", [None, "", "   ", "folder/", "..", "a" * 252 + ".pdf"])
def test_normalize_filename_rejects_invalid(raw: str | None) -> None:
    with raises(InvalidFilenameError):
        normalize_filename(raw)


def test_path_traversal_filename_stays_inside_upload_dir(
    engine: Engine, upload_dir: Path, subject_id: int, tmp_path: Path
) -> None:
    upload(engine, upload_dir, subject_id, text_pdf(), filename="../../outside.pdf")

    [stored] = stored_files(upload_dir)
    assert stored.parent == upload_dir
    assert not (tmp_path / "outside.pdf").exists()
    with Session(engine) as session:
        [document] = list_documents_by_subject(session, subject_id)
        assert document.filename == "outside.pdf"
        assert document.stored_name != "outside.pdf"


def test_commit_failure_rolls_back_and_removes_files(
    engine: Engine, upload_dir: Path, subject_id: int, monkeypatch: MonkeyPatch
) -> None:
    def fail_commit(self: Session) -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(Session, "commit", fail_commit)

    with raises(RuntimeError):
        upload(engine, upload_dir, subject_id, text_pdf())

    monkeypatch.undo()
    assert count_documents(engine) == 0
    assert stored_files(upload_dir) == []


def test_move_failure_removes_temp_file(
    engine: Engine, upload_dir: Path, subject_id: int, monkeypatch: MonkeyPatch
) -> None:
    def fail_replace(source: Path, destination: Path) -> None:
        raise OSError("disk error")

    monkeypatch.setattr(document_service.os, "replace", fail_replace)

    with raises(StorageError):
        upload(engine, upload_dir, subject_id, text_pdf())

    assert count_documents(engine) == 0
    assert stored_files(upload_dir) == []


def test_unavailable_upload_dir_raises_storage_error(
    engine: Engine, tmp_path: Path, subject_id: int
) -> None:
    not_a_directory = tmp_path / "file"
    not_a_directory.write_text("x")

    with raises(StorageError):
        upload(engine, not_a_directory / "uploads", subject_id, text_pdf())

    assert count_documents(engine) == 0


def test_missing_original_returns_none(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    upload(engine, upload_dir, subject_id, text_pdf())
    with Session(engine) as session:
        [document] = list_documents_by_subject(session, subject_id)
        path = get_document_file_path(upload_dir, document)
        assert path is not None
        path.unlink()

        assert get_document_file_path(upload_dir, document) is None
