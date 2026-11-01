from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, field_validator


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject_id: int
    week_number: int
    filename: str
    uploaded_at: datetime
    file_size_bytes: int
    page_count: int | None

    @field_validator("uploaded_at")
    @classmethod
    def as_utc(cls, value: datetime) -> datetime:
        # SQLite에서 읽은 시각은 시간대 정보가 없으므로 저장 규칙대로 UTC로 해석한다.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
