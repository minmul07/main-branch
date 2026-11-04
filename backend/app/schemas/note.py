from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NoteCreate(BaseModel):
    # 이름을 비우거나 보내지 않으면 서버가 "메모 N" 기본 이름을 붙인다.
    title: str | None = Field(default=None, max_length=100)
    content: str = Field(default="", max_length=10000)


class NoteUpdate(BaseModel):
    # 보낸 칸만 수정한다. 보내지 않은 칸은 그대로 둔다.
    title: str | None = Field(default=None, max_length=100)
    content: str | None = Field(default=None, max_length=10000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("title must not be blank")
        return value


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_id: int
    page_number: int | None
    title: str
    content: str
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def as_utc(cls, value: datetime) -> datetime:
        # SQLite에서 읽은 시각은 시간대 정보가 없으므로 UTC로 해석한다.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)