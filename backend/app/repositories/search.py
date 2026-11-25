from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

# trigram 색인은 3글자 이상만 찾을 수 있어서, 그보다 짧은 검색어는 LIKE로 찾는다.
MIN_FTS_LENGTH = 3
SNIPPET_RADIUS = 30
_CONTENT = "coalesce(p.text, '') || char(10) || coalesce(p.ocr_text, '')"
_COLUMNS = (
    f"p.id, p.document_id, p.page_number, d.filename, d.subject_id, d.week_number, {_CONTENT} AS content"
)


@dataclass(frozen=True)
class SearchHit:
    page_id: int
    document_id: int
    page_number: int
    filename: str
    subject_id: int
    week_number: int
    snippet: str


def make_snippet(content: str, query: str) -> str:
    """검색어 앞뒤 글자를 잘라 한 줄 문맥을 만든다."""
    flat = " ".join(content.split())
    index = flat.lower().find(query.lower())
    if index < 0:
        return flat[: SNIPPET_RADIUS * 2]
    start = max(0, index - SNIPPET_RADIUS)
    end = min(len(flat), index + len(query) + SNIPPET_RADIUS)
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_pages(
    session: Session, query: str, *, subject_id: int | None = None, limit: int = 50
) -> list[SearchHit]:
    """검색어가 들어 있는 페이지를 찾는다. 결과가 없으면 빈 목록이다."""
    query = query.strip()
    if not query:
        return []
    params: dict[str, object] = {"limit": limit}
    subject_filter = ""
    if subject_id is not None:
        subject_filter = " AND d.subject_id = :subject_id"
        params["subject_id"] = subject_id
    if len(query) >= MIN_FTS_LENGTH:
        # 따옴표로 감싸 검색어 전체를 하나의 구절로 찾는다. 안의 따옴표는 두 번 써서 이스케이프한다.
        params["match"] = '"' + query.replace('"', '""') + '"'
        sql = f"""
            SELECT {_COLUMNS}
            FROM page_fts
            JOIN pages p ON p.id = page_fts.rowid
            JOIN documents d ON d.id = p.document_id
            WHERE page_fts MATCH :match{subject_filter}
            ORDER BY page_fts.rank, d.week_number, p.document_id, p.page_number
            LIMIT :limit
        """
    else:
        params["pattern"] = _like_pattern(query)
        sql = f"""
            SELECT {_COLUMNS}
            FROM pages p
            JOIN documents d ON d.id = p.document_id
            WHERE ({_CONTENT}) LIKE :pattern ESCAPE '\\'{subject_filter}
            ORDER BY d.week_number, p.document_id, p.page_number
            LIMIT :limit
        """
    rows = session.execute(text(sql), params).all()
    return [
        SearchHit(
            page_id=row.id,
            document_id=row.document_id,
            page_number=row.page_number,
            filename=row.filename,
            subject_id=row.subject_id,
            week_number=row.week_number,
            snippet=make_snippet(row.content, query),
        )
        for row in rows
    ]