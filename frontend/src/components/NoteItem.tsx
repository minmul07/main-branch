import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent, FormEvent, KeyboardEvent } from 'react'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const titleInput = useRef<HTMLInputElement>(null)
  const contentInput = useRef<HTMLTextAreaElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)

  useLayoutEffect(() => {
    if (editing) contentInput.current?.focus()
  }, [editing])

  useLayoutEffect(() => {
    if (!editing && restoreFocus.current && !busy) {
      menuButton.current?.focus()
      restoreFocus.current = false
    }
  }, [editing, busy])

  useEffect(() => {
    if (!menuOpen) return
    function closeOutside(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('click', closeOutside)
    return () => document.removeEventListener('click', closeOutside)
  }, [menuOpen])

  // Escape closes only the menu (not the whole notes panel); tabbing out of it closes it too.
  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setMenuOpen(false)
    menuButton.current?.focus()
  }

  function handleMenuBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false)
  }

  function startEdit() {
    setMenuOpen(false)
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
      setError('메모 제목을 입력하세요.')
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
          <label>제목<input ref={titleInput} aria-label="메모 제목" value={title} maxLength={100} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>내용<textarea ref={contentInput} aria-label="메모 내용" value={content} maxLength={10000} rows={4} disabled={busy} onChange={(event) => setContent(event.target.value)} /></label>
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
            <div className="note-item-menu" ref={menuRef} onKeyDown={handleMenuKey} onBlur={handleMenuBlur}>
              <button
                ref={menuButton}
                type="button"
                className="note-item-menu-toggle"
                aria-label={`${note.title} 메뉴`}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen((open) => !open)}
              >⋮</button>
              {menuOpen && <div className="note-item-menu-content">
                <button type="button" aria-label={`${note.title} 수정`} onClick={startEdit}>수정</button>
                <button type="button" className="danger" aria-label={`${note.title} 삭제`} onClick={() => { setMenuOpen(false); onDelete(menuButton.current!) }}>삭제</button>
              </div>}
            </div>
          </div>
          {note.content && <p className="note-item-body">{note.content}</p>}
        </>
      )}
    </li>
  )
}
