import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { API_BASE_URL } from '../config'
import type { Note } from '../types'
import NotesPanel from './NotesPanel'

const fetchMock = vi.fn<typeof fetch>()
const panel = { id: 'notes', documentId: 7, page: 1, open: true }
const pageUrl = (page: number) => `${API_BASE_URL}/documents/7/pages/${page}/notes`
const note = (id: number, page: number, title: string): Note => ({
  id, document_id: 7, page_number: page, title, content: '',
  created_at: '2026-11-24T01:00:00Z', updated_at: '2026-11-24T01:00:00Z',
})
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const click = (name: string) => fireEvent.click(button(name))

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

test('starts loading on open and ignores a stale response after a page change', async () => {
  const first = deferredResponse()
  const second = deferredResponse()
  fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { rerender } = render(<NotesPanel {...panel} open={false} />)
  expect(fetchMock).not.toHaveBeenCalled()
  rerender(<NotesPanel {...panel} />)
  expect(screen.getByRole('status').textContent).toContain('불러오는 중')
  expect(button('메모 추가').disabled).toBe(true)
  rerender(<NotesPanel {...panel} page={2} />)
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([pageUrl(1), pageUrl(2)])

  await act(async () => { second.resolve(Response.json([note(2, 2, '둘째 페이지')])) })
  await act(async () => { first.resolve(Response.json([note(1, 1, '첫째 페이지')])) })
  expect(screen.getByText('둘째 페이지')).toBeTruthy()
  expect(screen.queryByText('첫째 페이지')).toBeNull()
})

test('retries a failed list and uses the server default name for new notes', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(note(1, 1, '메모 1'), { status: 201 }))
  render(<NotesPanel {...panel} />)
  expect((await screen.findByRole('alert')).textContent).toContain('메모를 불러오지 못했습니다.')
  click('다시 시도')
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  click('메모 추가')
  expect(await screen.findByRole('heading', { name: '메모 1' })).toBeTruthy()
  expect(fetchMock.mock.calls[2]).toEqual([pageUrl(1), expect.objectContaining({ method: 'POST', body: '{}' })])
})

test('waits for a pending create before reloading its page and prevents repeat submission', async () => {
  const pending = deferredResponse()
  const created = note(1, 1, '메모 1')
  fetchMock.mockResolvedValueOnce(Response.json([]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json([note(2, 2, '둘째 페이지')]))
    .mockResolvedValueOnce(Response.json([created]))
  const { rerender } = render(<NotesPanel {...panel} />)
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  click('메모 추가')
  click('메모 추가')
  expect(fetchMock).toHaveBeenCalledTimes(2)

  rerender(<NotesPanel {...panel} page={2} />)
  await screen.findByText('둘째 페이지')
  rerender(<NotesPanel {...panel} />)
  expect(button('메모 추가').disabled).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  await act(async () => { pending.resolve(Response.json(created, { status: 201 })) })
  expect(await screen.findByText('메모 1')).toBeTruthy()
  expect(fetchMock.mock.calls[3][0]).toBe(pageUrl(1))
})

test('refreshes the list after an uncertain create result before allowing another create', async () => {
  const created = note(1, 1, '메모 1')
  fetchMock.mockResolvedValueOnce(Response.json([]))
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(Response.json([created]))
  render(<NotesPanel {...panel} />)
  await screen.findByText('이 페이지에는 메모가 없습니다.')
  click('메모 추가')
  await screen.findByRole('alert')
  expect(button('메모 추가').disabled).toBe(true)
  click('목록 다시 확인')
  expect(await screen.findByText('메모 1')).toBeTruthy()
  expect(button('메모 추가').disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

test('retains the edit draft on failure and saves the trimmed name and content on retry', async () => {
  const existing = note(1, 1, '메모 1')
  const updated = { ...existing, title: '개념 정리', content: '첫 줄\n둘째 줄' }
  const pending = deferredResponse()
  fetchMock.mockResolvedValueOnce(Response.json([existing]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json(updated))
  render(<NotesPanel {...panel} />)
  await screen.findByText('메모 1')
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

test('confirms note deletion, blocks duplicate requests, and allows retry in the dialog', async () => {
  const pending = deferredResponse()
  fetchMock.mockResolvedValueOnce(Response.json([note(1, 1, '메모 1')]))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  render(<NotesPanel {...panel} />)
  await screen.findByText('메모 1')
  click('메모 1 삭제')
  const dialog = screen.getByRole('dialog', { name: '메모 삭제' })
  expect(within(dialog).getByText(/메모 1/)).toBeTruthy()
  click('취소')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(button('메모 1 삭제'))

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
