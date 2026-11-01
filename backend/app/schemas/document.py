from datetime import UTC, datetime
import re
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, field_validator


def reject_non_integer_string(value: Any) -> Any:
    # 폼·쿼리 문자열 "3.0", "3.5"를 정수로 바꾸거나 절삭하지 않도록 정수 형태만 통과시킨다.
    if isinstance(value, str) and not re.fullmatch(r"\s*[+-]?\d+\s*", value):
        raise ValueError("value must be an integer")
    return value


# 양수 조건은 Form/Query/Path(gt=0)에서 지정한다. 기본값 FieldInfo가 Annotated 제약을 덮어쓰지 않도록
# endpoint에서는 Annotated[IntegerString, Form(gt=0)] 형태로 사용한다.
IntegerString = Annotated[int, BeforeValidator(reject_non_integer_string)]


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
