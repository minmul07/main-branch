from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.note import Note


def create_note(
    session: Session,
    *,
    document_id: int,
    page_number: int,
    title: str | None,
    content: str,
) -> Note:
    clean_title = (title or "").strip()
    if not clean_title:
        titles = set(
            session.scalars(
                select(Note.title).where(
                    Note.document_id == document_id, Note.page_number == page_number
                )
            )
        )
        # 메모를 지운 뒤에도 같은 페이지에서 기본 이름이 겹치지 않도록 다음 빈 번호를 쓴다.
        number = len(titles) + 1
        while f"{page_number}페이지 메모 {number}" in titles:
            number += 1
        clean_title = f"{page_number}페이지 메모 {number}"
    note = Note(
        document_id=document_id,
        page_number=page_number,
        title=clean_title,
        content=content,
    )
    session.add(note)
    session.flush()
    return note


def get_note(session: Session, note_id: int) -> Note | None:
    return session.get(Note, note_id)


def list_notes_by_page(session: Session, document_id: int, page_number: int) -> list[Note]:
    return list(
        session.scalars(
            select(Note)
            .where(Note.document_id == document_id, Note.page_number == page_number)
            .order_by(Note.id)
        )
    )


def list_notes_by_document(session: Session, document_id: int) -> list[Note]:
    # 페이지 옆 메모 여백은 자료의 모든 메모를 한 번에 받아 페이지별로 나눈다.
    return list(
        session.scalars(
            select(Note)
            .where(Note.document_id == document_id)
            .order_by(Note.page_number, Note.id)
        )
    )


def update_note(
    session: Session, note: Note, *, title: str | None = None, content: str | None = None
) -> Note:
    if title is not None:
        note.title = title.strip()
    if content is not None:
        note.content = content
    session.flush()
    return note


def delete_note(session: Session, note: Note) -> None:
    session.delete(note)
    session.flush()


def delete_notes_by_document(session: Session, document_id: int) -> None:
    # 자료를 삭제하기 전에 그 자료의 메모를 모두 지운다.
    session.execute(delete(Note).where(Note.document_id == document_id))