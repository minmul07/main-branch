from collections.abc import Generator
from pathlib import Path

from pytest import fixture
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from backend.app import database
from backend.app.init_db import init_db
from backend.app.repositories.subject import create_subject, list_subjects


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


def count_subjects(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(text("SELECT COUNT(*) FROM subjects")).scalar_one()


def test_init_db_keeps_existing_data(engine: Engine) -> None:
    with Session(engine) as session:
        create_subject(session, "자료구조")
        session.commit()

    init_db(engine)

    with Session(engine) as session:
        assert [subject.name for subject in list_subjects(session)] == ["자료구조"]


def test_create_subject_returns_subject_with_id(engine: Engine) -> None:
    with Session(engine) as session:
        subject = create_subject(session, "자료구조")

        assert subject.id is not None
        assert subject.name == "자료구조"


def test_create_subject_allows_duplicate_names(engine: Engine) -> None:
    with Session(engine) as session:
        first = create_subject(session, "자료구조")
        second = create_subject(session, "자료구조")

        assert first.id != second.id


def test_create_subject_does_not_commit(engine: Engine) -> None:
    with Session(engine) as session:
        create_subject(session, "자료구조")

        assert count_subjects(engine) == 0


def test_list_subjects_returns_empty_list(engine: Engine) -> None:
    with Session(engine) as session:
        assert list_subjects(session) == []


def test_list_subjects_orders_by_id(engine: Engine) -> None:
    with Session(engine) as session:
        for name in ["운영체제", "자료구조", "오픈소스"]:
            create_subject(session, name)
        session.commit()

    with Session(engine) as session:
        subjects = list_subjects(session)

    assert [subject.id for subject in subjects] == sorted(subject.id for subject in subjects)
    assert [subject.name for subject in subjects] == ["운영체제", "자료구조", "오픈소스"]


def test_committed_subject_persists_after_reconnect(engine: Engine, database_path: Path) -> None:
    with Session(engine) as session:
        create_subject(session, "자료구조")
        session.commit()
    engine.dispose()

    new_engine = database.create_sqlite_engine(database_path)
    try:
        with Session(new_engine) as session:
            assert [subject.name for subject in list_subjects(session)] == ["자료구조"]
    finally:
        new_engine.dispose()


def test_rollback_discards_created_subject(engine: Engine) -> None:
    with Session(engine) as session:
        create_subject(session, "자료구조")
        session.rollback()

        assert list_subjects(session) == []

    assert count_subjects(engine) == 0
