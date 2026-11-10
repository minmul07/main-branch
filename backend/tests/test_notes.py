from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
from httpx import Response
from pytest import fixture, mark
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models.document import Document
from backend.app.models.note import Note
from backend.app.models.subject import Subject
from backend.app.services import deletion


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


def add_document(
    engine: Engine, *, stored_name: str = "doc-1", page_count: int | None = 3
) -> int:
    """PDF 업로드 없이 DB에 과목과 자료를 직접 넣고 자료 ID를 돌려준다."""
    with sessionmaker(bind=engine)() as session:
        subject = Subject(name="운영체제")
        session.add(subject)
        session.flush()
        document = Document(
            subject_id=subject.id,
            week_number=1,
            filename="week1.pdf",
            stored_name=stored_name,
            file_size_bytes=1,
            page_count=page_count,
        )
        session.add(document)
        session.commit()
        return document.id


def notes_url(document_id: int, page: int) -> str:
    return f"/documents/{document_id}/pages/{page}/notes"


def send(client: TestClient, method: str, url: str) -> Response:
    """POST는 본문이 필수라서 빈 JSON을 함께 보낸다."""
    if method == "post":
        return client.post(url, json={})
    return client.get(url)


def test_list_notes_empty(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)

    response = client.get(notes_url(document_id, 1))

    assert response.status_code == 200
    assert response.json() == []


