from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from pytest import MonkeyPatch, fixture, raises
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app.database import Base, get_db
from backend.app.init_db import init_db
from backend.app.main import app
from backend.app.models.document import Document
from backend.app.models.subject import Subject
from backend.app.repositories import document as document_repository
from backend.app.repositories import page as page_repository
from backend.app.repositories.search import make_snippet, search_pages
from backend.app.services import deletion
from backend.app.services.search_index import rebuild_search_index


@fixture
def client(temp_database_engine: Engine) -> Iterator[TestClient]:
    # create_all만으로는 검색 색인(FTS5)이 만들어지지 않으므로 init_db로 DB를 준비한다.
    init_db(temp_database_engine)
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
    engine: Engine,
    pages: list[str | None],
    *,
    subject_name: str = "자료구조",
    week_number: int = 1,
    filename: str = "week1.pdf",
) -> tuple[int, int]:
    """과목·자료·페이지를 DB에 직접 넣고 (과목 ID, 자료 ID)를 돌려준다."""
    with sessionmaker(bind=engine)() as session:
        subject = Subject(name=subject_name)
        session.add(subject)
        session.flush()
        document = Document(
            subject_id=subject.id,
            week_number=week_number,
            filename=filename,
            stored_name=uuid4().hex,
            file_size_bytes=1,
            page_count=len(pages),
        )
        session.add(document)
        session.flush()
        for number, page_text in enumerate(pages, start=1):
            page_repository.create_page(
                session, document_id=document.id, page_number=number, text=page_text
            )
        session.commit()
        return subject.id, document.id


def set_ocr(engine: Engine, document_id: int, page_number: int, ocr_text: str) -> None:
    with sessionmaker(bind=engine)() as session:
        page_repository.set_page_ocr_text(
            session, document_id=document_id, page_number=page_number, ocr_text=ocr_text
        )
        session.commit()


def search(client: TestClient, q: str, **params: object) -> list[dict]:
    response = client.get("/search", params={"q": q, **params})
    assert response.status_code == 200
    return response.json()


# ---- API: 결과 항목과 입력 검증 ----


def test_search_returns_page_info_and_snippet(
    client: TestClient, temp_database_engine: Engine
) -> None:
    subject_id, document_id = add_document(
        temp_database_engine,
        ["스택과 큐", "Linked list 설명입니다"],
        week_number=3,
        filename="week3.pdf",
    )

    results = search(client, "linked")

    assert len(results) == 1
    assert results[0]["document_id"] == document_id
    assert results[0]["page_number"] == 2
    assert results[0]["subject_id"] == subject_id
    assert results[0]["subject_name"] == "자료구조"
    assert results[0]["week_number"] == 3
    assert results[0]["filename"] == "week3.pdf"
    assert isinstance(results[0]["page_id"], int)
    assert "Linked list" in results[0]["snippet"]


def test_search_ignores_case(client: TestClient, temp_database_engine: Engine) -> None:
    add_document(temp_database_engine, ["A LINKED LIST KEEPS NODES"])

    assert len(search(client, "linked")) == 1
    assert len(search(client, "LiNkEd")) == 1


def test_search_korean_words_including_short_ones(
    client: TestClient, temp_database_engine: Engine
) -> None:
    add_document(temp_database_engine, ["오늘은 미분을 배웁니다", "적분만 나옵니다"])

    three_letters = search(client, "미분을")
    two_letters = search(client, "미분")

    assert [item["page_number"] for item in three_letters] == [1]
    assert [item["page_number"] for item in two_letters] == [1]


def test_search_without_match_returns_empty_list(
    client: TestClient, temp_database_engine: Engine
) -> None:
    add_document(temp_database_engine, ["스택과 큐"])

    assert search(client, "elephant") == []
    assert search(client, "코") == []


def test_search_skips_pages_without_text(
    client: TestClient, temp_database_engine: Engine
) -> None:
    add_document(temp_database_engine, [None, "", "queue 설명"])

    results = search(client, "queue")

    assert [item["page_number"] for item in results] == [3]


def test_search_rejects_missing_or_blank_query(client: TestClient) -> None:
    assert client.get("/search").status_code == 422
    assert client.get("/search", params={"q": ""}).status_code == 422
    assert client.get("/search", params={"q": "   "}).status_code == 422


