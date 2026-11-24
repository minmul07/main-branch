import { useEffect, useMemo, useRef, useState } from 'react'
import { createNote, deleteNote, listDocumentNotes, updateNote } from '../notesApi'
import type { Note } from '../types'

export type NotesState = 'loading' | 'ready' | 'error'

export type DocumentNotes = {
  state: NotesState
  byPage: ReadonlyMap<number, Note[]>
  busyPages: ReadonlySet<number>
  reload: () => void
  create: (page: number, content: string) => Promise<Note>
  save: (note: Note, title: string, content: string) => Promise<void>
  remove: (note: Note) => Promise<void>
}

// Loads every note of a document once so the viewer can show page badges and margin notes
// without one request per page. Writes are serialized per page to block duplicate submits.
export function useDocumentNotes(documentId: number, enabled = true): DocumentNotes {
  const [notes, setNotes] = useState<Note[]>([])
  const [state, setState] = useState<NotesState>('loading')
  const pending = useRef(new Set<number>())
  const [busyPages, setBusyPages] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    // A reload waits for in-flight writes so their results are included in the new list.
    if (!enabled || state !== 'loading' || busyPages.size > 0) return
    const request = new AbortController()
    listDocumentNotes(documentId, request.signal)
      .then((items) => {
        if (request.signal.aborted) return
        setNotes(items)
        setState('ready')
      })
      .catch(() => { if (!request.signal.aborted) setState('error') })
    return () => request.abort()
  }, [documentId, enabled, state, busyPages])

  const byPage = useMemo(() => {
    const pages = new Map<number, Note[]>()
    for (const note of [...notes].sort((a, b) => a.id - b.id)) {
      if (note.page_number === null) continue
      pages.set(note.page_number, [...(pages.get(note.page_number) ?? []), note])
    }
    return pages
  }, [notes])

  async function mutate<T>(page: number, request: () => Promise<T>): Promise<T> {
    if (pending.current.has(page)) throw new Error('A note request is already in progress')
    pending.current.add(page)
    setBusyPages(new Set(pending.current))
    try {
      return await request()
    } finally {
      pending.current.delete(page)
      setBusyPages(new Set(pending.current))
    }
  }

  return {
    state,
    byPage,
    busyPages,
    reload: () => setState('loading'),
    async create(page, content) {
      const note = await mutate(page, () => createNote(documentId, page, content))
      setNotes((items) => [...items, note])
      return note
    },
    async save(note, title, content) {
      const saved = await mutate(note.page_number ?? 0, () => updateNote(note.id, { title, content }))
      setNotes((items) => items.map((item) => item.id === saved.id ? saved : item))
    },
    async remove(note) {
      await mutate(note.page_number ?? 0, () => deleteNote(note.id))
      setNotes((items) => items.filter((item) => item.id !== note.id))
    },
  }
}
