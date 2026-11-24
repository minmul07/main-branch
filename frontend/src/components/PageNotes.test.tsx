import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { API_BASE_URL } from '../config'
import { useDocumentNotes } from '../hooks/useDocumentNotes'
import type { Note } from '../types'
import PageNotes from './PageNotes'

const fetchMock = vi.fn<typeof fetch>()
const documentUrl = `${API_BASE_URL}/documents/7/notes`
const pageUrl = (page: number) => `${API_BASE_URL}/documents/7/pages/${page}/notes`
const note = (id: number, page: number, title: string, content = ''): Note => ({
  id, document_id: 7, page_number: page, title, content,
  created_at: '2026-11-24T01:00:00Z', updated_at: '2026-11-24T01:00:00Z',
})
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const click = (name: string) => fireEvent.click(button(name))
const draft = (page = 1) => screen.getByRole<HTMLTextAreaElement>('textbox', { name: `${page}페이지 새 메모` })

function Harness({ page = 1, variant = 'sheet' }: { page?: number; variant?: 'margin' | 'sheet' }) {
  const api = useDocumentNotes(7)
  return <PageNotes id="notes" page={page} notes={api.byPage.get(page) ?? []} api={api} current variant={variant} />
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => { resolve = complete })
  return { promise, resolve }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

test('loads the document notes once and shows only the notes of its page', async () => {
  fetchMock.mockResolvedValueOnce(Response.json([note(1, 1, '첫째'), note(2, 2, '둘째'), note(3, 1, '셋째')]))
  const { rerender } = render(<Harness />)
  expect(screen.getByRole('status').textContent).toContain('불러오는 중')
  expect(await screen.findByRole('heading', { name: '첫째' })).toBeTruthy()
  const list = screen.getByRole('list', { name: '1페이지 메모 목록' })
  expect(within(list).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['첫째', '셋째'])
  rerender(<Harness page={2} />)
  expect(screen.getByRole('heading', { name: '둘째' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '첫째' })).toBeNull()
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([documentUrl])
})

test('retries a failed list and adds a note from the composer', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(note(1, 1, '메모 1', '프로세스 정의'), { status: 201 }))
  render(<Harness />)
  expect((await screen.findByRole('alert')).textContent).toContain('메모를 불러오지 못했습니다.')
  click('다시 시도')
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  expect(button('추가').disabled).toBe(true)
  fireEvent.change(draft(), { target: { value: '  프로세스 정의  ' } })
  fireEvent.keyDown(draft(), { key: 'Enter', ctrlKey: true })
  expect(await screen.findByRole('heading', { name: '메모 1' })).toBeTruthy()
  expect(fetchMock.mock.calls[2]).toEqual([pageUrl(1), expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: '프로세스 정의' }) })])
  expect(draft().value).toBe('')
})

