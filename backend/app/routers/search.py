from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.repositories import search as search_repository
from backend.app.schemas.search import SearchResult

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[SearchResult])
def search_pages(
    q: Annotated[str, Query(min_length=1, max_length=100)],
    subject_id: Annotated[int | None, Query(gt=0)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    db: Session = Depends(get_db),
) -> list[SearchResult]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="q must not be blank")
    hits = search_repository.search_pages(db, query, subject_id=subject_id, limit=limit)
    return [SearchResult.model_validate(hit) for hit in hits]