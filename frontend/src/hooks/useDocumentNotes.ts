import { useEffect, useMemo, useRef, useState } from 'react'
import { createNote, deleteNote, listDocumentNotes, updateNote } from '../notesApi'
import type { Note } from '../types'

export type NotesState = 'loading' | 'ready' | 'error'
export type NoteRequest = 'create' | 'save' | 'remove'

export type DocumentNotes = {
  state: NotesState
  // True once a list has been received; the last list stays visible while it is reloaded.
  loaded: boolean
  byPage: ReadonlyMap<number, Note[]>
  // The write in progress for each page.
  busyPages: ReadonlyMap<number, NoteRequest>
  // Pages whose last create failed without a clear result; creating there waits for a reload.
  uncertainPages: ReadonlySet<number>
  // Unsent composer text per page, kept while the sheet or margin shows another page.
  drafts: ReadonlyMap<number, string>
  setDraft: (page: number, text: string) => void
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
  const [loaded, setLoaded] = useState(false)
  const pending = useRef(new Map<number, NoteRequest>())
  const [busyPages, setBusyPages] = useState<ReadonlyMap<number, NoteRequest>>(() => new Map())
  const [uncertainPages, setUncertainPages] = useState<ReadonlySet<number>>(() => new Set())
  const [drafts, setDrafts] = useState<ReadonlyMap<number, string>>(() => new Map())
  const writing = busyPages.size > 0

  useEffect(() => {
    // A reload waits for in-flight writes so their results are included in the new list.
    if (!enabled || state !== 'loading' || writing) return
    const request = new AbortController()
    listDocumentNotes(documentId, request.signal)
      .then((items) => {
        if (request.signal.aborted) return
        setNotes(items)
        setLoaded(true)
        setUncertainPages(new Set())
        setState('ready')
      })
      .catch(() => { if (!request.signal.aborted) setState('error') })
    return () => request.abort()
  }, [documentId, enabled, state, writing])

  const byPage = useMemo(() => {
    const pages = new Map<number, Note[]>()
    for (const note of [...notes].sort((a, b) => a.id - b.id)) {
      if (note.page_number === null) continue
      pages.set(note.page_number, [...(pages.get(note.page_number) ?? []), note])
    }
    return pages
  }, [notes])

  async function mutate<T>(page: number, kind: NoteRequest, request: () => Promise<T>): Promise<T> {
    if (pending.current.has(page)) throw new Error('A note request is already in progress')
    pending.current.set(page, kind)
    setBusyPages(new Map(pending.current))
    try {
      return await request()
    } finally {
      pending.current.delete(page)
      setBusyPages(new Map(pending.current))
    }
  }

  return {
    state,
    loaded,
    byPage,
    busyPages,
    uncertainPages,
    drafts,
    setDraft(page, text) {
      setDrafts((items) => new Map(items).set(page, text))
    },
    reload: () => setState('loading'),
    async create(page, content) {
      const note = await mutate(page, 'create', async () => {
        try {
          return await createNote(documentId, page, content)
        } catch (error) {
          setUncertainPages((pages) => new Set(pages).add(page))
          throw error
        }
      })
      setNotes((items) => [...items, note])
      return note
    },
    async save(note, title, content) {
      const saved = await mutate(note.page_number ?? 0, 'save', () => updateNote(note.id, { title, content }))
      setNotes((items) => items.map((item) => item.id === saved.id ? saved : item))
    },
    async remove(note) {
      await mutate(note.page_number ?? 0, 'remove', () => deleteNote(note.id))
      setNotes((items) => items.filter((item) => item.id !== note.id))
    },
  }
}
