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


def delete_subject(session: Session, subject_id: int, upload_dir: Path | None = None,
                   confirmed_name: str | None = None) -> None:
    _delete(session, upload_dir, subject_id=subject_id, confirmed_name=confirmed_name)


def delete_document(session: Session, document_id: int, upload_dir: Path) -> None:
    _delete(session, upload_dir, document_id=document_id)


def _delete(session: Session, upload_dir: Path | None, *, document_id: int | None = None,
            subject_id: int | None = None, confirmed_name: str | None = None) -> None:
    quarantines: list[tuple[Path, Path]] = []
    try:
        session.execute(text("BEGIN IMMEDIATE"))
        subject = None
        if subject_id is not None:
            subject = subject_repository.get_subject(session, subject_id)
            if subject is None:
                raise TargetNotFoundError
            documents = document_repository.list_documents_by_subject(session, subject_id)
            if documents and confirmed_name != subject.name:
                raise SubjectHasDocumentsError
        else:
            document = document_repository.get_document(session, document_id)
            if document is None:
                raise TargetNotFoundError
            documents = [document]
        for document in documents:
            if upload_dir is None:
                raise DeletionError("missing upload directory")
            original = upload_dir / document.stored_name
            if original.parent != upload_dir or original.name != document.stored_name:
                raise DeletionError("invalid stored path")
            try:
                mode = original.lstat().st_mode
            except FileNotFoundError:
                pass
            else:
                if not stat.S_ISREG(mode):
                    raise DeletionError("original is not a regular file")
                quarantine = upload_dir / f".delete-{document.id}-{uuid4().hex}-{document.stored_name}"
                original.rename(quarantine)
                quarantines.append((original, quarantine))
            document_repository.delete_document(session, document)
        if subject is not None:
            session.flush()
            subject_repository.delete_subject(session, subject)
        session.commit()
    except Exception as error:
        try:
            session.rollback()
        finally:
            recovery_failed = False
            for original, quarantine in reversed(quarantines):
                try:
                    if original.exists() or original.is_symlink():
                        raise OSError("original path is occupied")
                    quarantine.rename(original)
                except OSError:
                    recovery_failed = True
                    logger.exception("Deletion recovery required: original=%s quarantine=%s", original, quarantine)
            if recovery_failed:
                raise DeletionError("failed to restore original; manual recovery required")
        if isinstance(error, (TargetNotFoundError, SubjectHasDocumentsError, DeletionError)):
            raise
        raise DeletionError("failed to delete") from error
    cleanup_failed = False
    for original, quarantine in quarantines:
        try:
            quarantine.unlink()
        except OSError:
            cleanup_failed = True
            logger.exception("Deleted document requires file cleanup: quarantine=%s", quarantine)
    if cleanup_failed:
        raise DeletionError("failed to remove quarantined original")
