from sqlalchemy import delete, func, select
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
        count = session.scalar(
            select(func.count())
            .select_from(Note)
            .where(Note.document_id == document_id, Note.page_number == page_number)
        )
        clean_title = f"메모 {count + 1}"
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