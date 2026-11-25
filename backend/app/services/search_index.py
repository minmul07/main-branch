from sqlalchemy import Connection, text

# 페이지 글자를 검색용으로 저장하는 FTS5 표. rowid는 pages.id와 같고, 칸은 pages와 같은 이름이다.
# trigram은 글자를 3개씩 잘라 저장해서 "미분을"에서 "분을"처럼 중간 글자도 찾는다.
_COLUMNS = ["text", "ocr_text"]
_TRIGGERS = ("pages_fts_insert", "pages_fts_update", "pages_fts_delete")
_NEW_VALUES = "new.id, coalesce(new.text, ''), coalesce(new.ocr_text, '')"

_CREATE_STATEMENTS = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(text, ocr_text, tokenize='trigram')",
    f"""
    CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
        INSERT INTO page_fts(rowid, text, ocr_text) VALUES ({_NEW_VALUES});
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
        DELETE FROM page_fts WHERE rowid = old.id;
    END
    """,
    f"""
    CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE OF text, ocr_text ON pages BEGIN
        DELETE FROM page_fts WHERE rowid = old.id;
        INSERT INTO page_fts(rowid, text, ocr_text) VALUES ({_NEW_VALUES});
    END
    """,
    # 이미 저장된 페이지 중 아직 색인되지 않은 것만 채운다. 여러 번 실행해도 안전하다.
    """
    INSERT INTO page_fts(rowid, text, ocr_text)
    SELECT id, coalesce(text, ''), coalesce(ocr_text, '') FROM pages
    WHERE id NOT IN (SELECT rowid FROM page_fts)
    """,
]


def _drop_search_index(connection: Connection) -> None:
    for trigger in _TRIGGERS:
        connection.execute(text(f"DROP TRIGGER IF EXISTS {trigger}"))
    connection.execute(text("DROP TABLE IF EXISTS page_fts"))


def ensure_search_index(connection: Connection) -> None:
    """검색 색인 표와 동기화 trigger를 만들고 아직 색인되지 않은 페이지를 채운다.

    예전 구조(칸 이름이 다른 표)가 남아 있으면 지우고 새로 만든다.
    """
    columns = [
        row[0]
        for row in connection.execute(text("SELECT name FROM pragma_table_info('page_fts')"))
    ]
    if columns and columns != _COLUMNS:
        _drop_search_index(connection)
    for statement in _CREATE_STATEMENTS:
        connection.execute(text(statement))


def rebuild_search_index(connection: Connection) -> None:
    """색인을 모두 지우고 pages 테이블의 현재 내용으로 처음부터 다시 만든다."""
    _drop_search_index(connection)
    ensure_search_index(connection)


if __name__ == "__main__":
    # 색인이 꼬였을 때 수동으로 처음부터 다시 만든다:
    #   uv run python -m backend.app.services.search_index
    from backend.app.database import engine

    with engine.begin() as connection:
        rebuild_search_index(connection)
    print("검색 색인을 다시 만들었습니다.")