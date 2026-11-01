from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path as PathParam,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from backend.app import config
from backend.app.database import get_db
from backend.app.models.document import Document
from backend.app.repositories import document as document_repository
from backend.app.repositories import subject as subject_repository
from backend.app.schemas.document import DocumentRead, IntegerString
from backend.app.services import documents as document_service

# multipart 경계와 subject_id·week_number 필드가 차지하는 여유분.
MULTIPART_OVERHEAD_BYTES = 64 * 1024


@dataclass(frozen=True)
class UploadSettings:
    upload_dir: Path
    max_size_bytes: int


def get_upload_settings() -> UploadSettings:
    return UploadSettings(
        upload_dir=config.UPLOAD_DIR, max_size_bytes=config.MAX_UPLOAD_SIZE_BYTES
    )


class UploadSizeLimitRoute(APIRoute):
    """multipart 본문을 받기 전에 Content-Length로 확실히 큰 요청을 413으로 거부한다.

    FastAPI는 endpoint 실행 전에 본문 전체를 임시 파일로 받으므로 dependency로는
    이를 막을 수 없다. 실제 바이트 수 검사는 업로드 서비스가 다시 수행한다.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def limited_handler(request: Request) -> Response:
            if request.method == "POST":
                provider = request.app.dependency_overrides.get(
                    get_upload_settings, get_upload_settings
                )
                limit = provider().max_size_bytes + MULTIPART_OVERHEAD_BYTES
                content_length = request.headers.get("content-length", "")
                if content_length.isdigit() and int(content_length) > limit:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail="Uploaded file is too large.",
                    )
            return await handler(request)

        return limited_handler


router = APIRouter(prefix="/documents", tags=["documents"], route_class=UploadSizeLimitRoute)


def get_document_or_404(db: Session, document_id: int) -> Document:
    document = document_repository.get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: Annotated[UploadFile, File()],
    subject_id: Annotated[IntegerString, Form(gt=0)],
    week_number: Annotated[IntegerString, Form(gt=0)],
    db: Session = Depends(get_db),
    settings: UploadSettings = Depends(get_upload_settings),
) -> DocumentRead:
    try:
        document = document_service.upload_document(
            db,
            upload_dir=settings.upload_dir,
            max_size_bytes=settings.max_size_bytes,
            subject_id=subject_id,
            week_number=week_number,
            filename=file.filename,
            file=file.file,
        )
    except document_service.SubjectNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Subject not found.") from error
    except document_service.UploadTooLargeError as error:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large."
        ) from error
    except document_service.InvalidFilenameError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid filename."
        ) from error
    except document_service.InvalidPdfError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid PDF: {error}."
        ) from error
    except document_service.StorageError as error:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store the file."
        ) from error
    return DocumentRead.model_validate(document)


@router.get("", response_model=list[DocumentRead])
def list_documents(
    subject_id: Annotated[IntegerString, Query(gt=0)], db: Session = Depends(get_db)
) -> list[DocumentRead]:
    if subject_repository.get_subject(db, subject_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Subject not found.")
    documents = document_repository.list_documents_by_subject(db, subject_id)
    return [DocumentRead.model_validate(document) for document in documents]


@router.get("/{document_id}", response_model=DocumentRead)
def get_document(
    document_id: Annotated[IntegerString, PathParam(gt=0)], db: Session = Depends(get_db)
) -> DocumentRead:
    return DocumentRead.model_validate(get_document_or_404(db, document_id))


@router.get(
    "/{document_id}/file",
    response_class=FileResponse,
    responses={200: {"content": {"application/pdf": {}}}},
)
def get_document_file(
    document_id: Annotated[IntegerString, PathParam(gt=0)],
    db: Session = Depends(get_db),
    settings: UploadSettings = Depends(get_upload_settings),
) -> FileResponse:
    document = get_document_or_404(db, document_id)
    path = document_service.get_document_file_path(settings.upload_dir, document)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Original file not found.")
    # FileResponse가 Content-Length·Accept-Ranges를 채우고 Range 요청(206/416)을 처리한다.
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=document.filename,
        content_disposition_type="inline",
    )
