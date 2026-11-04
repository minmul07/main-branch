from collections.abc import Generator
import os
from pathlib import Path
from sqlite3 import Connection
from typing import Any

from sqlalchemy import Engine, URL, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_PATH = Path(
    os.environ.get("DATABASE_PATH")
    or Path(__file__).resolve().parent.parent / "app.db"
)


def create_sqlite_engine(database_path: Path) -> Engine:
    sqlite_engine = create_engine(
        URL.create("sqlite+pysqlite", database=str(database_path)),
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(sqlite_engine, "connect")
    def enable_foreign_keys(connection: Connection, _record: Any) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    return sqlite_engine


engine = create_sqlite_engine(DATABASE_PATH)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
