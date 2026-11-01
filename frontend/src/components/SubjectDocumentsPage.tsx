import { useEffect, useRef, useState } from 'react'
import { listDocuments } from '../documentsApi'
import UploadDialog from './UploadDialog'
import type { MockDocument } from '../types'
import type { Subject } from '../types'

type SubjectDocumentsPageProps = {
  subject: Subject
  selectedDocumentId: number | null
  onBack: () => void
  onSelectDocument: (documentId: number) => void
}

function SubjectDocumentsPage({
  subject,
  selectedDocumentId,
  onBack,
  onSelectDocument,
}: SubjectDocumentsPageProps) {
  const [documents, setDocuments] = useState<MockDocument[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [uploading, setUploading] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let alive = true
    listDocuments(subject.id).then((items) => { if (alive) { setDocuments(items); setState('ready') } }).catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [subject.id, attempt])
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId)

  function formatFileSize(bytes: number) {
    const kilobytes = bytes / 1024
    return kilobytes >= 1024
      ? `${(kilobytes / 1024).toFixed(2)} MB`
      : `${Math.round(kilobytes)} KB`
  }

  function formatUploadDate(uploadedAt: string) {
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(uploadedAt))
  }

  return (
    <section className="subject-page" aria-labelledby="subject-page-title">
      <header className="subject-page-header">
        <button className="subject-page-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          내 수업
        </button>
        <h1 id="subject-page-title">{subject.name}</h1>
      </header>

      <div className="subject-page-layout">
        <aside className="document-sidebar" aria-labelledby="document-sidebar-title">
          <div className="document-heading"><h2 id="document-sidebar-title">자료 목록</h2><button ref={addRef} type="button" aria-label="자료 추가" onClick={() => setUploading(true)}>+</button></div>
          {uploading && <UploadDialog subjectId={subject.id} returnFocusRef={addRef} onClose={() => setUploading(false)} onUploaded={() => setAttempt((n) => n + 1)} />}
          {state === 'loading' && <p role="status">Loading...</p>}
          {state === 'error' && <div role="alert">자료를 불러오지 못했습니다. <button type="button" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>다시 시도</button></div>}
          {state === 'ready' && documents.length === 0 && <p>등록된 자료가 없습니다.</p>}
          <ul className="document-list" aria-label={`${subject.name} 자료 목록`}>
            {state === 'ready' && documents.map((document) => (
              <li key={document.id}>
                <button
                  className="document-row"
                  type="button"
                  aria-pressed={selectedDocumentId === document.id}
                  onClick={() => onSelectDocument(document.id)}
                >
                  <span>{document.filename}</span>
                  <span>{document.week_number}주차</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="document-details" aria-labelledby="document-details-title" aria-live="polite">
          <h2 id="document-details-title">자료 정보</h2>
          {selectedDocument ? (
            <dl className="document-metadata">
              <div>
                <dt>파일명</dt>
                <dd>{selectedDocument.filename}</dd>
              </div>
              <div>
                <dt>주차</dt>
                <dd>{selectedDocument.week_number}주차</dd>
              </div>
              <div>
                <dt>크기</dt>
                <dd>{formatFileSize(selectedDocument.file_size_bytes)}</dd>
              </div>
              <div>
                <dt>페이지 수</dt>
                <dd>{selectedDocument.page_count === null ? '확인 전' : `${selectedDocument.page_count}페이지`}</dd>
              </div>
              <div>
                <dt>추가 일시</dt>
                <dd>{formatUploadDate(selectedDocument.uploaded_at)}</dd>
              </div>
            </dl>
          ) : (
            <p className="document-placeholder">PDF를 선택하면 파일 정보가 여기에 표시됩니다.</p>
          )}
        </section>
      </div>
    </section>
  )
}

export default SubjectDocumentsPage
