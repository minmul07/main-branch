from collections.abc import Generator
import os
from pathlib import Path

from sqlalchemy import Engine, URL, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_PATH = Path(
    os.environ.get("DATABASE_PATH")
    or Path(__file__).resolve().parent.parent / "app.db"
)


def create_sqlite_engine(database_path: Path) -> Engine:
    return create_engine(
        URL.create("sqlite+pysqlite", database=str(database_path)),
        connect_args={"check_same_thread": False},
    )


engine = create_sqlite_engine(DATABASE_PATH)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
