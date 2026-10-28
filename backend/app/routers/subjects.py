from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.repositories import subject as subject_repository
from backend.app.schemas.subject import SubjectCreate, SubjectRead

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.get("", response_model=list[SubjectRead])
def list_subjects(db: Session = Depends(get_db)) -> list[SubjectRead]:
    subjects = subject_repository.list_subjects(db)
    return [SubjectRead.model_validate(subject) for subject in subjects]


@router.post("", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)) -> SubjectRead:
    subject = subject_repository.create_subject(db, payload.name)
    db.commit()
    db.refresh(subject)
    return SubjectRead.model_validate(subject)
