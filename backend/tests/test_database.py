from pathlib import Path

from pytest import MonkeyPatch
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from backend.app import database


def test_sqlite_connection(tmp_path: Path) -> None:
    engine = database.create_sqlite_engine(tmp_path / "test.db")
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        engine.dispose()


def test_sqlite_persistence(tmp_path: Path) -> None:
    database_path = tmp_path / "test.db"
    engine = database.create_sqlite_engine(database_path)
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE items (name TEXT NOT NULL)"))
            connection.execute(
                text("INSERT INTO items (name) VALUES (:name)"),
                {"name": "lecture"},
            )
    finally:
        engine.dispose()

    engine = database.create_sqlite_engine(database_path)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT name FROM items")).scalar_one() == "lecture"
    finally:
        engine.dispose()


def test_get_db_rolls_back_uncommitted_changes(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    engine = database.create_sqlite_engine(tmp_path / "test.db")
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=engine))
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE items (name TEXT NOT NULL)"))

        dependency = database.get_db()
        try:
            session = next(dependency)
            session.execute(
                text("INSERT INTO items (name) VALUES (:name)"),
                {"name": "lecture"},
            )
        finally:
            dependency.close()

        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM items")).scalar_one() == 0
    finally:
        engine.dispose()
