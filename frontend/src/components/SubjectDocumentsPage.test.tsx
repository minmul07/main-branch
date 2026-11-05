import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import SubjectDocumentsPage from './SubjectDocumentsPage'
vi.mock('./PdfViewer', () => ({ default: ({ documentId }: { documentId: number }) => <div data-testid="viewer">PDF {documentId}</div> }))
vi.mock('./UploadDialog', () => ({ default: ({ onUploaded }: { onUploaded: () => void }) => <button onClick={onUploaded}>모의 업로드 완료</button> }))

const docs = [
  { id: 11, subject_id: 1, filename: '선택.pdf', week_number: 1, file_size_bytes: 100, uploaded_at: '2026-11-01T00:00:00Z', page_count: 1 },
  { id: 12, subject_id: 1, filename: '유지.pdf', week_number: 2, file_size_bytes: 100, uploaded_at: '2026-11-01T00:00:00Z', page_count: 1 },
]
const ok = (data: unknown) => ({ ok: true, json: async () => data })
function Harness() {
  const [selected, setSelected] = useState<number | null>(11)
  return <SubjectDocumentsPage subject={{ id: 1, name: '수업', document_count: 2 }} selectedDocumentId={selected} onBack={() => {}} onSelectDocument={setSelected} />
}

test('document menu opens one at a time and closes outside without changing selection', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok(docs))
  vi.stubGlobal('fetch', fetchMock)
  render(<Harness />)
  await screen.findByTestId('viewer')
  expect(screen.queryByRole('button', { name: '선택.pdf 삭제' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 메뉴' }))
  expect(screen.getByRole('button', { name: '선택.pdf 삭제' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '유지.pdf 메뉴' }))
  expect(screen.queryByRole('button', { name: '선택.pdf 삭제' })).toBeNull()
  expect(screen.getByRole('button', { name: '유지.pdf 삭제' })).toBeTruthy()
  expect(screen.getByTestId('viewer').textContent).toBe('PDF 11')
  fireEvent.click(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test.each([11, 12])('deletes document %s and clears only the deleted selection/viewer', async (id) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(docs)).mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce(ok(docs.filter((doc) => doc.id !== id))))
  render(<Harness />)
  expect(await screen.findByTestId('viewer')).toBeTruthy()
  const name = docs.find((doc) => doc.id === id)!.filename
  fireEvent.click(screen.getByRole('button', { name: `${name} 메뉴` }))
  fireEvent.click(screen.getByRole('button', { name: `${name} 삭제` }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: `${name} 삭제` })).toBeNull()
  if (id === 11) expect(screen.queryByTestId('viewer')).toBeNull()
  else expect(screen.getByTestId('viewer').textContent).toBe('PDF 11')
  expect(screen.getByRole('button', { name: `${id === 11 ? '유지.pdf' : '선택.pdf'} 메뉴` })).toBeTruthy()
})

test('network outcome reconciliation clears a remotely removed selected document', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(docs)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(ok([docs[1]])))
  render(<Harness />)
  await screen.findByTestId('viewer')
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 메뉴' }))
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  await screen.findByRole('alert')
  expect(screen.getByTestId('viewer')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
  await waitFor(() => expect(screen.queryByTestId('viewer')).toBeNull())
})

test('document cancel preserves viewer and restores the delete trigger focus', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok(docs))
  vi.stubGlobal('fetch', fetchMock)
  render(<Harness />)
  await screen.findByTestId('viewer')
  const trigger = screen.getByRole('button', { name: '선택.pdf 메뉴' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(document.activeElement).toBe(trigger)
  expect(screen.getByTestId('viewer').textContent).toBe('PDF 11')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('older in-flight document list cannot restore a successfully deleted item', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(docs))
    .mockReturnValueOnce(new Promise((r) => { resolve = r }))
    .mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce(ok([docs[1]])))
  render(<Harness />)
  await screen.findByTestId('viewer')
  fireEvent.click(screen.getByRole('button', { name: '자료 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '모의 업로드 완료' }))
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 메뉴' }))
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await act(async () => resolve(ok(docs)))
  expect(screen.queryByRole('button', { name: '선택.pdf 메뉴' })).toBeNull()
  expect(screen.getByRole('button', { name: '유지.pdf 메뉴' })).toBeTruthy()
})

test('late document DELETE after switching subjects preserves new selection', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(docs)).mockReturnValueOnce(new Promise((r) => { resolve = r })).mockResolvedValue(ok([{ ...docs[1], subject_id: 2 }])))
  const onSelect = vi.fn()
  const view = render(<SubjectDocumentsPage key={1} subject={{ id: 1, name: '수업', document_count: 2 }} selectedDocumentId={11} onBack={() => {}} onSelectDocument={onSelect} />)
  await screen.findByTestId('viewer')
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 메뉴' }))
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  view.rerender(<SubjectDocumentsPage key={2} subject={{ id: 2, name: '다른 수업', document_count: 2 }} selectedDocumentId={12} onBack={() => {}} onSelectDocument={onSelect} />)
  await screen.findByRole('button', { name: '유지.pdf 메뉴' })
  await act(async () => resolve({ status: 204 }))
  expect(screen.getByTestId('viewer').textContent).toBe('PDF 12')
  expect(onSelect).not.toHaveBeenCalled()
})

test('returning before old DELETE settles reconciles the current list and selection', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(docs)).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    .mockResolvedValueOnce(ok(docs)).mockResolvedValueOnce(ok([docs[1]])))
  const view = render(<Harness key="first" />)
  await screen.findByTestId('viewer')
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 메뉴' }))
  fireEvent.click(screen.getByRole('button', { name: '선택.pdf 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  view.rerender(<Harness key="returned" />)
  await screen.findByTestId('viewer')
  await act(async () => resolve({ status: 204 }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '선택.pdf 메뉴' })).toBeNull())
  expect(screen.queryByTestId('viewer')).toBeNull()
  expect(screen.getByRole('button', { name: '유지.pdf 메뉴' })).toBeTruthy()
})

test('collapses and restores the document list with keyboard focus', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  render(<SubjectDocumentsPage subject={{ id: 1, name: '수업', document_count: 2 }} selectedDocumentId={null} onBack={() => {}} onSelectDocument={() => {}} />)
  await screen.findByText('등록된 자료가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '자료 목록 접기' }))
  const show = screen.getByRole('button', { name: '자료 목록 펼치기' })
  expect(show.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(show)
  expect(document.getElementById('document-sidebar')?.hasAttribute('inert')).toBe(true)
  fireEvent.click(show)
  const hide = screen.getByRole('button', { name: '자료 목록 접기' })
  expect(hide.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(hide)
  expect(document.getElementById('document-sidebar')?.hasAttribute('inert')).toBe(false)
  expect(screen.getByText('등록된 자료가 없습니다.')).toBeTruthy()
  vi.unstubAllGlobals()
})
