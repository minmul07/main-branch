import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Note } from '../types'

type Props = {
  note: Note
  busy: boolean
  onSave: (title: string, content: string) => Promise<void>
  onDelete: (trigger: HTMLButtonElement) => void
}

export default function NoteItem({ note, busy, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [error, setError] = useState('')
  const titleInput = useRef<HTMLInputElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useLayoutEffect(() => {
    if (editing) titleInput.current?.focus()
  }, [editing])

  useLayoutEffect(() => {
    if (!editing && restoreFocus.current && !busy) {
      editButton.current?.focus()
      restoreFocus.current = false
    }
  }, [editing, busy])

  function startEdit() {
    setTitle(note.title)
    setContent(note.content)
    setError('')
    setEditing(true)
  }

  function finishEdit() {
    restoreFocus.current = true
    setEditing(false)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setError('메모 이름을 입력하세요.')
      titleInput.current?.focus()
      return
    }

    setError('')
    try {
      await onSave(title.trim(), content)
      finishEdit()
    } catch {
      setError('메모를 저장하지 못했습니다. 다시 시도하세요.')
    }
  }

  return (
    <li className="note-item">
      {editing ? (
        <form className="note-item-editor" onSubmit={save}>
          <label>이름<input ref={titleInput} aria-label="메모 이름" value={title} maxLength={100} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>내용<textarea aria-label="메모 내용" value={content} maxLength={10000} rows={4} disabled={busy} onChange={(event) => setContent(event.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
          <div className="note-item-actions">
            <button type="button" disabled={busy} onClick={finishEdit}>취소</button>
            <button type="submit" className="note-primary-action" disabled={busy}>저장</button>
          </div>
        </form>
      ) : (
        <>
          <div className="note-item-header">
            <h4>{note.title}</h4>
            <div className="note-item-actions">
              <button ref={editButton} type="button" aria-label={`${note.title} 수정`} disabled={busy} onClick={startEdit}>수정</button>
              <button type="button" aria-label={`${note.title} 삭제`} disabled={busy} onClick={(event) => onDelete(event.currentTarget)}>삭제</button>
            </div>
          </div>
          {note.content && <p className="note-item-body">{note.content}</p>}
        </>
      )}
    </li>
  )
}
