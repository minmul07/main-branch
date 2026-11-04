from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy.orm import Session

from backend.app.routers.documents import UploadSettings, get_upload_settings
from backend.app.database import get_db
from backend.app.repositories import subject as subject_repository
from backend.app.schemas.subject import SubjectCreate, SubjectRead
from backend.app.schemas.document import IntegerString
from backend.app.services import deletion

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: Annotated[IntegerString, Path(gt=0)], db: Session = Depends(get_db),
    confirmed_name: str | None = Query(default=None),
    settings: UploadSettings = Depends(get_upload_settings),
) -> Response:
    try:
        deletion.delete_subject(db, subject_id, settings.upload_dir, confirmed_name)
    except deletion.TargetNotFoundError as error:
        raise HTTPException(404, detail="Subject not found.") from error
    except deletion.SubjectHasDocumentsError as error:
        raise HTTPException(409, detail="Enter the exact subject name to delete its documents too.") from error
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
