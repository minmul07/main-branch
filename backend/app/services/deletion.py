"""삭제 트랜잭션과 원본 파일 격리·복원을 관리한다."""

import logging
from pathlib import Path
import stat
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.repositories import document as document_repository
from backend.app.repositories import subject as subject_repository

logger = logging.getLogger(__name__)


class TargetNotFoundError(Exception):
    pass


class SubjectHasDocumentsError(Exception):
    pass


class DeletionError(Exception):
    pass


def delete_subject(session: Session, subject_id: int) -> None:
    try:
        session.execute(text("BEGIN IMMEDIATE"))
        subject = subject_repository.get_subject(session, subject_id)
        if subject is None:
            raise TargetNotFoundError
        if document_repository.list_documents_by_subject(session, subject_id):
            raise SubjectHasDocumentsError
        subject_repository.delete_subject(session, subject)
        session.commit()
    except (TargetNotFoundError, SubjectHasDocumentsError):
        session.rollback()
        raise
    except Exception as error:
        session.rollback()
        raise DeletionError("failed to delete subject") from error


def delete_document(session: Session, document_id: int, upload_dir: Path) -> None:
    original: Path | None = None
    quarantine: Path | None = None
    try:
        session.execute(text("BEGIN IMMEDIATE"))
        document = document_repository.get_document(session, document_id)
        if document is None:
            raise TargetNotFoundError
        original = upload_dir / document.stored_name
        if original.parent != upload_dir or original.name != document.stored_name:
            raise DeletionError("invalid stored path")
        try:
            mode = original.lstat().st_mode
        except FileNotFoundError:
            pass  # 이미 원본이 없는 메타데이터도 삭제할 수 있다.
        else:
            if not stat.S_ISREG(mode):
                raise DeletionError("original is not a regular file")
            candidate = upload_dir / f".delete-{document_id}-{uuid4().hex}-{document.stored_name}"
            original.rename(candidate)
            quarantine = candidate
        document_repository.delete_document(session, document)
        session.commit()
    except Exception as error:
        try:
            session.rollback()
        finally:
            if quarantine is not None:
                try:
                    # 외부에서 생긴 파일도 덮어쓰지 않는다.
                    if original.exists() or original.is_symlink():
                        raise OSError("original path is occupied")
                    quarantine.rename(original)
                except OSError:
                    logger.exception(
                        "Deletion recovery required: document=%s original=%s quarantine=%s",
                        document_id, original, quarantine,
                    )
                    raise DeletionError("failed to restore original; manual recovery required")
        if isinstance(error, (TargetNotFoundError, DeletionError)):
            raise
        raise DeletionError("failed to delete document") from error

    if quarantine is not None:
        try:
            quarantine.unlink()
        except OSError as error:
            logger.exception(
                "Deleted document requires file cleanup: document=%s quarantine=%s",
                document_id, quarantine,
            )
            raise DeletionError("failed to remove quarantined original") from error
