from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

# trigram 색인은 3글자 이상만 찾을 수 있어서, 그보다 짧은 검색어는 LIKE로 찾는다.
MIN_FTS_LENGTH = 3
SNIPPET_RADIUS = 30
_COLUMNS = (
    "p.id, p.document_id, p.page_number, d.filename, d.subject_id, s.name AS subject_name, "
    "d.week_number, p.text AS page_text, p.ocr_text AS page_ocr_text"
)
_JOINS = (
    "JOIN documents d ON d.id = p.document_id JOIN subjects s ON s.id = d.subject_id"
)


@dataclass(frozen=True)
class SearchHit:
    page_id: int
    document_id: int
    page_number: int
    filename: str
    subject_id: int
    subject_name: str
    week_number: int
    snippet: str


def _window(content: str | None, query: str) -> str | None:
    """content에서 검색어를 찾아 앞뒤 글자를 한 줄로 자른다. 없으면 None이다."""
    flat = " ".join((content or "").split())
    index = flat.lower().find(query.lower())
    if index < 0:
        return None
    start = max(0, index - SNIPPET_RADIUS)
    end = min(len(flat), index + len(query) + SNIPPET_RADIUS)
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")


def make_snippet(page_text: str | None, ocr_text: str | None, query: str) -> str:
    """스니펫 기준: 1) text에서 찾으면 text 2) 없으면 ocr_text 3) 둘 다 못 찾으면 글이 있는 쪽의 앞부분.

    ocr_text가 NULL(OCR 안 한 페이지)이어도 text만으로 동작한다.
    """
    for content in (page_text, ocr_text):
        snippet = _window(content, query)
        if snippet is not None:
            return snippet
    for content in (page_text, ocr_text):
        flat = " ".join((content or "").split())
        if flat:
            return flat[: SNIPPET_RADIUS * 2]
    return ""


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_pages(
    session: Session, query: str, *, subject_id: int | None = None, limit: int = 50
) -> list[SearchHit]:
    """검색어가 들어 있는 페이지를 찾는다. 한 페이지는 text·ocr_text 어느 쪽에서 찾든 한 번만 나온다."""
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
            {_JOINS}
            WHERE page_fts MATCH :match{subject_filter}
            ORDER BY page_fts.rank, d.week_number, p.document_id, p.page_number
            LIMIT :limit
        """
    else:
        params["pattern"] = _like_pattern(query)
        sql = f"""
            SELECT {_COLUMNS}
            FROM pages p
            {_JOINS}
            WHERE (p.text LIKE :pattern ESCAPE '\\' OR p.ocr_text LIKE :pattern ESCAPE '\\'){subject_filter}
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
            subject_name=row.subject_name,
            week_number=row.week_number,
            snippet=make_snippet(row.page_text, row.page_ocr_text, query),
        )
        for row in rows
    ]