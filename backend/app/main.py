from fastapi import FastAPI

from backend.app.routers import subjects

app = FastAPI()
app.include_router(subjects.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
