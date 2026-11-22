from enum import StrEnum

from sqlalchemy import Enum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database import Base


class ProcessingStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ProcessingErrorCode(StrEnum):
    ORIGINAL_MISSING = "original_missing"
    INVALID_PDF = "invalid_pdf"
    PROCESSING_ERROR = "processing_error"
    INTERRUPTED = "interrupted"
    OCR_UNAVAILABLE = "ocr_unavailable"
    OCR_FAILED = "ocr_failed"


class PageKind(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    BLANK = "blank"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class DocumentProcessing(Base):
    __tablename__ = "document_processing"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[ProcessingStatus] = mapped_column(
        Enum(
            ProcessingStatus,
            values_callable=lambda statuses: [status.value for status in statuses],
            create_constraint=True,
        ),
        nullable=False,
        server_default=ProcessingStatus.PENDING,
    )
    error_code: Mapped[str | None] = mapped_column(nullable=True)
    # 배열의 첫 항목은 물리 페이지 1이다. 성공한 실행만 결과를 기록한다.
    page_kinds: Mapped[list[str] | None] = mapped_column(JSON(none_as_null=True), nullable=True)
