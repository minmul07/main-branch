from collections.abc import Iterator

from fastapi.testclient import TestClient
from pytest import fixture, mark
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models.subject import Subject


@fixture
def client(temp_database_engine: Engine) -> Iterator[TestClient]:
    Base.metadata.create_all(bind=temp_database_engine)
    testing_session = sessionmaker(bind=temp_database_engine)

    def override_get_db() -> Iterator[Session]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_list_subjects_empty(client: TestClient) -> None:
    response = client.get("/subjects")

    assert response.status_code == 200
    assert response.json() == []


def test_create_subject_then_listed(client: TestClient) -> None:
    response = client.post("/subjects", json={"name": "운영체제"})

    assert response.status_code == 201
    body = response.json()
    assert isinstance(body["id"], int)
    assert body == {"id": body["id"], "name": "운영체제"}
    assert client.get("/subjects").json() == [body]


def test_create_subject_strips_whitespace(client: TestClient) -> None:
    response = client.post("/subjects", json={"name": "  자료구조  "})

    assert response.status_code == 201
    assert response.json()["name"] == "자료구조"
    assert client.get("/subjects").json()[0]["name"] == "자료구조"


@mark.parametrize(
    "payload",
    [
        {},
        {"name": None},
        {"name": 123},
        {"name": ["과목"]},
        {"name": ""},
        {"name": "   "},
        {"name": "가" * 101},
    ],
    ids=["missing", "null", "int", "list", "empty", "blank", "too-long"],
)
def test_create_subject_invalid_name(client: TestClient, payload: dict) -> None:
    response = client.post("/subjects", json=payload)

    assert response.status_code == 422
    assert client.get("/subjects").json() == []


def test_create_subject_max_length(client: TestClient) -> None:
    name = "가" * 100
    response = client.post("/subjects", json={"name": name})

    assert response.status_code == 201
    assert response.json()["name"] == name


def test_duplicate_names_allowed_and_ordered_by_id(client: TestClient) -> None:
    ids = [client.post("/subjects", json={"name": name}).json()["id"] for name in ["B", "A", "A"]]

    assert len(set(ids)) == 3
    listed = client.get("/subjects").json()
    assert [item["id"] for item in listed] == sorted(ids)
    assert [item["name"] for item in listed] == ["B", "A", "A"]


def test_created_subject_persisted(client: TestClient, temp_database_engine: Engine) -> None:
    created = client.post("/subjects", json={"name": "컴퓨터구조"}).json()

    with Session(temp_database_engine) as session:
        stored = session.scalars(select(Subject).where(Subject.id == created["id"])).one()
        assert stored.name == "컴퓨터구조"