def test_search_filters_by_subject(client: TestClient, temp_database_engine: Engine) -> None:
    first_subject, _ = add_document(
        temp_database_engine, ["linked list"], subject_name="자료구조"
    )
    second_subject, _ = add_document(
        temp_database_engine, ["linked data"], subject_name="웹"
    )

    assert len(search(client, "linked")) == 2
    only_first = search(client, "linked", subject_id=first_subject)
    assert [item["subject_id"] for item in only_first] == [first_subject]
    assert search(client, "linked", subject_id=second_subject)[0]["subject_name"] == "웹"
    assert search(client, "linked", subject_id=9999) == []
    assert client.get("/search", params={"q": "linked", "subject_id": 0}).status_code == 422


def test_search_limits_result_count(client: TestClient, temp_database_engine: Engine) -> None:
    add_document(temp_database_engine, ["node one", "node two", "node three"])

    assert len(search(client, "node", limit=2)) == 2
    assert client.get("/search", params={"q": "node", "limit": 0}).status_code == 422
    assert client.get("/search", params={"q": "node", "limit": 101}).status_code == 422


def test_search_special_characters_are_plain_text(
    client: TestClient, temp_database_engine: Engine
) -> None:
    add_document(temp_database_engine, ["성공률 100% 달성", 'say "hello" now', "a_b", "abc"])

    assert [item["page_number"] for item in search(client, "100%")] == [1]
    assert [item["page_number"] for item in search(client, '"hello"')] == [2]
    # 한 글자 검색어의 _ 는 "아무 글자"가 아니라 밑줄 문자 그대로 찾는다.
    assert [item["page_number"] for item in search(client, "_")] == [3]


# ---- text·ocr_text 두 칸 ----


def test_page_matching_in_both_text_and_ocr_is_returned_once(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, ["common alpha"])
    set_ocr(temp_database_engine, document_id, 1, "common beta")

    results = search(client, "common")

    assert len(results) == 1
    assert results[0]["snippet"] == "common alpha"


def test_snippet_uses_ocr_text_when_only_ocr_matches(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, ["alpha"])
    set_ocr(temp_database_engine, document_id, 1, "common beta")

    results = search(client, "beta")

    assert len(results) == 1
    assert results[0]["snippet"] == "common beta"


def test_search_includes_ocr_text_of_pages_without_text(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, [""])
    set_ocr(temp_database_engine, document_id, 1, "scannedword")

    assert [item["page_number"] for item in search(client, "scannedword")] == [1]


def test_short_query_also_searches_ocr_text(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, [None])
    set_ocr(temp_database_engine, document_id, 1, "스캔된 미분 설명")

    assert [item["page_number"] for item in search(client, "미분")] == [1]


# ---- 색인 동기화 ----


def test_search_follows_page_text_and_ocr_changes(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, ["oldword here"])
    set_ocr(temp_database_engine, document_id, 1, "oldocr here")

    with sessionmaker(bind=temp_database_engine)() as session:
        page_repository.save_page(
            session, document_id=document_id, page_number=1, text="freshword here"
        )
        session.commit()
    set_ocr(temp_database_engine, document_id, 1, "freshocr here")

    assert search(client, "oldword") == []
    assert search(client, "oldocr") == []
    assert len(search(client, "freshword")) == 1
    assert len(search(client, "freshocr")) == 1


def test_search_forgets_deleted_pages(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, ["removable text"])
    assert len(search(client, "removable")) == 1

    with sessionmaker(bind=temp_database_engine)() as session:
        page_repository.delete_pages_by_document(session, document_id)
        session.commit()

    assert search(client, "removable") == []


def test_rolled_back_page_is_not_searchable(
    client: TestClient, temp_database_engine: Engine
) -> None:
    _, document_id = add_document(temp_database_engine, ["committed text"])

    with sessionmaker(bind=temp_database_engine)() as session:
        page_repository.create_page(
            session, document_id=document_id, page_number=2, text="rolledback text"
        )
        session.rollback()

    assert search(client, "rolledback") == []
    assert len(search(client, "committed")) == 1


def test_document_deletion_removes_only_its_search_results(
    client: TestClient, temp_database_engine: Engine, tmp_path: Path
) -> None:
    _, deleted_id = add_document(temp_database_engine, ["shared keyword one"], subject_name="가")
    add_document(temp_database_engine, ["shared keyword two"], subject_name="나")

    with sessionmaker(bind=temp_database_engine)() as session:
        deletion.delete_document(session, deleted_id, tmp_path / "uploads")

    results = search(client, "shared keyword")
    assert [item["subject_name"] for item in results] == ["나"]


