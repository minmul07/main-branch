from collections.abc import Iterator
from pathlib import Path

from pytest import FixtureRequest, MonkeyPatch, fixture
from sqlalchemy import Engine

from backend.app import config, database
from backend.app.services import ocr


@fixture(autouse=True)
def temp_database_engine(tmp_path: Path, monkeypatch: MonkeyPatch) -> Iterator[Engine]:
    """테스트가 개발용 backend/app.db를 건드리지 않도록 엔진을 임시 DB로 교체한다."""
    engine = database.create_sqlite_engine(tmp_path / "app_test.db")
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    try:
        yield engine
    finally:
        engine.dispose()


@fixture(autouse=True)
def fake_ocr(request: FixtureRequest, monkeypatch: MonkeyPatch) -> None:
    """tesseract가 없는 개발 PC에서도 테스트가 돌도록 OCR을 빈 결과로 대신한다.

    실제 tesseract가 필요한 테스트는 `@mark.real_ocr`를 붙인다.
    """
    if request.node.get_closest_marker("real_ocr") is None:
        monkeypatch.setattr(
            ocr, "recognize_pages", lambda _source, page_numbers: dict.fromkeys(page_numbers, "")
        )
