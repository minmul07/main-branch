import os
from pathlib import Path

DEFAULT_MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024
DEFAULT_CORS_ALLOWED_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")


def parse_max_upload_size(value: str | None) -> int:
    if not value:
        return DEFAULT_MAX_UPLOAD_SIZE_BYTES
    size = int(value)
    if size <= 0:
        raise ValueError("MAX_UPLOAD_SIZE_BYTES must be a positive integer")
    return size


def parse_cors_origins(value: str | None) -> tuple[str, ...]:
    if not value:
        return DEFAULT_CORS_ALLOWED_ORIGINS
    return tuple(origin.strip() for origin in value.split(",") if origin.strip())


UPLOAD_DIR = Path(
    os.environ.get("UPLOAD_DIR")
    or Path(__file__).resolve().parent.parent / "uploads"
)
MAX_UPLOAD_SIZE_BYTES = parse_max_upload_size(os.environ.get("MAX_UPLOAD_SIZE_BYTES"))
CORS_ALLOWED_ORIGINS = parse_cors_origins(os.environ.get("CORS_ALLOWED_ORIGINS"))
