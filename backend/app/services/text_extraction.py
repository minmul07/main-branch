"""업로드된 PDF의 물리 페이지별 텍스트를 추출해 Page 테이블에 저장한다."""

from pathlib import Path

from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.app.models.page import Page
from backend.app.repositories import document as document_repository
from backend.app.repositories import page as page_repository
from backend.app.services.documents import (
    PDF_HEADER,
    PDF_HEADER_SEARCH_BYTES,
    get_document_file_path,
)


class TextExtractionError(Exception):
    """PDF 텍스트 추출을 완료하지 못한 경우의 기본 예외."""


class DocumentNotFoundError(TextExtractionError):
    pass


class DocumentFileNotFoundError(TextExtractionError):
    pass


class InvalidPdfFileError(TextExtractionError):
    pass


def normalize_extracted_text(raw_text: str | None) -> str:
    """추출한 원문에서 NUL 문자를 제거하고 공백만 있는 페이지는 빈 문자열로 통일한다."""
    if raw_text is None:
        return ""
    cleaned = raw_text.replace("\x00", "")
    if cleaned.strip() == "":
        return ""
    return cleaned


def is_page_extracted(page: Page) -> bool:
    """페이지 텍스트 추출이 끝났는지 반환한다. None은 추출 전, 빈 문자열은 추출 완료다."""
    return page.text is not None


def has_page_text(page: Page) -> bool:
    """페이지에 공백 이외의 추출 텍스트가 있는지 반환한다."""
    return page.text is not None and page.text.strip() != ""


def read_pdf_page_texts(path: Path) -> list[str]:
    """PDF 파일의 물리 페이지 순서대로 정규화된 텍스트 목록을 반환한다."""
    with path.open("rb") as file:
        if PDF_HEADER not in file.read(PDF_HEADER_SEARCH_BYTES):
            raise InvalidPdfFileError("file is not a PDF")
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise InvalidPdfFileError("encrypted PDF is not supported")
        if len(reader.pages) == 0:
            raise InvalidPdfFileError("PDF has no pages")
        return [normalize_extracted_text(page.extract_text()) for page in reader.pages]
    except InvalidPdfFileError:
        raise
    except Exception as error:
        raise InvalidPdfFileError("PDF text could not be extracted") from error


def extract_document_pages(
    session: Session, document_id: int, *, upload_dir: Path
) -> list[Page]:
    """자료 원본 PDF에서 페이지별 텍스트를 추출해 Page 행을 저장·갱신하고 commit한다."""
    document = document_repository.get_document(session, document_id)
    if document is None:
        raise DocumentNotFoundError(f"document {document_id} not found")

    path = get_document_file_path(upload_dir, document)
    if path is None:
        raise DocumentFileNotFoundError(f"document {document_id} file not found")

    page_texts = read_pdf_page_texts(path)
    if document.page_count is not None and document.page_count != len(page_texts):
        raise InvalidPdfFileError(
            f"PDF page count {len(page_texts)} does not match document page_count {document.page_count}"
        )

    try:
        if document.page_count is None:
            document.page_count = len(page_texts)
        for page_number, page_text in enumerate(page_texts, start=1):
            page_repository.save_page(
                session, document_id=document.id, page_number=page_number, text=page_text
            )
        session.commit()
    except BaseException:
        session.rollback()
        raise

    return page_repository.list_pages_by_document(session, document.id)
