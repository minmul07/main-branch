import { useState } from 'react'
import { updateNote } from '../notesApi'
import type { Note } from '../types'

type NoteItemProps = { note: Note; onSaved: (note: Note) => void }

export default function NoteItem({ note, onSaved }: NoteItemProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setTitle(note.title); setContent(note.content); setError(''); setEditing(true)
  }

  async function save() {
    if (busy) return
    if (!title.trim()) { setError('이름을 입력하세요.'); return }
    setBusy(true); setError('')
    try {
      const saved = await updateNote(note.id, { title, content })
      onSaved(saved)
      setEditing(false)
    } catch {
      setError('저장하지 못했습니다. 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <li className="note-item">
        <div className="note-item-header">
          <h4>{note.title}</h4>
          <button type="button" aria-label={`${note.title} 수정`} onClick={startEdit}>수정</button>
        </div>
        <p>{note.content}</p>
      </li>
    )
  }

  return (
    <li className="note-item">
      <input aria-label="메모 이름" value={title} maxLength={100} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      <textarea aria-label="메모 내용" value={content} maxLength={10000} rows={4} disabled={busy} onChange={(event) => setContent(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <div className="note-item-actions">
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>취소</button>
        <button type="button" disabled={busy} onClick={save}>저장</button>
      </div>
    </li>
  )
}