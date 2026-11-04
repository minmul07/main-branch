from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database import Base
from backend.app.models.document import utc_now


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint(
            "page_number IS NULL OR page_number > 0", name="ck_notes_page_number_positive"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), nullable=False, index=True
    )
    
    page_number: Mapped[int | None] = mapped_column(nullable=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )