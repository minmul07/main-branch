from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.dialects.sqlite import insert

import backend.app.models  # noqa: F401  모델을 Base.metadata에 등록
from backend.app.database import Base, engine
from backend.app.models.document import Document
from backend.app.models.document_processing import DocumentProcessing


def init_db(target_engine: Engine = engine) -> None:
    Base.metadata.create_all(target_engine)
    with target_engine.begin() as connection:
        # create_all은 기존 테이블에 컬럼을 추가하지 않으므로 #31 이전 DB에 ocr_text를 추가한다.
        page_columns = {column["name"] for column in inspect(connection).get_columns("pages")}
        if "ocr_text" not in page_columns:
            connection.execute(text("ALTER TABLE pages ADD COLUMN ocr_text TEXT"))
        documents_without_job = select(Document.id).where(
            ~select(DocumentProcessing.document_id)
            .where(DocumentProcessing.document_id == Document.id)
            .exists()
        )
        connection.execute(
            insert(DocumentProcessing)
            .from_select([DocumentProcessing.document_id], documents_without_job)
            .on_conflict_do_nothing(index_elements=[DocumentProcessing.document_id])
        )


if __name__ == "__main__":
    init_db()
