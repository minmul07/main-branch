from pydantic import BaseModel, ConfigDict


class SearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: int
    page_id: int
    page_number: int
    filename: str
    subject_id: int
    subject_name: str
    week_number: int
    snippet: str