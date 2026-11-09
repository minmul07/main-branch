from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.repositories import document as document_repository
from backend.app.repositories import note as note_repository
from backend.app.schemas.note import NoteCreate, NoteRead, NoteUpdate

router = APIRouter(tags=["notes"])

# 번호는 모두 1 이상이어야 한다. 0이나 음수는 자동으로 422 오류가 난다.
DocumentId = Annotated[int, Path(gt=0)]
PageNumber = Annotated[int, Path(gt=0)]
NoteId = Annotated[int, Path(gt=0)]


def ensure_page_exists(db: Session, document_id: int, page: int) -> None:
    document = document_repository.get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    # 페이지 수를 아직 모르는 자료(page_count가 None)는 범위를 확인하지 않는다.
    if document.page_count is not None and page > document.page_count:
        raise HTTPException(status_code=404, detail="Page not found")


@router.get("/documents/{document_id}/pages/{page}/notes", response_model=list[NoteRead])
def list_notes(
    document_id: DocumentId, page: PageNumber, db: Session = Depends(get_db)
) -> list[NoteRead]:
    ensure_page_exists(db, document_id, page)
    notes = note_repository.list_notes_by_page(db, document_id, page)
    return [NoteRead.model_validate(note) for note in notes]


@router.post(
    "/documents/{document_id}/pages/{page}/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_note(
    document_id: DocumentId,
    page: PageNumber,
    payload: NoteCreate,
    db: Session = Depends(get_db),
) -> NoteRead:
    ensure_page_exists(db, document_id, page)
    try:
        note = note_repository.create_note(
            db,
            document_id=document_id,
            page_number=page,
            title=payload.title,
            content=payload.content,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(note)
    return NoteRead.model_validate(note)


@router.patch("/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: NoteId, payload: NoteUpdate, db: Session = Depends(get_db)
) -> NoteRead:
    note = note_repository.get_note(db, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    try:
        note_repository.update_note(db, note, title=payload.title, content=payload.content)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(note)
    return NoteRead.model_validate(note)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: NoteId, db: Session = Depends(get_db)) -> None:
    note = note_repository.get_note(db, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    try:
        note_repository.delete_note(db, note)
        db.commit()
    except Exception:
        db.rollback()
        raise