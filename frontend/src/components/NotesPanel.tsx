import { useEffect, useState } from 'react'
import { createNote, listNotes } from '../notesApi'
import type { Note } from '../types'

type NotesPanelProps = { documentId: number; page: number; onClose: () => void }

export default function NotesPanel({ documentId, page, onClose }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

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

  return (
    <aside className="notes-panel" aria-label="메모">
      <header className="notes-panel-header">
        <h3>{page}페이지 메모</h3>
        <button type="button" className="notes-panel-close" aria-label="메모 닫기" onClick={onClose}>×</button>
      </header>
      <button type="button" className="notes-add" disabled={adding || state !== 'ready'} onClick={addNote}>+ 메모 추가</button>
      {addError && <p role="alert">{addError}</p>}
      {state === 'loading' && <p role="status">불러오는 중...</p>}
      {state === 'error' && <div role="alert">메모를 불러오지 못했습니다. <button type="button" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>다시 시도</button></div>}
      {state === 'ready' && notes.length === 0 && <p className="notes-empty">메모가 없습니다.</p>}
      {state === 'ready' && <ul className="notes-list">{notes.map((note) => <li key={note.id} className="note-item"><h4>{note.title}</h4><p>{note.content}</p></li>)}</ul>}
    </aside>
  )
}