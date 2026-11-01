from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from pytest import fixture, mark, raises
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app import database
from backend.app.init_db import init_db
from backend.app.models.document import Document
from backend.app.repositories.document import (
    create_document,
    get_document,
    list_documents_by_subject,
)
from backend.app.repositories.subject import create_subject
from backend.app.schemas.document import DocumentRead


@fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@fixture
def engine(database_path: Path) -> Generator[Engine, None, None]:
    engine = database.create_sqlite_engine(database_path)
    init_db(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@fixture
def subject_ids(engine: Engine) -> list[int]:
    with Session(engine) as session:
        subjects = [create_subject(session, name) for name in ["운영체제", "자료구조"]]
        session.commit()
        return [subject.id for subject in subjects]


def add_document(session: Session, subject_id: int, **overrides: Any) -> Document:
    values: dict[str, Any] = {
        "subject_id": subject_id,
        "week_number": 3,
        "filename": "3주차.pdf",
        "stored_name": f"{uuid4().hex}.pdf",
        "file_size_bytes": 245760,
        "page_count": 12,
    }
    values.update(overrides)
    return create_document(session, **values)


def count_documents(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(text("SELECT COUNT(*) FROM documents")).scalar_one()


def test_create_document_returns_document_with_id(
    engine: Engine, subject_ids: list[int]
) -> None:
    before = datetime.now(UTC)
    with Session(engine) as session:
        document = add_document(session, subject_ids[0])

        assert document.id is not None
        assert document.subject_id == subject_ids[0]
        assert document.week_number == 3
        assert document.filename == "3주차.pdf"
        assert document.file_size_bytes == 245760
        assert document.page_count == 12
        assert before <= document.uploaded_at <= datetime.now(UTC)


def test_create_document_does_not_commit(engine: Engine, subject_ids: list[int]) -> None:
    with Session(engine) as session:
        add_document(session, subject_ids[0])

        assert count_documents(engine) == 0


def test_rollback_discards_created_document(engine: Engine, subject_ids: list[int]) -> None:
    with Session(engine) as session:
        add_document(session, subject_ids[0])
        session.rollback()

    assert count_documents(engine) == 0


def test_get_document(engine: Engine, subject_ids: list[int]) -> None:
    with Session(engine) as session:
        document_id = add_document(session, subject_ids[0]).id
        session.commit()

    with Session(engine) as session:
        document = get_document(session, document_id)
        assert document is not None
        assert document.filename == "3주차.pdf"
        assert get_document(session, document_id + 1) is None


def test_list_documents_by_subject_separates_and_orders_by_id(
    engine: Engine, subject_ids: list[int]
) -> None:
    first, second = subject_ids
    with Session(engine) as session:
        add_document(session, first, filename="a.pdf")
        add_document(session, second, filename="b.pdf")
        add_document(session, first, filename="c.pdf")
        session.commit()

    with Session(engine) as session:
        documents = list_documents_by_subject(session, first)
        assert [document.filename for document in documents] == ["a.pdf", "c.pdf"]
        assert [document.id for document in documents] == sorted(d.id for d in documents)
        assert [d.filename for d in list_documents_by_subject(session, second)] == ["b.pdf"]


def test_list_documents_by_subject_returns_empty_list(
    engine: Engine, subject_ids: list[int]
) -> None:
    with Session(engine) as session:
        assert list_documents_by_subject(session, subject_ids[0]) == []


def test_same_filename_creates_separate_documents(
    engine: Engine, subject_ids: list[int]
) -> None:
    with Session(engine) as session:
        first = add_document(session, subject_ids[0])
        second = add_document(session, subject_ids[0])

        assert first.id != second.id
        assert first.stored_name != second.stored_name


def test_stored_name_must_be_unique(engine: Engine, subject_ids: list[int]) -> None:
    with Session(engine) as session:
        add_document(session, subject_ids[0], stored_name="same.pdf")
        with raises(IntegrityError):
            add_document(session, subject_ids[0], stored_name="same.pdf")


@mark.parametrize(
    "overrides",
    [
        {"week_number": 0},
        {"week_number": -1},
        {"file_size_bytes": -1},
        {"page_count": 0},
    ],
    ids=["week-zero", "week-negative", "size-negative", "page-zero"],
)
def test_check_constraints_reject_invalid_values(
    engine: Engine, subject_ids: list[int], overrides: dict[str, int]
) -> None:
    with Session(engine) as session:
        with raises(IntegrityError):
            add_document(session, subject_ids[0], **overrides)


def test_page_count_allows_null(engine: Engine, subject_ids: list[int]) -> None:
    with Session(engine) as session:
        document_id = add_document(session, subject_ids[0], page_count=None).id
        session.commit()

    with Session(engine) as session:
        document = get_document(session, document_id)
        assert document is not None
        assert document.page_count is None


def test_init_db_keeps_existing_subjects_and_documents(
    engine: Engine, subject_ids: list[int]
) -> None:
    with Session(engine) as session:
        add_document(session, subject_ids[0])
        session.commit()

    init_db(engine)

    with Session(engine) as session:
        assert len(list_documents_by_subject(session, subject_ids[0])) == 1
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM subjects")).scalar_one() == 2


def test_committed_document_persists_after_reconnect(
    engine: Engine, database_path: Path, subject_ids: list[int]
) -> None:
    with Session(engine) as session:
        add_document(session, subject_ids[0])
        session.commit()
    engine.dispose()

    new_engine = database.create_sqlite_engine(database_path)
    try:
        with Session(new_engine) as session:
            documents = list_documents_by_subject(session, subject_ids[0])
            assert [document.filename for document in documents] == ["3주차.pdf"]
    finally:
        new_engine.dispose()


def test_document_read_serializes_utc_and_hides_stored_name(
    engine: Engine, subject_ids: list[int]
) -> None:
    with Session(engine) as session:
        document_id = add_document(session, subject_ids[0]).id
        session.commit()

    with Session(engine) as session:
        document = get_document(session, document_id)
        data = DocumentRead.model_validate(document).model_dump(mode="json")

    assert set(data) == {
        "id",
        "subject_id",
        "week_number",
        "filename",
        "uploaded_at",
        "file_size_bytes",
        "page_count",
    }
    assert data["uploaded_at"].endswith("Z")
    parsed = datetime.fromisoformat(data["uploaded_at"])
    assert parsed.utcoffset() == timedelta(0)


def test_document_read_keeps_null_page_count() -> None:
    document = DocumentRead(
        id=1,
        subject_id=1,
        week_number=1,
        filename="scan.pdf",
        uploaded_at=datetime(2026, 11, 1),
        file_size_bytes=10,
        page_count=None,
    )

    data = document.model_dump(mode="json")
    assert data["page_count"] is None
    assert data["uploaded_at"] == "2026-11-01T00:00:00Z"
