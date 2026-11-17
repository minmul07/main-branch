from collections.abc import Generator
from io import BytesIO
from pathlib import Path

from pypdf import PageObject
from pytest import MonkeyPatch, fixture, mark, raises
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from backend.app import database
from backend.app.init_db import init_db
from backend.app.models.note import Note
from backend.app.repositories.document import create_document, get_document
from backend.app.repositories.page import create_page, list_pages_by_document
from backend.app.repositories.subject import create_subject
from backend.app.services import deletion, text_extraction
from backend.app.services.documents import upload_document
from backend.app.services.text_extraction import (
    DocumentFileNotFoundError,
    DocumentNotFoundError,
    InvalidPdfFileError,
    extract_document_pages,
    has_page_text,
    is_page_extracted,
    normalize_extracted_text,
)
from backend.tests.pdf_samples import (
    blank_pdf,
    encrypted_pdf,
    multi_page_pdf,
    scanned_pdf,
    text_pdf,
)

MAX_SIZE = 1024 * 1024


@fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@fixture
def engine(database_path: Path) -> Generator[Engine, None, None]:
    engine = database.create_sqlite_engine(database_path)
    init_db(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@fixture
def upload_dir(tmp_path: Path) -> Path:
    return tmp_path / "uploads"


@fixture
def subject_id(engine: Engine) -> int:
    with Session(engine) as session:
        subject = create_subject(session, "운영체제")
        session.commit()
        return subject.id


def upload_pdf(
    engine: Engine,
    upload_dir: Path,
    subject_id: int,
    data: bytes,
    *,
    filename: str = "lecture.pdf",
) -> int:
    with Session(engine) as session:
        document = upload_document(
            session,
            upload_dir=upload_dir,
            max_size_bytes=MAX_SIZE,
            subject_id=subject_id,
            week_number=3,
            filename=filename,
            file=BytesIO(data),
        )
        return document.id


def count_pages(engine: Engine, document_id: int | None = None) -> int:
    with engine.connect() as connection:
        if document_id is None:
            return connection.execute(text("SELECT COUNT(*) FROM pages")).scalar_one()
        return connection.execute(
            text("SELECT COUNT(*) FROM pages WHERE document_id = :document_id"),
            {"document_id": document_id},
        ).scalar_one()


def stored_path_for(engine: Engine, upload_dir: Path, document_id: int) -> Path:
    with Session(engine) as session:
        document = get_document(session, document_id)
        assert document is not None
        return upload_dir / document.stored_name


def test_normalize_extracted_text() -> None:
    assert normalize_extracted_text(None) == ""
    assert normalize_extracted_text("") == ""
    assert normalize_extracted_text("  \n\t  ") == ""
    assert normalize_extracted_text("\x00\n  ") == ""
    assert normalize_extracted_text("Hello\x00 World") == "Hello World"


def test_extracts_multipage_text_pdf_in_page_order(
    engine: Engine, database_path: Path, upload_dir: Path, subject_id: int
) -> None:
    data = multi_page_pdf(["Page 1 Intro", "Page 2 Process", "Page 3 Threads"])
    document_id = upload_pdf(engine, upload_dir, subject_id, data)

    # 업로드 자체는 아직 Page를 생성하지 않아 기존 업로드 계약과 호환된다.
    assert count_pages(engine, document_id) == 0

    with Session(engine) as session:
        pages = extract_document_pages(session, document_id, upload_dir=upload_dir)
        assert [page.page_number for page in pages] == [1, 2, 3]
        assert [page.text for page in pages] == [
            "Page 1 Intro",
            "Page 2 Process",
            "Page 3 Threads",
        ]
        assert all(is_page_extracted(page) and has_page_text(page) for page in pages)

    engine.dispose()
    reopened = database.create_sqlite_engine(database_path)
    try:
        with Session(reopened) as session:
            persisted = list_pages_by_document(session, document_id)
            assert [(p.page_number, p.text) for p in persisted] == [
                (1, "Page 1 Intro"),
                (2, "Page 2 Process"),
                (3, "Page 3 Threads"),
            ]
    finally:
        reopened.dispose()


def test_blank_and_scanned_pages_store_empty_string_not_null(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    blank_doc_id = upload_pdf(engine, upload_dir, subject_id, blank_pdf(3), filename="blank.pdf")
    scanned_doc_id = upload_pdf(
        engine, upload_dir, subject_id, scanned_pdf(), filename="scanned.pdf"
    )

    with Session(engine) as session:
        blank_pages = extract_document_pages(session, blank_doc_id, upload_dir=upload_dir)
        assert len(blank_pages) == 3
        for page in blank_pages:
            assert page.text == ""
            assert is_page_extracted(page) is True
            assert has_page_text(page) is False

        scanned_pages = extract_document_pages(session, scanned_doc_id, upload_dir=upload_dir)
        assert len(scanned_pages) == 1
        assert scanned_pages[0].text == ""
        assert is_page_extracted(scanned_pages[0]) is True
        assert has_page_text(scanned_pages[0]) is False


def test_mixed_pdf_preserves_page_numbers_for_text_blank_whitespace_and_scanned(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    data = multi_page_pdf(["Cover", "", "   ", None, "Summary"])
    document_id = upload_pdf(engine, upload_dir, subject_id, data)

    with Session(engine) as session:
        pages = extract_document_pages(session, document_id, upload_dir=upload_dir)

        assert [(p.page_number, p.text) for p in pages] == [
            (1, "Cover"),
            (2, ""),
            (3, ""),
            (4, ""),
            (5, "Summary"),
        ]
        assert [is_page_extracted(p) for p in pages] == [True, True, True, True, True]
        assert [has_page_text(p) for p in pages] == [True, False, False, False, True]


def test_missing_document_or_file_raises_error(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    document_id = upload_pdf(engine, upload_dir, subject_id, text_pdf())
    stored_path_for(engine, upload_dir, document_id).unlink()

    with Session(engine) as session:
        with raises(DocumentNotFoundError):
            extract_document_pages(session, document_id + 1, upload_dir=upload_dir)
        with raises(DocumentFileNotFoundError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)

    assert count_pages(engine) == 0


@mark.parametrize(
    "bad_bytes",
    [
        b"not a pdf",
        b"%PDF-1.4\nbroken",
        encrypted_pdf(),
        blank_pdf(0),
        multi_page_pdf(["One", "Two"]),  # 업로드된 page_count(1)와 불일치
    ],
    ids=["not-pdf", "corrupt", "encrypted", "no-pages", "page-count-mismatch"],
)
def test_invalid_or_mismatched_pdf_fails_without_saving_pages(
    engine: Engine, upload_dir: Path, subject_id: int, bad_bytes: bytes
) -> None:
    document_id = upload_pdf(engine, upload_dir, subject_id, text_pdf("Page 1"))
    stored_path_for(engine, upload_dir, document_id).write_bytes(bad_bytes)

    with Session(engine) as session:
        with raises(InvalidPdfFileError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)

    assert count_pages(engine, document_id) == 0


def test_mid_document_extraction_failure_leaves_no_partial_pages(
    engine: Engine, upload_dir: Path, subject_id: int, monkeypatch: MonkeyPatch
) -> None:
    document_id = upload_pdf(
        engine, upload_dir, subject_id, multi_page_pdf(["Page 1", "Page 2", "Page 3"])
    )
    original_extract = PageObject.extract_text
    calls = 0

    def fail_on_second_page(self: PageObject, *args: object, **kwargs: object) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("corrupt content stream")
        return original_extract(self, *args, **kwargs)

    monkeypatch.setattr(PageObject, "extract_text", fail_on_second_page)

    with Session(engine) as session:
        with raises(InvalidPdfFileError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)

    assert count_pages(engine, document_id) == 0


def test_db_failure_during_save_or_commit_rolls_back_all_pages(
    engine: Engine, upload_dir: Path, subject_id: int, monkeypatch: MonkeyPatch
) -> None:
    document_id = upload_pdf(
        engine, upload_dir, subject_id, multi_page_pdf(["Page 1", "Page 2", "Page 3"])
    )
    original_save_page = text_extraction.page_repository.save_page
    save_calls = 0

    def fail_second_save(session: Session, **kwargs: object) -> object:
        nonlocal save_calls
        save_calls += 1
        if save_calls == 2:
            raise RuntimeError("db write failed")
        return original_save_page(session, **kwargs)

    monkeypatch.setattr(text_extraction.page_repository, "save_page", fail_second_save)
    with Session(engine) as session:
        with raises(RuntimeError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)
    assert count_pages(engine, document_id) == 0

    monkeypatch.undo()

    def fail_commit(self: Session) -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(Session, "commit", fail_commit)
    with Session(engine) as session:
        with raises(RuntimeError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)
    monkeypatch.undo()
    assert count_pages(engine, document_id) == 0


def test_reexecution_is_idempotent_and_preserves_page_ids_and_partial_rows(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    document_id = upload_pdf(
        engine, upload_dir, subject_id, multi_page_pdf(["Alpha", "Beta", "Gamma"])
    )
    # 사전에 2페이지만 text=None으로 생성된 부분 상태를 준비한다.
    with Session(engine) as session:
        precreated = create_page(session, document_id=document_id, page_number=2, text=None)
        precreated_id = precreated.id
        session.commit()

    with Session(engine) as session:
        first_run = extract_document_pages(session, document_id, upload_dir=upload_dir)
        first_ids = [page.id for page in first_run]
        assert first_run[1].id == precreated_id
        assert [page.text for page in first_run] == ["Alpha", "Beta", "Gamma"]

    with Session(engine) as session:
        second_run = extract_document_pages(session, document_id, upload_dir=upload_dir)
        assert [page.id for page in second_run] == first_ids
        assert [page.text for page in second_run] == ["Alpha", "Beta", "Gamma"]

    assert count_pages(engine, document_id) == 3


def test_failed_reexecution_preserves_existing_committed_pages(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    document_id = upload_pdf(
        engine, upload_dir, subject_id, multi_page_pdf(["Valid 1", "Valid 2"])
    )
    with Session(engine) as session:
        initial = extract_document_pages(session, document_id, upload_dir=upload_dir)
        initial_snapshot = [(p.id, p.page_number, p.text) for p in initial]

    # 원본 파일이 손상되어 재실행이 실패해도 기존 유효 결과는 유실되지 않는다.
    stored_path_for(engine, upload_dir, document_id).write_bytes(b"%PDF-1.4\ncorrupt")
    with Session(engine) as session:
        with raises(InvalidPdfFileError):
            extract_document_pages(session, document_id, upload_dir=upload_dir)

    with Session(engine) as session:
        current = list_pages_by_document(session, document_id)
        assert [(p.id, p.page_number, p.text) for p in current] == initial_snapshot


def test_updates_null_page_count_and_preserves_other_documents_and_notes(
    engine: Engine, upload_dir: Path, subject_id: int
) -> None:
    other_doc_id = upload_pdf(engine, upload_dir, subject_id, text_pdf("Other Doc"))
    with Session(engine) as session:
        other_pages = extract_document_pages(session, other_doc_id, upload_dir=upload_dir)
        session.add(
            Note(document_id=other_doc_id, page_number=1, title="다른 자료 메모", content="유지")
        )
        session.commit()
        other_snapshot = [(p.id, p.text) for p in other_pages]

    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "manual-null-page-count.pdf"
    (upload_dir / stored_name).write_bytes(multi_page_pdf(["First", "Second"]))
    with Session(engine) as session:
        target = create_document(
            session,
            subject_id=subject_id,
            week_number=4,
            filename="4주차.pdf",
            stored_name=stored_name,
            file_size_bytes=(upload_dir / stored_name).stat().st_size,
            page_count=None,
        )
        session.add(Note(document_id=target.id, page_number=1, title="대상 메모", content="보존"))
        session.commit()
        target_id = target.id

    with Session(engine) as session:
        pages = extract_document_pages(session, target_id, upload_dir=upload_dir)
        assert [(p.page_number, p.text) for p in pages] == [(1, "First"), (2, "Second")]
        refreshed = get_document(session, target_id)
        assert refreshed is not None
        assert refreshed.page_count == 2
        assert session.query(Note).filter_by(document_id=target_id).count() == 1

    # 다른 자료의 Page와 Note가 보존되고, 대상 자료 삭제도 정상 동작해야 한다.
    with Session(engine) as session:
        assert [
            (p.id, p.text) for p in list_pages_by_document(session, other_doc_id)
        ] == other_snapshot
        assert session.query(Note).filter_by(document_id=other_doc_id).count() == 1

        deletion.delete_document(session, target_id, upload_dir)
        assert get_document(session, target_id) is None
        assert list_pages_by_document(session, target_id) == []
        assert len(list_pages_by_document(session, other_doc_id)) == 1
