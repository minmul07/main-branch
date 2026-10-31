from sqlalchemy import Engine

import backend.app.models  # noqa: F401  모델을 Base.metadata에 등록
from backend.app.database import Base, engine


def init_db(target_engine: Engine = engine) -> None:
    Base.metadata.create_all(target_engine)


if __name__ == "__main__":
    init_db()
