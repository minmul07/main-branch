from pydantic import BaseModel, ConfigDict

from backend.app.models.document_processing import PageKind, ProcessingErrorCode, ProcessingStatus


class DocumentProcessingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: int
    status: ProcessingStatus
    error_code: ProcessingErrorCode | None = None
    page_kinds: list[PageKind] | None = None
