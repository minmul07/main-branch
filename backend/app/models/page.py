from sqlalchemy import CheckConstraint, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database import Base


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (
        # 문서별 페이지 번호 중복을 막고 (document_id, page_number) 조회 인덱스로도 쓴다.
        UniqueConstraint("document_id", "page_number", name="uq_pages_document_page_number"),
        CheckConstraint("page_number > 0", name="ck_pages_page_number_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # 원본 PDF의 물리 페이지 순서. 1부터 시작한다.
    page_number: Mapped[int] = mapped_column(nullable=False)
    # NULL은 아직 텍스트를 얻지 않은 페이지, 빈 문자열은 처리했지만 텍스트가 없는 페이지다.
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
