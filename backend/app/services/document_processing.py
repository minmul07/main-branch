import logging
from io import BytesIO
from pathlib import Path
from threading import Event

from sqlalchemy import Engine, select, text, update
from sqlalchemy.orm import Session

from backend.app.models.document import Document
from backend.app.models.document_processing import (
    DocumentProcessing,
    PageKind,
    ProcessingErrorCode,
    ProcessingStatus,
)
from backend.app.repositories import page as page_repository
from backend.app.services import ocr
from backend.app.services.deletion import original_file_lock
from backend.app.services.documents import get_document_file_path
from backend.app.services.text_extraction import (
    InvalidPdfFileError,
    read_pdf_page_results,
    save_document_page_texts,
)

logger = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 0.5


class ProcessingNotFoundError(Exception):
    pass


class ProcessingConflictError(Exception):
    pass


def retry_processing(session: Session, document_id: int) -> None:
    with session.begin():
        retried = session.scalar(
            update(DocumentProcessing)
            .where(
                DocumentProcessing.document_id == document_id,
                DocumentProcessing.status == ProcessingStatus.FAILED,
            )
            .values(status=ProcessingStatus.PENDING, error_code=None)
            .returning(DocumentProcessing.document_id)
        )
        if retried is None:
            if session.get(DocumentProcessing, document_id) is None:
                raise ProcessingNotFoundError
            raise ProcessingConflictError


def recover_interrupted_jobs(engine: Engine) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            update(DocumentProcessing)
            .where(DocumentProcessing.status == ProcessingStatus.PROCESSING)
            .values(status=ProcessingStatus.FAILED, error_code=ProcessingErrorCode.INTERRUPTED)
        )


def claim_next_document(engine: Engine) -> Document | None:
    # 문서 스냅샷은 DB 연결을 반환한 뒤 원본을 읽고, 완료 시 삭제·ID 재사용을 확인하는 데 쓴다.
    with Session(engine, expire_on_commit=False) as session, session.begin():
        document_id = session.scalar(
            select(DocumentProcessing.document_id)
            .where(DocumentProcessing.status == ProcessingStatus.PENDING)
            .order_by(DocumentProcessing.document_id)
            .limit(1)
        )
        if document_id is None:
            return None
        claimed = session.scalar(
            update(DocumentProcessing)
            .where(
                DocumentProcessing.document_id == document_id,
                DocumentProcessing.status == ProcessingStatus.PENDING,
            )
            .values(status=ProcessingStatus.PROCESSING)
            .returning(DocumentProcessing.document_id)
        )
        return session.get(Document, claimed) if claimed is not None else None


def _finish_processing(
    engine: Engine,
    claimed_document: Document,
    result: list[tuple[str, PageKind]] | ProcessingErrorCode,
    ocr_texts: dict[int, str] | None = None,
) -> None:
    with Session(engine) as session, session.begin():
        # 삭제와 직렬화하여 원본이 읽힌 뒤 삭제된 자료의 결과를 다시 쓰지 않는다.
        session.execute(text("BEGIN IMMEDIATE"))
        document = session.get(Document, claimed_document.id)
        if document is None or document.stored_name != claimed_document.stored_name:
            return
        job = session.get(DocumentProcessing, document.id)
        if job is None or job.status != ProcessingStatus.PROCESSING:
            return
        if isinstance(result, ProcessingErrorCode):
            job.status = ProcessingStatus.FAILED
            job.error_code = result
        else:
            save_document_page_texts(
                session, document, [page_text for page_text, _ in result], preserve_existing_text=True
            )
            for page_number, ocr_text in (ocr_texts or {}).items():
                page_repository.set_page_ocr_text(
                    session, document_id=document.id, page_number=page_number, ocr_text=ocr_text
                )
            job.page_kinds = [kind.value for _, kind in result]
            job.status = ProcessingStatus.COMPLETED


def process_document(engine: Engine, document: Document, upload_dir: Path) -> None:
    try:
        with original_file_lock:
            path = get_document_file_path(upload_dir, document)
            if path is None:
                raise FileNotFoundError
            original = BytesIO(path.read_bytes())
        results = read_pdf_page_results(original)
        # 텍스트 없이 이미지만 그리는 페이지만 OCR한다. mixed·unknown·blank는 기존 처리를 유지한다.
        # OCR은 DB 연결과 파일 잠금 밖에서 실행하므로 오래 걸려도 업로드·삭제를 막지 않는다.
        image_pages = [
            page_number
            for page_number, (_, kind) in enumerate(results, start=1)
            if kind == PageKind.IMAGE
        ]
        ocr_texts = ocr.recognize_pages(original, image_pages)
        _finish_processing(engine, document, results, ocr_texts)
        return
    except FileNotFoundError:
        error_code = ProcessingErrorCode.ORIGINAL_MISSING
    except ocr.OcrUnavailableError:
        error_code = ProcessingErrorCode.OCR_UNAVAILABLE
        logger.error("OCR is unavailable: document_id=%s", document.id, exc_info=True)
    except ocr.OcrFailedError:
        error_code = ProcessingErrorCode.OCR_FAILED
        logger.exception("OCR failed: document_id=%s", document.id)
    except InvalidPdfFileError:
        error_code = ProcessingErrorCode.INVALID_PDF
        logger.info("PDF processing failed: document_id=%s", document.id, exc_info=True)
    except Exception:
        error_code = ProcessingErrorCode.PROCESSING_ERROR
        logger.exception("PDF processing failed: document_id=%s", document.id)
    _finish_processing(engine, document, error_code)


def run_worker(engine: Engine, upload_dir: Path, stop: Event) -> None:
    document = None
    while not stop.is_set():
        try:
            if document is not None:
                # 일시적인 DB 장애로 실패 상태 기록까지 실패한 경우에만 다시 기록한다.
                _finish_processing(engine, document, ProcessingErrorCode.PROCESSING_ERROR)
            else:
                document = claim_next_document(engine)
                if document is None:
                    stop.wait(POLL_INTERVAL_SECONDS)
                    continue
                process_document(engine, document, upload_dir)
            document = None
        except Exception:
            logger.exception("PDF processing worker could not update the queue")
            stop.wait(POLL_INTERVAL_SECONDS)
