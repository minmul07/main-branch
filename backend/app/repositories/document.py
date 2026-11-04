from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.document import Document


def create_document(
    session: Session,
    *,
    subject_id: int,
    week_number: int,
    filename: str,
    stored_name: str,
    file_size_bytes: int,
    page_count: int | None,
) -> Document:
    document = Document(
        subject_id=subject_id,
        week_number=week_number,
        filename=filename,
        stored_name=stored_name,
        file_size_bytes=file_size_bytes,
        page_count=page_count,
    )
    session.add(document)
    session.flush()
    return document


def get_document(session: Session, document_id: int) -> Document | None:
    return session.get(Document, document_id)


def delete_document(session: Session, document: Document) -> None:
    session.delete(document)
    session.flush()


def list_documents_by_subject(session: Session, subject_id: int) -> list[Document]:
    return list(
        session.scalars(
            select(Document).where(Document.subject_id == subject_id).order_by(Document.id)
        )
    )
