import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import DocumentProcessingStatus, { PROCESSING_POLL_MS } from './DocumentProcessingStatus'

const job = (status: string, error_code: string | null = null) => ({
  ok: true, status: 200, json: async () => ({ document_id: 5, status, error_code, page_kinds: status === 'completed' ? ['image'] : null }),
})
const accepted = { ok: true, status: 202, json: async () => ({ document_id: 5, status: 'pending', error_code: null, page_kinds: null }) }
const statusOnly = (status: number) => ({ ok: false, status, json: async () => ({ detail: 'x' }) })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('shows nothing for completed documents', async () => {
  const fetchMock = vi.fn().mockResolvedValue(job('completed'))
  vi.stubGlobal('fetch', fetchMock)
  const { container } = render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/documents\/5\/processing$/)
  expect(container.textContent).toBe('')
})

test('polls while pending/processing and reports completion once', async () => {
  vi.useFakeTimers()
  const onCompleted = vi.fn()
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(job('pending'))
    .mockResolvedValueOnce(job('processing'))
    .mockResolvedValueOnce(job('completed'))
  vi.stubGlobal('fetch', fetchMock)
  render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" onCompleted={onCompleted} />)
  await act(async () => {})
  expect(screen.getByRole('status').textContent).toBe('처리 대기 중')
  await act(async () => { await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS) })
  expect(screen.getByRole('status').textContent).toContain('처리 중')
  await act(async () => { await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(onCompleted).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS * 3) })
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test.each([
  ['ocr_failed', 'OCR'],
  ['ocr_unavailable', 'OCR을 사용할 수 없습니다'],
  ['invalid_pdf', 'PDF를 읽을 수 없습니다'],
  ['something_new', '알 수 없는 오류'],
])('shows failure reason for %s', async (code, text) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(job('failed', code)))
  render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" />)
  expect((await screen.findByRole('alert')).textContent).toContain(text)
  expect(screen.getByRole('button', { name: 'scan.pdf 다시 처리' })).toBeTruthy()
})

test('retry disables the button while requesting, prevents double submit and resumes polling', async () => {
  let resolveRetry: (value: unknown) => void = () => {}
  const onCompleted = vi.fn()
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(job('failed', 'ocr_failed'))
    .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve }))
    .mockResolvedValueOnce(job('completed'))
  vi.stubGlobal('fetch', fetchMock)
  render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" onCompleted={onCompleted} />)
  const button = await screen.findByRole('button', { name: 'scan.pdf 다시 처리' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.textContent).toBe('요청 중...')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1]).toEqual([expect.stringMatching(/\/documents\/5\/processing\/retry$/), { method: 'POST' }])
  await act(async () => { resolveRetry(accepted) })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(onCompleted).toHaveBeenCalledTimes(1)
})

test('retry conflict re-reads the current status', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(job('failed', 'interrupted'))
    .mockResolvedValueOnce(statusOnly(409))
    .mockResolvedValueOnce(job('processing'))
  vi.stubGlobal('fetch', fetchMock)
  render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" />)
  fireEvent.click(await screen.findByRole('button', { name: 'scan.pdf 다시 처리' }))
  expect((await screen.findByRole('status')).textContent).toContain('처리 중')
})

test('retry server error keeps the failure and lets the user try again', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(job('failed', 'ocr_failed'))
    .mockResolvedValueOnce(statusOnly(500))
  vi.stubGlobal('fetch', fetchMock)
  render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" />)
  fireEvent.click(await screen.findByRole('button', { name: 'scan.pdf 다시 처리' }))
  expect(await screen.findByText(/다시 처리 요청에 실패했습니다/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'scan.pdf 다시 처리' }) as HTMLButtonElement).disabled).toBe(false)
})

test('load failure offers a re-check; deleted documents render nothing', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(statusOnly(404))
  vi.stubGlobal('fetch', fetchMock)
  const { container } = render(<DocumentProcessingStatus documentId={5} filename="scan.pdf" />)
  fireEvent.click(await screen.findByRole('button', { name: '다시 확인' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(container.textContent).toBe(''))
})
