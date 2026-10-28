from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app import database
from backend.app.models import Subject  # noqa: F401  테이블 등록
from backend.app.routers import subjects


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    database.Base.metadata.create_all(bind=database.engine)
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(subjects.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
