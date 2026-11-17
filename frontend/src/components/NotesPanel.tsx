import { useEffect, useRef, useState } from 'react'
import { createNote, deleteNote, listNotes } from '../notesApi'
import ConfirmPopup from './ConfirmPopup'
import NoteItem from './NoteItem'
import type { Note } from '../types'

type NotesPanelProps = { documentId: number; page: number; onClose: () => void }

export default function NotesPanel({ documentId, page, onClose }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let current = true
    listNotes(documentId, page)
      .then((items) => { if (current) { setNotes(items); setState('ready') } })
      .catch(() => { if (current) setState('error') })
    return () => { current = false }
  }, [documentId, page, attempt])

  async function addNote() {
    if (adding) return
    setAdding(true); setAddError('')
    try {
      const note = await createNote(documentId, page)
      setNotes((items) => [...items, note])
    } catch {
      setAddError('메모를 추가하지 못했습니다. 다시 시도하세요.')
    } finally {
      setAdding(false)
    }
  }

  function askDelete(note: Note, trigger: HTMLElement) {
    deleteFocus.current = trigger
    setDeleteError('')
    setDeleting(note)
  }

  async function confirmDelete() {
    const target = deleting
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteNote(target.id)
      setNotes((items) => items.filter((item) => item.id !== target.id))
    } catch {
      setDeleteError('메모를 삭제하지 못했습니다. 다시 시도하세요.')
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  return (
    <aside className="notes-panel" aria-label="메모">
      <header className="notes-panel-header">
        <h3>{page}페이지 메모</h3>
        <button type="button" className="notes-panel-close" aria-label="메모 닫기" onClick={onClose}>×</button>
      </header>
      <button type="button" className="notes-add" disabled={adding || state !== 'ready'} onClick={addNote}>+ 메모 추가</button>
      {addError && <p role="alert">{addError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {state === 'loading' && <p role="status">불러오는 중...</p>}
      {state === 'error' && <div role="alert">메모를 불러오지 못했습니다. <button type="button" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>다시 시도</button></div>}
      {state === 'ready' && notes.length === 0 && <p className="notes-empty">메모가 없습니다.</p>}
      {state === 'ready' && <ul className="notes-list">{notes.map((note) => <NoteItem key={note.id} note={note} onSaved={(saved) => setNotes((items) => items.map((item) => item.id === saved.id ? saved : item))} onDelete={askDelete} />)}</ul>}
      {deleting && <ConfirmPopup title="메모 삭제" message={`“${deleting.title}” 메모를 삭제하시겠습니까? 되돌릴 수 없습니다.`} confirmLabel="삭제 확인" onClose={() => { if (!deleteBusy) setDeleting(null) }} onConfirm={confirmDelete} returnFocusRef={deleteFocus} />}
    </aside>
  )
}