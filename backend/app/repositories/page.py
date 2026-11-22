from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.page import Page


def create_page(
    session: Session, *, document_id: int, page_number: int, text: str | None = None
) -> Page:
    page = Page(document_id=document_id, page_number=page_number, text=text)
    session.add(page)
    session.flush()
    return page


def save_page(
    session: Session, *, document_id: int, page_number: int, text: str | None = None
) -> Page:
    """페이지를 생성하거나 기존 페이지의 텍스트를 갱신한 뒤 flush한다."""
    page = get_page(session, document_id, page_number)
    if page is None:
        return create_page(
            session, document_id=document_id, page_number=page_number, text=text
        )
    page.text = text
    session.flush()
    return page


def set_page_ocr_text(
    session: Session, *, document_id: int, page_number: int, ocr_text: str
) -> None:
    """저장된 페이지의 OCR 결과를 갱신한 뒤 flush한다. 페이지가 없으면 아무것도 하지 않는다."""
    page = get_page(session, document_id, page_number)
    if page is not None:
        page.ocr_text = ocr_text
        session.flush()


def get_page(session: Session, document_id: int, page_number: int) -> Page | None:
    return session.scalar(
        select(Page).where(Page.document_id == document_id, Page.page_number == page_number)
    )


def list_pages_by_document(session: Session, document_id: int) -> list[Page]:
    return list(
        session.scalars(
            select(Page).where(Page.document_id == document_id).order_by(Page.page_number)
        )
    )


def delete_pages_by_document(session: Session, document_id: int) -> None:
    # 자료를 삭제하기 전에 그 자료의 페이지를 모두 지운다.
    session.execute(delete(Page).where(Page.document_id == document_id))


def delete_pages_beyond_count(
    session: Session, *, document_id: int, page_count: int
) -> None:
    session.execute(
        delete(Page).where(Page.document_id == document_id, Page.page_number > page_count)
    )
