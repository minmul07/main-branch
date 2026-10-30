from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

SubjectName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class SubjectCreate(BaseModel):
    name: SubjectName


class SubjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