def test_subject_deletion_removes_its_search_results(
    client: TestClient, temp_database_engine: Engine, tmp_path: Path
) -> None:
    subject_id, _ = add_document(temp_database_engine, ["gone keyword"], subject_name="삭제할 과목")
    add_document(temp_database_engine, ["gone keyword stays"], subject_name="남길 과목")

    with sessionmaker(bind=temp_database_engine)() as session:
        deletion.delete_subject(
            session, subject_id, tmp_path / "uploads", confirmed_name="삭제할 과목"
        )

    assert [item["subject_name"] for item in search(client, "gone keyword")] == ["남길 과목"]


def test_failed_document_deletion_keeps_search_results(
    client: TestClient,
    temp_database_engine: Engine,
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    _, document_id = add_document(temp_database_engine, ["keepable text"])

    def fail(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("boom")

    # 페이지를 지운 뒤 자료 삭제에서 실패하면 전체가 rollback되어 색인도 그대로여야 한다.
    monkeypatch.setattr(document_repository, "delete_document", fail)
    with sessionmaker(bind=temp_database_engine)() as session:
        with raises(deletion.DeletionError):
            deletion.delete_document(session, document_id, tmp_path / "uploads")

    assert len(search(client, "keepable")) == 1


# ---- 업그레이드와 재색인 ----


def test_init_db_upgrades_old_single_column_index(temp_database_engine: Engine) -> None:
    Base.metadata.create_all(temp_database_engine)
    with temp_database_engine.begin() as connection:
        connection.execute(
            text("CREATE VIRTUAL TABLE page_fts USING fts5(content, tokenize='trigram')")
        )
        connection.execute(
            text(
                "CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN "
                "INSERT INTO page_fts(rowid, content) VALUES (new.id, coalesce(new.text, '')); END"
            )
        )
    add_document(temp_database_engine, ["oldstructure page"])

    init_db(temp_database_engine)

    with sessionmaker(bind=temp_database_engine)() as session:
        hits = search_pages(session, "oldstructure")
        columns = [
            row[0]
            for row in session.execute(text("SELECT name FROM pragma_table_info('page_fts')"))
        ]
    assert columns == ["text", "ocr_text"]
    assert [hit.page_number for hit in hits] == [1]


def test_init_db_indexes_existing_pages_and_is_repeatable(temp_database_engine: Engine) -> None:
    Base.metadata.create_all(temp_database_engine)
    add_document(temp_database_engine, ["existing page text"])

    init_db(temp_database_engine)
    init_db(temp_database_engine)

    with sessionmaker(bind=temp_database_engine)() as session:
        assert len(search_pages(session, "existing")) == 1
        count = session.execute(text("SELECT count(*) FROM page_fts")).scalar_one()
    assert count == 1


def test_rebuild_restores_a_damaged_index(
    client: TestClient, temp_database_engine: Engine
) -> None:
    add_document(temp_database_engine, ["rebuildable text"])
    with temp_database_engine.begin() as connection:
        connection.execute(text("DELETE FROM page_fts"))
    assert search(client, "rebuildable") == []

    with temp_database_engine.begin() as connection:
        rebuild_search_index(connection)

    assert len(search(client, "rebuildable")) == 1


# ---- 스니펫 ----


def test_snippet_shows_context_around_query() -> None:
    content = "앞" * 100 + " target " + "뒤" * 100

    snippet = make_snippet(content, None, "target")

    assert "target" in snippet
    assert snippet.startswith("…")
    assert snippet.endswith("…")
    assert len(snippet) < len(content)


def test_snippet_prefers_text_then_ocr_then_beginning() -> None:
    assert make_snippet("a target", "b target", "target") == "a target"
    assert make_snippet("only text", "ocr target", "target") == "ocr target"
    assert make_snippet("only text", "ocr", "nothing") == "only text"
    assert make_snippet("", "ocr only", "nothing") == "ocr only"
    assert make_snippet(None, None, "nothing") == ""


def test_snippet_flattens_whitespace() -> None:
    assert make_snippet("first\n\nsecond   line", None, "second") == "first second line"