import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listDocuments } from '../documentsApi'
import UploadDialog from './UploadDialog'
import type { MockDocument } from '../types'
import type { Subject } from '../types'

const PdfViewer = lazy(() => import('./PdfViewer'))

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
  const [collapsed, setCollapsed] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarContainerRef = useRef<HTMLDivElement>(null)
  const toggledRef = useRef(false)
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    const container = sidebarContainerRef.current
    if (!sidebar || !container) return
    const measure = () => {
      const rect = sidebar.getBoundingClientRect()
      container.style.setProperty('--sidebar-width', `${rect.width}px`)
      container.style.setProperty('--sidebar-height', `${rect.height}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(sidebar)
    return () => observer?.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (toggledRef.current) (collapsed ? expandRef : collapseRef).current?.focus()
  }, [collapsed])
  function toggleSidebar() { toggledRef.current = true; setCollapsed((value) => !value) }
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

      <div className={`subject-page-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="document-sidebar-container" ref={sidebarContainerRef}>
        <aside ref={sidebarRef} id="document-sidebar" className="document-sidebar" aria-labelledby="document-sidebar-title" inert={collapsed}>
          <div className="document-heading"><button ref={collapseRef} className="sidebar-toggle" type="button" aria-label="자료 목록 접기" aria-controls="document-sidebar" aria-expanded={!collapsed} onClick={toggleSidebar} /><h2 id="document-sidebar-title">자료 목록</h2><button ref={addRef} className="document-add" type="button" aria-label="자료 추가" onClick={() => setUploading(true)}>+</button></div>
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
        <button ref={expandRef} className="sidebar-show" type="button" aria-label="자료 목록 펼치기" aria-controls="document-sidebar" aria-expanded={!collapsed} tabIndex={collapsed ? 0 : -1} aria-hidden={!collapsed} onClick={toggleSidebar} />
        <svg className="sidebar-morph-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path className="sidebar-morph-arrow" d="M16 9l-3 3 3 3"/></svg>
        </div>

        <section className="document-details" aria-labelledby="document-details-title">
          {selectedDocument ? (
            <>
            <div className="document-titlebar">
              <h2 id="document-details-title" title={selectedDocument.filename}>{selectedDocument.filename}</h2>
              <div className="document-info">
                <button type="button" aria-label="자료 정보" aria-describedby="document-metadata">ⓘ</button>
            <dl className="document-metadata" id="document-metadata">
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
              </div>
            </div>
            <div className="document-viewer-box"><Suspense fallback={<p className="document-placeholder" role="status">PDF 뷰어를 불러오는 중...</p>}><PdfViewer key={selectedDocument.id} documentId={selectedDocument.id} /></Suspense></div>
            </>
          ) : (
            <><div className="document-titlebar"><h2 id="document-details-title">PDF 뷰어</h2></div><div className="document-viewer-box"><p className="document-placeholder">PDF를 선택하면 원문이 여기에 표시됩니다.</p></div></>
          )}
        </section>
      </div>
    </section>
  )
}

export default SubjectDocumentsPage