test('waits for a pending create before reloading and prevents repeat submission', async () => {
  const pending = deferredResponse()
  const created = note(1, 1, '메모 1', '내용')
  fetchMock.mockResolvedValueOnce(Response.json([]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json([created]))
  render(<Harness />)
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  fireEvent.change(draft(), { target: { value: '내용' } })
  click('추가')
  click('추가 중…')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(button('추가 중…').disabled).toBe(true)
  await act(async () => { pending.resolve(Response.json(created, { status: 201 })) })
  expect(await screen.findByRole('heading', { name: '메모 1' })).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('refreshes the list after an uncertain create result before allowing another create', async () => {
  const created = note(1, 1, '메모 1', '내용')
  fetchMock.mockResolvedValueOnce(Response.json([]))
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(Response.json([created]))
  render(<Harness />)
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  fireEvent.change(draft(), { target: { value: '내용' } })
  click('추가')
  await screen.findByRole('alert')
  expect(draft().value).toBe('내용')
  expect(button('추가').disabled).toBe(true)
  click('목록 다시 확인')
  expect(await screen.findByRole('heading', { name: '메모 1' })).toBeTruthy()
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([documentUrl, pageUrl(1), documentUrl])
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

test('margin composer opens on demand, keeps its draft on Escape, and closes after adding', async () => {
  const created = note(1, 1, '메모 1', '정리')
  fetchMock.mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(created, { status: 201 }))
  render(<Harness variant="margin" />)
  const add = await screen.findByRole('button', { name: '1페이지에 메모 추가' })
  expect(screen.queryByText('이 페이지에는 메모가 없습니다.')).toBeNull()
  fireEvent.click(add)
  expect(document.activeElement).toBe(draft())
  fireEvent.change(draft(), { target: { value: '정리' } })
  fireEvent.keyDown(draft(), { key: 'Escape' })
  expect(screen.queryByRole('textbox')).toBeNull()
  click('1페이지에 메모 추가')
  expect(draft().value).toBe('정리')
  click('추가')
  expect(await screen.findByRole('heading', { name: '메모 1' })).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(document.activeElement).toBe(button('1페이지에 메모 추가'))
})

test('retains the edit draft on failure and saves the trimmed name and content on retry', async () => {
  const existing = note(1, 1, '메모 1')
  const updated = { ...existing, title: '개념 정리', content: '첫 줄\n둘째 줄' }
  const pending = deferredResponse()
  fetchMock.mockResolvedValueOnce(Response.json([existing]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json(updated))
  render(<Harness />)
  await screen.findByText('메모 1')
  click('메모 1 메뉴')
  click('메모 1 수정')
  const title = screen.getByRole<HTMLInputElement>('textbox', { name: '메모 이름' })
  const content = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
  fireEvent.change(title, { target: { value: '  ' } })
  click('저장')
  expect(screen.getByRole('alert').textContent).toContain('메모 이름을 입력')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.change(title, { target: { value: ' 개념 정리 ' } })
  fireEvent.change(content, { target: { value: updated.content } })
  click('저장')
  click('저장')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () => { pending.resolve(new Response(null, { status: 500 })) })
  expect(screen.getByRole('alert').textContent).toContain('메모를 저장하지 못했습니다.')
  expect(title.value).toBe(' 개념 정리 ')
  expect(content.value).toBe(updated.content)
  click('저장')
  expect(await screen.findByRole('heading', { name: updated.title })).toBeTruthy()
  expect(fetchMock.mock.calls[2]).toEqual([
    `${API_BASE_URL}/notes/1`,
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: updated.title, content: updated.content }) }),
  ])
})

test('shows edit and delete in a ⋮ menu that closes on Escape or an outside click', async () => {
  fetchMock.mockResolvedValueOnce(Response.json([note(1, 1, '1페이지 메모 1', '내용')]))
  render(<Harness />)
  await screen.findByText('1페이지 메모 1')
  expect(screen.queryByRole('button', { name: '1페이지 메모 1 수정' })).toBeNull()
  expect(screen.queryByRole('button', { name: '1페이지 메모 1 삭제' })).toBeNull()

  const toggle = button('1페이지 메모 1 메뉴')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(button('1페이지 메모 1 수정')).toBeTruthy()
  expect(button('1페이지 메모 1 삭제')).toBeTruthy()

  fireEvent.keyDown(button('1페이지 메모 1 수정'), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: '1페이지 메모 1 수정' })).toBeNull()
  expect(document.activeElement).toBe(toggle)

  fireEvent.click(toggle)
  fireEvent.click(document.body)
  expect(screen.queryByRole('button', { name: '1페이지 메모 1 삭제' })).toBeNull()
})

test('confirms note deletion, blocks duplicate requests, and allows retry in the dialog', async () => {
  const pending = deferredResponse()
  fetchMock.mockResolvedValueOnce(Response.json([note(1, 1, '메모 1')]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  render(<Harness />)
  await screen.findByText('메모 1')
  click('메모 1 메뉴')
  click('메모 1 삭제')
  const dialog = screen.getByRole('dialog', { name: '메모 삭제' })
  expect(within(dialog).getByText(/메모 1/)).toBeTruthy()
  click('취소')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(button('메모 1 메뉴'))

  click('메모 1 메뉴')
  click('메모 1 삭제')
  click('삭제 확인')
  click('삭제 확인')
  expect(button('취소').disabled).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () => { pending.resolve(new Response(null, { status: 500 })) })
  expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('삭제하지 못했습니다.')
  click('삭제 확인')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('이 페이지에는 메모가 없습니다.')).toBeTruthy()
  expect(fetchMock.mock.calls[2]).toEqual([`${API_BASE_URL}/notes/1`, { method: 'DELETE' }])
})
