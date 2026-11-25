from sqlalchemy import Connection, text

# 페이지 글자(text, ocr_text)를 검색용으로 저장하는 FTS5 표. rowid는 pages.id와 같다.
# trigram은 글자를 3개씩 잘라 저장해서 "미분을"에서 "분을"처럼 중간 글자도 찾는다.
_PAGE_CONTENT = "coalesce({row}.text, '') || char(10) || coalesce({row}.ocr_text, '')"

_STATEMENTS = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(content, tokenize='trigram')",
    f"""
    CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
        INSERT INTO page_fts(rowid, content) VALUES (new.id, {_PAGE_CONTENT.format(row='new')});
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
        INSERT INTO page_fts(rowid, content) VALUES (new.id, {_PAGE_CONTENT.format(row='new')});
    END
    """,
    # 이미 저장된 페이지 중 아직 색인되지 않은 것만 채운다. 여러 번 실행해도 안전하다.
    f"""
    INSERT INTO page_fts(rowid, content)
    SELECT id, {_PAGE_CONTENT.format(row='pages')} FROM pages
    WHERE id NOT IN (SELECT rowid FROM page_fts)
    """,
]


def ensure_search_index(connection: Connection) -> None:
    """검색 색인 표와 동기화 trigger를 만들고 기존 페이지를 색인한다."""
    for statement in _STATEMENTS:
        connection.execute(text(statement))