def test_create_note_then_listed(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)

    response = client.post(
        notes_url(document_id, 2), json={"title": "핵심", "content": "프로세스 정의"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["document_id"] == document_id
    assert body["page_number"] == 2
    assert body["title"] == "핵심"
    assert body["content"] == "프로세스 정의"
    assert body["created_at"]
    assert client.get(notes_url(document_id, 2)).json() == [body]


def test_create_note_default_title_increments(
    client: TestClient, temp_database_engine: Engine
) -> None:
    document_id = add_document(temp_database_engine)

    first = client.post(notes_url(document_id, 1), json={"content": "a"}).json()
    second = client.post(notes_url(document_id, 1), json={"title": "  ", "content": "b"}).json()
    other_page = client.post(notes_url(document_id, 2), json={}).json()

    assert first["title"] == "메모 1"
    assert second["title"] == "메모 2"
    assert other_page["title"] == "메모 1"
    assert other_page["content"] == ""


def test_create_note_strips_title(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)

    response = client.post(notes_url(document_id, 1), json={"title": "  제목  "})

    assert response.json()["title"] == "제목"


def test_notes_are_separated_by_page_and_document(
    client: TestClient, temp_database_engine: Engine
) -> None:
    first_document = add_document(temp_database_engine, stored_name="doc-1")
    second_document = add_document(temp_database_engine, stored_name="doc-2")
    client.post(notes_url(first_document, 1), json={"content": "1-1"})
    client.post(notes_url(first_document, 2), json={"content": "1-2"})
    client.post(notes_url(second_document, 1), json={"content": "2-1"})

    assert [n["content"] for n in client.get(notes_url(first_document, 1)).json()] == ["1-1"]
    assert [n["content"] for n in client.get(notes_url(first_document, 2)).json()] == ["1-2"]
    assert [n["content"] for n in client.get(notes_url(second_document, 1)).json()] == ["2-1"]


def test_notes_ordered_by_id(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)
    for content in ["처음", "중간", "마지막"]:
        client.post(notes_url(document_id, 1), json={"content": content})

    contents = [n["content"] for n in client.get(notes_url(document_id, 1)).json()]

    assert contents == ["처음", "중간", "마지막"]


def test_update_title_only_keeps_content(
    client: TestClient, temp_database_engine: Engine
) -> None:
    document_id = add_document(temp_database_engine)
    created = client.post(
        notes_url(document_id, 1), json={"title": "이전", "content": "내용"}
    ).json()

    response = client.patch(f"/notes/{created['id']}", json={"title": "  새 이름  "})

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "새 이름"
    assert body["content"] == "내용"
    assert body["updated_at"] >= created["updated_at"]
    assert client.get(notes_url(document_id, 1)).json() == [body]


def test_update_content_only_keeps_title(
    client: TestClient, temp_database_engine: Engine
) -> None:
    document_id = add_document(temp_database_engine)
    created = client.post(
        notes_url(document_id, 1), json={"title": "이름", "content": "이전"}
    ).json()

    response = client.patch(f"/notes/{created['id']}", json={"content": "새 내용"})

    assert response.status_code == 200
    assert response.json()["title"] == "이름"
    assert response.json()["content"] == "새 내용"


def test_update_can_clear_content(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)
    created = client.post(notes_url(document_id, 1), json={"content": "지울 내용"}).json()

    response = client.patch(f"/notes/{created['id']}", json={"content": ""})

    assert response.status_code == 200
    assert response.json()["content"] == ""


def test_delete_note(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine)
    keep = client.post(notes_url(document_id, 1), json={"content": "남김"}).json()
    remove = client.post(notes_url(document_id, 1), json={"content": "삭제"}).json()

    response = client.delete(f"/notes/{remove['id']}")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(notes_url(document_id, 1)).json() == [keep]


def test_notes_persist_across_sessions(
    client: TestClient, temp_database_engine: Engine
) -> None:
    document_id = add_document(temp_database_engine)
    client.post(notes_url(document_id, 1), json={"title": "저장", "content": "유지"})

    # 새 TestClient로 다시 요청해도 DB에 남아 있어야 한다.
    with TestClient(app) as other_client:
        notes = other_client.get(notes_url(document_id, 1)).json()

    assert [(n["title"], n["content"]) for n in notes] == [("저장", "유지")]


@mark.parametrize("method", ["get", "post"])
def test_notes_of_missing_document_returns_404(client: TestClient, method: str) -> None:
    response = send(client, method, notes_url(999, 1))

    assert response.status_code == 404
    assert response.json() == {"detail": "Document not found"}


@mark.parametrize("method", ["get", "post"])
def test_notes_page_beyond_page_count_returns_404(
    client: TestClient, temp_database_engine: Engine, method: str
) -> None:
    document_id = add_document(temp_database_engine, page_count=3)

    response = send(client, method, notes_url(document_id, 4))

    assert response.status_code == 404
    assert response.json() == {"detail": "Page not found"}


def test_last_page_is_allowed(client: TestClient, temp_database_engine: Engine) -> None:
    document_id = add_document(temp_database_engine, page_count=3)

    response = client.post(notes_url(document_id, 3), json={"content": "마지막 장"})

    assert response.status_code == 201


def test_page_count_unknown_skips_range_check(
    client: TestClient, temp_database_engine: Engine
) -> None:
    document_id = add_document(temp_database_engine, page_count=None)

    response = client.post(notes_url(document_id, 99), json={"content": "범위 미확인"})

    assert response.status_code == 201


@mark.parametrize("page", [0, -1, "abc", "1.5"])
def test_invalid_page_number_returns_422(
    client: TestClient, temp_database_engine: Engine, page: int | str
) -> None:
    document_id = add_document(temp_database_engine)

    assert client.get(notes_url(document_id, page)).status_code == 422  # type: ignore[arg-type]
    assert client.post(notes_url(document_id, page), json={}).status_code == 422  # type: ignore[arg-type]


@mark.parametrize(
    "payload",
    [
        {"title": 123},
        {"title": ["a"]},
        {"content": 123},
        {"content": None},
        {"title": "가" * 101},
        {"content": "가" * 10001},
    ],
    ids=["title-int", "title-list", "content-int", "content-null", "title-long", "content-long"],
)
def test_create_note_invalid_payload_returns_422(
    client: TestClient, temp_database_engine: Engine, payload: dict
) -> None:
    document_id = add_document(temp_database_engine)

    response = client.post(notes_url(document_id, 1), json=payload)

    assert response.status_code == 422
    assert client.get(notes_url(document_id, 1)).json() == []


@mark.parametrize(
    "payload",
    [
        {"title": ""},
        {"title": "   "},
        {"title": 1},
        {"title": "가" * 101},
        {"content": 1},
        {"content": "가" * 10001},
    ],
    ids=["title-empty", "title-blank", "title-int", "title-long", "content-int", "content-long"],
)
def test_update_note_invalid_payload_returns_422(
    client: TestClient, temp_database_engine: Engine, payload: dict
) -> None:
    document_id = add_document(temp_database_engine)
    created = client.post(
        notes_url(document_id, 1), json={"title": "원래", "content": "그대로"}
    ).json()

    response = client.patch(f"/notes/{created['id']}", json=payload)

    assert response.status_code == 422
    assert client.get(notes_url(document_id, 1)).json() == [created]


@mark.parametrize("method", ["patch", "delete"])
def test_missing_note_returns_404(client: TestClient, method: str) -> None:
    kwargs = {"json": {"title": "x"}} if method == "patch" else {}

    response = getattr(client, method)("/notes/9999", **kwargs)

    assert response.status_code == 404
    assert response.json() == {"detail": "Note not found"}


@mark.parametrize("method", ["patch", "delete"])
def test_invalid_note_id_returns_422(client: TestClient, method: str) -> None:
    for note_id in ["0", "-1", "abc"]:
        kwargs = {"json": {"title": "x"}} if method == "patch" else {}

        assert getattr(client, method)(f"/notes/{note_id}", **kwargs).status_code == 422


def test_delete_document_removes_its_notes_only(
    client: TestClient, temp_database_engine: Engine, tmp_path: Path
) -> None:
    first_document = add_document(temp_database_engine, stored_name="doc-1")
    second_document = add_document(temp_database_engine, stored_name="doc-2")
    client.post(notes_url(first_document, 1), json={"content": "지워질 메모"})
    keep = client.post(notes_url(second_document, 1), json={"content": "남을 메모"}).json()

    with sessionmaker(bind=temp_database_engine)() as session:
        deletion.delete_document(session, first_document, tmp_path)

    assert client.get(notes_url(first_document, 1)).status_code == 404
    assert client.get(notes_url(second_document, 1)).json() == [keep]


def test_delete_subject_removes_notes_of_its_documents(
    client: TestClient, temp_database_engine: Engine, tmp_path: Path
) -> None:
    document_id = add_document(temp_database_engine)
    client.post(notes_url(document_id, 1), json={"content": "메모"})

    with sessionmaker(bind=temp_database_engine)() as session:
        subject_id = session.get(Document, document_id).subject_id
        deletion.delete_subject(session, subject_id, tmp_path, confirmed_name="운영체제")
        remaining = session.scalar(select(func.count()).select_from(Note))

    assert remaining == 0
