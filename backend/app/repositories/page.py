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
