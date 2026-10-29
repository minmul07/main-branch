from collections.abc import Iterator
from pathlib import Path

from pytest import MonkeyPatch, fixture
from sqlalchemy import Engine

from backend.app import database


@fixture(autouse=True)
def temp_database_engine(tmp_path: Path, monkeypatch: MonkeyPatch) -> Iterator[Engine]:
    """테스트가 개발용 backend/app.db를 건드리지 않도록 엔진을 임시 DB로 교체한다."""
    engine = database.create_sqlite_engine(tmp_path / "app_test.db")
    monkeypatch.setattr(database, "engine", engine)
    try:
        yield engine
    finally:
        engine.dispose()
