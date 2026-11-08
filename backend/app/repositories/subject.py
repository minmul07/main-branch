from sqlalchemy import Row, func, select
from sqlalchemy.orm import Session

from backend.app.models.subject import Subject
from backend.app.models.document import Document


def create_subject(session: Session, name: str) -> Subject:
    subject = Subject(name=name)
    session.add(subject)
    session.flush()
    return subject


def list_subjects(session: Session) -> list[Row[tuple[int, str, int]]]:
    statement = (
        select(Subject.id, Subject.name, func.count(Document.id).label("document_count"))
        .outerjoin(Document, Document.subject_id == Subject.id)
        .group_by(Subject.id, Subject.name)
        .order_by(Subject.id)
    )
    return list(session.execute(statement))


def get_subject(session: Session, subject_id: int) -> Subject | None:
    return session.get(Subject, subject_id)


def delete_subject(session: Session, subject: Subject) -> None:
    session.delete(subject)
    session.flush()
