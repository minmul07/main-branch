import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createNote, deleteNote, listNotes, updateNote } from '../notesApi'
import type { Note } from '../types'
import ConfirmPopup from './ConfirmPopup'
import NoteItem from './NoteItem'

type PanelProps = { id: string; documentId: number; page: number; open: boolean }
type PageProps = PanelProps & {
  busy: boolean
  mutate: <T>(request: () => Promise<T>) => Promise<T>
}

export default function NotesPanel(props: PanelProps) {
  const { id, documentId, page, open } = props
  const pageKey = `${documentId}/${page}`
  const pending = useRef(new Set<string>())
  const [busyPages, setBusyPages] = useState<ReadonlySet<string>>(() => new Set())

  async function mutate<T>(request: () => Promise<T>): Promise<T> {
    if (pending.current.has(pageKey)) throw new Error('A note request is already in progress')
    pending.current.add(pageKey)
    setBusyPages(new Set(pending.current))
    try {
      return await request()
    } finally {
      pending.current.delete(pageKey)
      setBusyPages(new Set(pending.current))
    }
  }

  return (
    <aside id={id} className="pdf-memo-sidebar" aria-labelledby={`${id}-title`} aria-hidden={!open} inert={!open}>
      <div className="pdf-memo-content">
        <PageNotes key={pageKey} {...props} busy={busyPages.has(pageKey)} mutate={mutate} />
      </div>
    </aside>
  )
}

function PageNotes({ id, documentId, page, open, busy, mutate }: PageProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const deleteFocus = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open || busy || state !== 'loading') return
    const request = new AbortController()
    listNotes(documentId, page, request.signal)
      .then((items) => {
        if (request.signal.aborted) return
        setNotes(items.slice().reverse())
        setState('ready')
      })
      .catch(() => { if (!request.signal.aborted) setState('error') })
    return () => request.abort()
  }, [documentId, page, open, busy, state])

  async function addNote() {
    if (busy || state !== 'ready' || addError) return
    setAdding(true)
    try {
      const note = await mutate(() => createNote(documentId, page))
      setNotes((items) => [note, ...items])
    } catch {
      setAddError(true)
    } finally {
      setAdding(false)
    }
  }

  async function saveNote(id: number, title: string, content: string) {
    const saved = await mutate(() => updateNote(id, { title, content }))
    setNotes((items) => items.map((item) => item.id === saved.id ? saved : item))
  }

  async function confirmDelete() {
    if (!deleting || busy) return
    const noteId = deleting.id
    setDeleteError('')
    try {
      await mutate(() => deleteNote(noteId))
      setNotes((items) => items.filter((item) => item.id !== noteId))
      setDeleting(null)
    } catch {
      setDeleteError('메모를 삭제하지 못했습니다. 다시 시도하세요.')
    }
  }

  return (
    <>
      <header>
        <div className="pdf-memo-title">
          <h3 id={`${id}-title`}>페이지 메모</h3>
          <span>{page}페이지</span>
        </div>
        <button className="pdf-memo-add" type="button" aria-label="메모 추가" title="메모 추가" onClick={addNote} disabled={state !== 'ready' || busy || addError}>+</button>
      </header>
      <div className="pdf-memo-page">
        {(state === 'loading' || adding) && <p className="pdf-memo-status" role="status">{adding ? '메모를 추가하는 중…' : '메모를 불러오는 중…'}</p>}
        {state === 'error' && (
          <div className="pdf-memo-feedback" role="alert">
            <p>메모를 불러오지 못했습니다.</p>
            <button type="button" onClick={() => setState('loading')}>다시 시도</button>
          </div>
        )}
        {addError && (
          <div className="pdf-memo-feedback" role="alert">
            <p>메모 추가 결과를 확인할 수 없습니다.</p>
            <button type="button" onClick={() => { setAddError(false); setState('loading') }}>목록 다시 확인</button>
          </div>
        )}
        {state === 'ready' && notes.length === 0 && !adding && !addError && <p className="pdf-memo-status">이 페이지에는 메모가 없습니다.</p>}
        {state === 'ready' && notes.length > 0 && (
          <ul className="pdf-memo-list" aria-label="메모 목록">
            {notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                busy={busy}
                onSave={(title, content) => saveNote(note.id, title, content)}
                onDelete={(trigger) => {
                  deleteFocus.current = trigger
                  setDeleteError('')
                  setDeleting(note)
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {open && deleting && createPortal(
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
    </>
  )
}
