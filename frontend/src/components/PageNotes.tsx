import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { DocumentNotes } from '../hooks/useDocumentNotes'
import type { Note } from '../types'
import ConfirmPopup from './ConfirmPopup'
import NoteItem from './NoteItem'

type Props = {
  id: string
  page: number
  notes: Note[]
  api: DocumentNotes
  current: boolean
  // margin: next to a PDF page on wide screens. sheet: the bottom sheet on narrow screens.
  variant: 'margin' | 'sheet'
}

export default function PageNotes({ id, page, notes, api, current, variant }: Props) {
  const busy = api.busyPages.has(page)
  const ready = api.state === 'ready'
  const [composing, setComposing] = useState(variant === 'sheet')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const deleteFocus = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const draftInput = useRef<HTMLTextAreaElement>(null)
  const focusTarget = useRef<'draft' | 'add' | null>(null)

  useLayoutEffect(() => {
    if (focusTarget.current === 'draft') draftInput.current?.focus()
    else if (focusTarget.current === 'add') addButton.current?.focus()
    focusTarget.current = null
  }, [composing])

  function openComposer() {
    focusTarget.current = 'draft'
    setComposing(true)
  }

  function closeComposer() {
    if (variant === 'sheet') return
    focusTarget.current = 'add'
    setComposing(false)
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const content = draft.trim()
    if (busy || !ready || addError || !content) return
    setAdding(true)
    try {
      await api.create(page, content)
      setDraft('')
      closeComposer()
    } catch {
      setAddError(true)
    } finally {
      setAdding(false)
    }
  }

  function handleDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape' && variant === 'margin') {
      // Keeps the draft so reopening the composer continues where the user left off.
      event.preventDefault()
      closeComposer()
    }
  }

  async function confirmDelete() {
    if (!deleting || busy) return
    setDeleteError('')
    try {
      await api.remove(deleting)
      setDeleting(null)
    } catch {
      setDeleteError('메모를 삭제하지 못했습니다. 다시 시도하세요.')
    }
  }

  const showStatus = variant === 'sheet' || current
  return (
    <div
      id={id}
      className={`page-notes page-notes-${variant}${current ? ' is-current' : ''}${notes.length ? ' has-notes' : ''}${composing ? ' is-composing' : ''}`}
      role="group"
      aria-label={`${page}페이지 메모`}
      tabIndex={-1}
    >
      {showStatus && api.state === 'loading' && <p className="pdf-memo-status" role="status">메모를 불러오는 중…</p>}
      {showStatus && api.state === 'error' && (
        <div className="pdf-memo-feedback" role="alert">
          <p>메모를 불러오지 못했습니다.</p>
          <button type="button" onClick={api.reload}>다시 시도</button>
        </div>
      )}
      {ready && notes.length > 0 && (
        <ul className="pdf-memo-list" aria-label={`${page}페이지 메모 목록`}>
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              busy={busy}
              onSave={(title, content) => api.save(note, title, content)}
              onDelete={(trigger) => {
                deleteFocus.current = trigger
                setDeleteError('')
                setDeleting(note)
              }}
            />
          ))}
        </ul>
      )}
      {ready && variant === 'sheet' && notes.length === 0 && !adding && <p className="pdf-memo-status">이 페이지에는 메모가 없습니다.</p>}
      {addError && (
        <div className="pdf-memo-feedback" role="alert">
          <p>메모 추가 결과를 확인할 수 없습니다.</p>
          <button type="button" onClick={() => { setAddError(false); api.reload() }}>목록 다시 확인</button>
        </div>
      )}
      {ready && (composing ? (
        <form className="page-notes-composer" onSubmit={submit}>
          <textarea
            ref={draftInput}
            aria-label={`${page}페이지 새 메모`}
            placeholder="이 페이지에 메모 남기기"
            value={draft}
            maxLength={10000}
            rows={variant === 'sheet' ? 2 : 3}
            disabled={adding}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleDraftKey}
          />
          <div className="note-item-actions">
            {variant === 'margin' && <button type="button" onClick={closeComposer}>취소</button>}
            <button type="submit" className="note-primary-action" disabled={!draft.trim() || busy || addError}>{adding ? '추가 중…' : '추가'}</button>
          </div>
        </form>
      ) : (
        <button
          ref={addButton}
          className="page-notes-add"
          type="button"
          aria-label={`${page}페이지에 메모 추가`}
          tabIndex={current || notes.length > 0 ? 0 : -1}
          onClick={openComposer}
        >
          <span aria-hidden="true">+</span> 메모
        </button>
      ))}
      {deleting && createPortal(
        <ConfirmPopup
          title="메모 삭제"
          message={`“${deleting.title}” 메모를 삭제하시겠습니까? 되돌릴 수 없습니다.`}
          confirmLabel="삭제 확인"
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
          returnFocusRef={deleteFocus}
          busy={busy}
          error={deleteError}
        />,
        document.body,
      )}
    </div>
  )
}
