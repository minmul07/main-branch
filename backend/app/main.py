import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import Event

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import config, database
from backend.app.routers import documents, subjects, notes
from backend.app.services import document_processing


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    engine = database.engine
    await asyncio.to_thread(document_processing.recover_interrupted_jobs, engine)
    stop = Event()
    worker = asyncio.create_task(
        asyncio.to_thread(document_processing.run_worker, engine, config.UPLOAD_DIR, stop)
    )
    try:
        yield
    finally:
        stop.set()
        await worker


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(config.CORS_ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Range"],
    expose_headers=["Content-Disposition", "Accept-Ranges", "Content-Range"],
)
app.include_router(subjects.router)
app.include_router(documents.router)
app.include_router(notes.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
