from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import config
from backend.app.routers import documents, subjects, notes

app = FastAPI()
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
