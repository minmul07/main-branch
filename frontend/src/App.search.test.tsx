import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import App from './App'

vi.mock('./components/PdfViewer', () => ({
  default: ({ documentId, initialPage }: { documentId: number; initialPage?: number }) => (
    <div data-testid="viewer">PDF {documentId} page {initialPage ?? '-'}</div>
  ),
}))
vi.mock('./components/DocumentProcessingStatus', () => ({ default: () => null }))

const ok = (data: unknown) => ({ ok: true, json: async () => data }) as Response
const subjects = [{ id: 7, name: '자료구조', document_count: 2 }]
const docs = [
  { id: 4, subject_id: 7, filename: 'week1.pdf', week_number: 1, file_size_bytes: 100, uploaded_at: '2026-11-01T00:00:00Z', page_count: 30 },
  { id: 5, subject_id: 7, filename: 'other.pdf', week_number: 6, file_size_bytes: 100, uploaded_at: '2026-11-01T00:00:00Z', page_count: 3 },
]
const hit = {
  document_id: 4, page_id: 130, page_number: 21, filename: 'week1.pdf',
  subject_id: 7, subject_name: '자료구조', week_number: 1, snippet: '…LINKED LISTS…',
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/search')) return ok([hit])
    if (url.includes('/documents?subject_id=7')) return ok(docs)
    return ok(subjects)
  }))
})

async function searchAndChooseResult() {
  render(<App />)
  fireEvent.change(await screen.findByRole('searchbox', { name: '검색어' }), { target: { value: 'linked' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  fireEvent.click(await screen.findByRole('button', { name: /week1\.pdf/ }))
}

test('choosing a search result opens its subject, document and page', async () => {
  await searchAndChooseResult()
  expect(window.location.pathname).toBe('/subjects/7')
  expect((await screen.findByTestId('viewer')).textContent).toBe('PDF 4 page 21')
})

test('choosing another document afterwards stops forcing the searched page', async () => {
  await searchAndChooseResult()
  await screen.findByTestId('viewer')
  fireEvent.click(await screen.findByTitle('other.pdf'))
  expect(screen.getByTestId('viewer').textContent).toBe('PDF 5 page -')
  fireEvent.click(screen.getByTitle('week1.pdf'))
  expect(screen.getByTestId('viewer').textContent).toBe('PDF 4 page -')
})