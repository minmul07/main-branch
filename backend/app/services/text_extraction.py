"""업로드된 PDF의 물리 페이지별 텍스트를 추출해 Page 테이블에 저장한다."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

from pypdf import PageObject, PdfReader
from sqlalchemy.orm import Session

from backend.app.models.document import Document
from backend.app.models.document_processing import PageKind
from backend.app.models.page import Page
from backend.app.repositories import document as document_repository
from backend.app.repositories import page as page_repository
from backend.app.services.documents import (
    PDF_HEADER,
    PDF_HEADER_SEARCH_BYTES,
    get_document_file_path,
)

PAINT_OPERATORS = {b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"sh"}
TEXT_SHOW_OPERATORS = {b"Tj", b"TJ", b"'", b'"'}


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
    return _read_pdf_pages(path, lambda page: normalize_extracted_text(page.extract_text()))


def read_pdf_page_results(source: Path | BytesIO) -> list[tuple[str, PageKind]]:
    """페이지별 텍스트와 OCR 후보 판별에 사용할 분류를 함께 읽는다."""

    def read_page(page: PageObject) -> tuple[str, PageKind]:
        text = normalize_extracted_text(page.extract_text())
        return text, _classify_page(page, text)

    return _read_pdf_pages(source, read_page)


def _read_pdf_pages[T](source: Path | BytesIO, read_page: Callable[[PageObject], T]) -> list[T]:
    stream = BytesIO(source.read_bytes()) if isinstance(source, Path) else source
    stream.seek(0)
    if PDF_HEADER not in stream.read(PDF_HEADER_SEARCH_BYTES):
        raise InvalidPdfFileError("file is not a PDF")
    stream.seek(0)
    try:
        reader = PdfReader(stream)
        if reader.is_encrypted:
            raise InvalidPdfFileError("encrypted PDF is not supported")
        if len(reader.pages) == 0:
            raise InvalidPdfFileError("PDF has no pages")
        return [read_page(page) for page in reader.pages]
    except (InvalidPdfFileError, OSError):
        raise
    except Exception as error:
        raise InvalidPdfFileError("PDF text could not be extracted") from error


def _classify_page(page: PageObject, text: str) -> PageKind:
    has_image = False
    has_unknown_object = False
    has_other_content = "/Annots" in page and bool(page["/Annots"])
    contents = page.get_contents()
    for operands, operator in contents.operations if contents is not None else ():
        if operator == b"INLINE IMAGE":
            has_image = True
        elif operator == b"Do":
            resources = page["/Resources"] if "/Resources" in page else {}
            xobjects = resources["/XObject"] if "/XObject" in resources else {}
            if (
                operands
                and operands[0] in xobjects
                and xobjects[operands[0]].get("/Subtype") == "/Image"
            ):
                has_image = True
            else:
                # Form XObject나 의미를 알 수 없는 참조는 보수적으로 분류한다.
                has_unknown_object = True
        elif operator in PAINT_OPERATORS:
            has_other_content = True
        elif operator in TEXT_SHOW_OPERATORS and operands:
            strings = operands[-1] if operator == b"TJ" else (operands[-1],)
            has_other_content |= any(
                isinstance(item, (str, bytes)) and bool(item.strip()) for item in strings
            )

    if has_image:
        return PageKind.MIXED if text else PageKind.IMAGE
    if has_unknown_object:
        return PageKind.UNKNOWN
    if text:
        return PageKind.TEXT
    return PageKind.UNKNOWN if has_other_content else PageKind.BLANK


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
    try:
        save_document_page_texts(session, document, page_texts)
        session.commit()
    except BaseException:
        session.rollback()
        raise

    return page_repository.list_pages_by_document(session, document.id)


def save_document_page_texts(
    session: Session, document: Document, page_texts: list[str], *, preserve_existing_text: bool = False
) -> None:
    """상위 서비스의 트랜잭션 안에서 페이지 결과를 반영한다."""
    page_count = len(page_texts)
    if document.page_count is None:
        document.page_count = page_count
    elif document.page_count != page_count:
        raise InvalidPdfFileError(
            f"PDF page count {page_count} does not match document page_count {document.page_count}"
        )
    protected_pages = set()
    if preserve_existing_text:
        protected_pages = {
            page.page_number
            for page in page_repository.list_pages_by_document(session, document.id)
            if has_page_text(page)
        }
    for page_number, page_text in enumerate(page_texts, start=1):
        if page_number not in protected_pages:
            page_repository.save_page(
                session, document_id=document.id, page_number=page_number, text=page_text
            )
    page_repository.delete_pages_beyond_count(session, document_id=document.id, page_count=page_count)
