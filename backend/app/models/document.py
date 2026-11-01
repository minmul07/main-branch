from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("week_number > 0", name="ck_documents_week_number_positive"),
        CheckConstraint("file_size_bytes >= 0", name="ck_documents_file_size_non_negative"),
        CheckConstraint(
            "page_count IS NULL OR page_count > 0", name="ck_documents_page_count_positive"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id"), nullable=False, index=True
    )
    week_number: Mapped[int] = mapped_column(nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # 업로드 디렉터리 안의 서버 생성 파일명. 사용자 입력 경로를 저장하지 않는다.
    stored_name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # SQLite는 시간대를 저장하지 않으므로 항상 UTC로 기록하고 응답 스키마에서 UTC로 해석한다.
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    file_size_bytes: Mapped[int] = mapped_column(nullable=False)
    # 페이지 수를 확인하기 전에는 None. 0으로 대체하지 않는다.
    page_count: Mapped[int | None] = mapped_column(nullable=True)
