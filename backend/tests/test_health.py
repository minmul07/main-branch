from fastapi.testclient import TestClient
from sqlalchemy import Engine

from backend.app.init_db import init_db
from backend.app.main import app


def test_health(temp_database_engine: Engine) -> None:
    init_db(temp_database_engine)
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
