import os
from pathlib import Path
import re
import tempfile
from typing import BinaryIO
from uuid import uuid4

from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.app.models.document import Document
from backend.app.repositories import document as document_repository
from backend.app.repositories import subject as subject_repository

CHUNK_SIZE = 1024 * 1024
MAX_FILENAME_LENGTH = 255
# PDF 명세는 파일 앞 1024바이트 안에 %PDF- 헤더를 허용한다.
PDF_HEADER = b"%PDF-"
PDF_HEADER_SEARCH_BYTES = 1024


class DocumentUploadError(Exception):
    """업로드를 거부하거나 완료하지 못한 경우의 기본 예외."""


class SubjectNotFoundError(DocumentUploadError):
    pass


class InvalidFilenameError(DocumentUploadError):
    pass


class UploadTooLargeError(DocumentUploadError):
    pass


class InvalidPdfError(DocumentUploadError):
    pass


class StorageError(DocumentUploadError):
    pass


def normalize_filename(raw_filename: str | None) -> str:
    """경로 부분을 제거한 표시용 파일명을 반환한다. 저장 경로에는 사용하지 않는다."""
    if raw_filename is None:
        raise InvalidFilenameError("filename is required")
    # 클라이언트 OS에 따라 / 또는 \ 구분자가 올 수 있으므로 마지막 구분자 뒤만 남긴다.
    name = re.split(r"[\\/]", raw_filename)[-1]
    name = "".join(char for char in name if char.isprintable()).strip()
    if name in ("", ".", ".."):
        raise InvalidFilenameError("filename is empty")
    if len(name) > MAX_FILENAME_LENGTH:
        raise InvalidFilenameError(f"filename must be at most {MAX_FILENAME_LENGTH} characters")
    return name


def count_pdf_pages(path: Path) -> int:
    """유효한 비암호화 PDF의 페이지 수를 반환한다. 그 외에는 InvalidPdfError."""
    with path.open("rb") as file:
        if PDF_HEADER not in file.read(PDF_HEADER_SEARCH_BYTES):
            raise InvalidPdfError("file is not a PDF")
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise InvalidPdfError("encrypted PDF is not supported")
        page_count = len(reader.pages)
    except InvalidPdfError:
        raise
    except Exception as error:
        # pypdf는 손상 형태에 따라 다양한 예외를 던지므로 모두 파싱 실패로 본다.
        raise InvalidPdfError("PDF could not be parsed") from error
    if page_count == 0:
        raise InvalidPdfError("PDF has no pages")
    return page_count


def write_limited(source: BinaryIO, destination: BinaryIO, max_size_bytes: int) -> int:
    """source를 청크 단위로 복사하고 누적 크기가 상한을 넘으면 중단한다."""
    size = 0
    while chunk := source.read(CHUNK_SIZE):
        size += len(chunk)
        if size > max_size_bytes:
            raise UploadTooLargeError(f"file exceeds {max_size_bytes} bytes")
        destination.write(chunk)
    return size


def remove_quietly(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def upload_document(
    session: Session,
    *,
    upload_dir: Path,
    max_size_bytes: int,
    subject_id: int,
    week_number: int,
    filename: str | None,
    file: BinaryIO,
) -> Document:
    """PDF를 검증·저장하고 Document를 commit한다.

    파일 저장과 DB 기록의 트랜잭션 경계를 이 함수가 소유한다. 예외가 발생하면
    rollback하고 임시 파일과 최종 파일을 정리한 뒤 예외를 다시 던진다.
    """
    if subject_repository.get_subject(session, subject_id) is None:
        raise SubjectNotFoundError(f"subject {subject_id} not found")
    display_name = normalize_filename(filename)

    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise StorageError("upload directory is not available") from error

    temp_path: Path | None = None
    final_path: Path | None = None
    try:
        try:
            with tempfile.NamedTemporaryFile(
                dir=upload_dir, prefix=".upload-", suffix=".tmp", delete=False
            ) as temp_file:
                temp_path = Path(temp_file.name)
                size = write_limited(file, temp_file, max_size_bytes)
        except OSError as error:
            raise StorageError("failed to write upload") from error

        if size == 0:
            raise InvalidPdfError("file is empty")
        page_count = count_pdf_pages(temp_path)

        stored_name = f"{uuid4().hex}.pdf"
        try:
            os.replace(temp_path, upload_dir / stored_name)
        except OSError as error:
            raise StorageError("failed to store upload") from error
        final_path, temp_path = upload_dir / stored_name, None

        document = document_repository.create_document(
            session,
            subject_id=subject_id,
            week_number=week_number,
            filename=display_name,
            stored_name=stored_name,
            file_size_bytes=size,
            page_count=page_count,
        )
        session.commit()
    except BaseException:
        session.rollback()
        remove_quietly(temp_path)
        remove_quietly(final_path)
        raise

    session.refresh(document)
    return document


def get_document_file_path(upload_dir: Path, document: Document) -> Path | None:
    """저장된 식별자로만 원본 경로를 만들고, 파일이 없으면 None을 반환한다."""
    path = upload_dir / document.stored_name
    if path.parent != upload_dir or not path.is_file():
        return None
    return path
