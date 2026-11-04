from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.repositories import subject as subject_repository
from backend.app.schemas.subject import SubjectCreate, SubjectRead
from backend.app.schemas.document import IntegerString
from backend.app.services import deletion

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: Annotated[IntegerString, Path(gt=0)], db: Session = Depends(get_db)
) -> Response:
    try:
        deletion.delete_subject(db, subject_id)
    except deletion.TargetNotFoundError as error:
        raise HTTPException(404, detail="Subject not found.") from error
    except deletion.SubjectHasDocumentsError as error:
        raise HTTPException(409, detail="Delete the subject's documents first.") from error
    except deletion.DeletionError as error:
        raise HTTPException(500, detail="Failed to delete subject.") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[SubjectRead])
def list_subjects(db: Session = Depends(get_db)) -> list[SubjectRead]:
    subjects = subject_repository.list_subjects(db)
    return [SubjectRead.model_validate(subject) for subject in subjects]


@router.post("", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)) -> SubjectRead:
    try:
        subject = subject_repository.create_subject(db, payload.name)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(subject)
    return SubjectRead.model_validate(subject)
