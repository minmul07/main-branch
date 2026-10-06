from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.subject import Subject


def create_subject(session: Session, name: str) -> Subject:
    subject = Subject(name=name)
    session.add(subject)
    session.flush()
    return subject


def list_subjects(session: Session) -> list[Subject]:
    return list(session.scalars(select(Subject).order_by(Subject.id)))
