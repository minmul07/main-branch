from sqlalchemy import Engine, select
from sqlalchemy.dialects.sqlite import insert

import backend.app.models  # noqa: F401  모델을 Base.metadata에 등록
from backend.app.database import Base, engine
from backend.app.models.document import Document
from backend.app.models.document_processing import DocumentProcessing


def init_db(target_engine: Engine = engine) -> None:
    Base.metadata.create_all(target_engine)
    with target_engine.begin() as connection:
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
