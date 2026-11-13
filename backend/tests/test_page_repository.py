from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

from pytest import fixture, mark, raises
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app import database
from backend.app.init_db import init_db
from backend.app.models.document import Document
from backend.app.models.note import Note
from backend.app.models.subject import Subject
from backend.app.repositories.document import create_document
from backend.app.repositories.page import (
    create_page,
    delete_pages_by_document,
    get_page,
    list_pages_by_document,
)
from backend.app.repositories.subject import create_subject


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


def add_document(session: Session, subject_id: int) -> Document:
    return create_document(
        session,
        subject_id=subject_id,
        week_number=1,
        filename="1주차.pdf",
        stored_name=f"{uuid4().hex}.pdf",
        file_size_bytes=1024,
        page_count=3,
    )


@fixture
def document_ids(engine: Engine) -> list[int]:
    with Session(engine) as session:
        subject = create_subject(session, "운영체제")
        documents = [add_document(session, subject.id) for _ in range(2)]
        session.commit()
        return [document.id for document in documents]


def count_pages(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(text("SELECT COUNT(*) FROM pages")).scalar_one()


def test_create_page_returns_page_with_id(engine: Engine, document_ids: list[int]) -> None:
    with Session(engine) as session:
        page = create_page(session, document_id=document_ids[0], page_number=1, text="프로세스")

        assert page.id is not None
        assert page.document_id == document_ids[0]
        assert page.page_number == 1
        assert page.text == "프로세스"


def test_text_keeps_null_and_empty_string_distinct(
    engine: Engine, document_ids: list[int]
) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1)
        create_page(session, document_id=document_ids[0], page_number=2, text="")
        session.commit()

    with Session(engine) as session:
        assert [page.text for page in list_pages_by_document(session, document_ids[0])] == [
            None,
            "",
        ]


def test_create_page_does_not_commit(engine: Engine, document_ids: list[int]) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1)

        assert count_pages(engine) == 0


def test_rollback_discards_created_page(engine: Engine, document_ids: list[int]) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1)
        session.rollback()

    assert count_pages(engine) == 0


def test_get_page_by_document_and_page_number(
    engine: Engine, document_ids: list[int]
) -> None:
    first, second = document_ids
    with Session(engine) as session:
        create_page(session, document_id=first, page_number=1, text="first-1")
        create_page(session, document_id=second, page_number=1, text="second-1")
        session.commit()

    with Session(engine) as session:
        page = get_page(session, first, 1)
        assert page is not None
        assert page.text == "first-1"
        assert get_page(session, second, 1).text == "second-1"
        assert get_page(session, first, 2) is None


def test_list_pages_by_document_separates_and_orders_by_page_number(
    engine: Engine, document_ids: list[int]
) -> None:
    first, second = document_ids
    with Session(engine) as session:
        for number in [3, 1, 2]:
            create_page(session, document_id=first, page_number=number)
        create_page(session, document_id=second, page_number=1)
        session.commit()

    with Session(engine) as session:
        pages = list_pages_by_document(session, first)
        assert [page.page_number for page in pages] == [1, 2, 3]
        assert [page.page_number for page in list_pages_by_document(session, second)] == [1]


def test_list_pages_by_document_returns_empty_list(
    engine: Engine, document_ids: list[int]
) -> None:
    with Session(engine) as session:
        assert list_pages_by_document(session, document_ids[0]) == []


def test_page_number_must_be_unique_per_document(
    engine: Engine, document_ids: list[int]
) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1)
        # 다른 문서의 같은 페이지 번호는 허용한다.
        create_page(session, document_id=document_ids[1], page_number=1)
        with raises(IntegrityError):
            create_page(session, document_id=document_ids[0], page_number=1)


@mark.parametrize("page_number", [0, -1], ids=["zero", "negative"])
def test_page_number_must_be_positive(
    engine: Engine, document_ids: list[int], page_number: int
) -> None:
    with Session(engine) as session:
        with raises(IntegrityError):
            create_page(session, document_id=document_ids[0], page_number=page_number)


def test_page_requires_existing_document(engine: Engine, document_ids: list[int]) -> None:
    with Session(engine) as session:
        with raises(IntegrityError):
            create_page(session, document_id=max(document_ids) + 1, page_number=1)


def test_document_with_pages_cannot_be_deleted_alone(
    engine: Engine, document_ids: list[int]
) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1)
        session.commit()

    with Session(engine) as session:
        session.delete(session.get(Document, document_ids[0]))
        with raises(IntegrityError):
            session.commit()


def test_delete_pages_by_document_keeps_other_documents(
    engine: Engine, document_ids: list[int]
) -> None:
    first, second = document_ids
    with Session(engine) as session:
        create_page(session, document_id=first, page_number=1)
        create_page(session, document_id=first, page_number=2)
        create_page(session, document_id=second, page_number=1)
        session.commit()

    with Session(engine) as session:
        delete_pages_by_document(session, first)
        session.commit()

    with Session(engine) as session:
        assert list_pages_by_document(session, first) == []
        assert len(list_pages_by_document(session, second)) == 1


def test_committed_page_persists_after_reconnect(
    engine: Engine, database_path: Path, document_ids: list[int]
) -> None:
    with Session(engine) as session:
        create_page(session, document_id=document_ids[0], page_number=1, text="스케줄링")
        session.commit()
    engine.dispose()

    new_engine = database.create_sqlite_engine(database_path)
    try:
        with Session(new_engine) as session:
            assert get_page(session, document_ids[0], 1).text == "스케줄링"
    finally:
        new_engine.dispose()


def test_init_db_upgrades_existing_database_without_pages(tmp_path: Path) -> None:
    """#28 이전 스키마(pages 없음)로 만든 DB에 init_db를 실행해도 기존 데이터가 유지된다."""
    engine = database.create_sqlite_engine(tmp_path / "legacy.db")
    try:
        database.Base.metadata.create_all(
            engine, tables=[Subject.__table__, Document.__table__, Note.__table__]
        )
        assert "pages" not in inspect(engine).get_table_names()
        with Session(engine) as session:
            subject = create_subject(session, "자료구조")
            document = add_document(session, subject.id)
            session.add(Note(document_id=document.id, page_number=1, title="메모 1"))
            session.commit()
            document_id = document.id

        init_db(engine)
        init_db(engine)  # 재실행해도 안전해야 한다.

        assert "pages" in inspect(engine).get_table_names()
        with Session(engine) as session:
            assert session.get(Document, document_id).filename == "1주차.pdf"
            assert [s.name for s in session.query(Subject)] == ["자료구조"]
            assert session.query(Note).count() == 1
            create_page(session, document_id=document_id, page_number=1, text="트리")
            session.commit()

        init_db(engine)
        with Session(engine) as session:
            assert get_page(session, document_id, 1).text == "트리"
    finally:
        engine.dispose()
