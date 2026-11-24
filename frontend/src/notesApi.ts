import { API_BASE_URL } from './config'
import type { Note } from './types'

function pageNotesUrl(documentId: number, page: number) {
  return `${API_BASE_URL}/documents/${documentId}/pages/${page}/notes`
}

export async function listDocumentNotes(documentId: number, signal: AbortSignal): Promise<Note[]> {
  const response = await fetch(`${API_BASE_URL}/documents/${documentId}/notes`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function createNote(documentId: number, page: number, content = ''): Promise<Note> {
  const response = await fetch(pageNotesUrl(documentId, page), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content ? { content } : {}),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function updateNote(id: number, changes: { title: string; content: string }): Promise<Note> {
  const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function deleteNote(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/notes/${id}`, { method: 'DELETE' })
  if (response.status !== 204 && response.status !== 404) throw new Error(`HTTP ${response.status}`)
}
