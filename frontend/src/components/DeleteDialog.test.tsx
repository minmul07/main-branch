import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import DeleteDialog from './DeleteDialog'

beforeEach(() => vi.restoreAllMocks())
const response = (status: number) => ({ status }) as Response
function setup() {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const onRefresh = vi.fn().mockResolvedValue(undefined)
  const props = { kind: 'documents' as const, id: 42, name: '강의.pdf', returnFocusRef: { current: null }, onClose, onDeleted, onRefresh }
  const view = render(<DeleteDialog {...props} />)
  return { ...view, ...props }
}

test('cancel and backdrop preserve data; keyboard focus stays within confirmation', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { onClose } = setup()
  const cancel = screen.getByRole('button', { name: '취소' })
  const confirm = screen.getByRole('button', { name: '삭제 확인' })
  expect(document.activeElement).toBe(cancel)
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(confirm)
  fireEvent.keyDown(confirm, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)
  fireEvent.click(screen.getByRole('presentation'))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('DELETE uses server id and empty 204 without JSON, locks all exits and duplicate requests', async () => {
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>((r) => { resolve = r })
  const fetchMock = vi.fn().mockReturnValue(pending)
  vi.stubGlobal('fetch', fetchMock)
  const { onClose, onDeleted, onRefresh } = setup()
  const confirm = screen.getByRole('button', { name: '삭제 확인' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('presentation'))
  expect(onClose).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/documents\/42$/)
  expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'DELETE' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  const outside = document.createElement('button')
  document.body.append(outside)
  outside.focus()
  expect(document.activeElement).toBe(screen.getByRole('dialog'))
  outside.remove()
  await act(async () => resolve(response(204)))
  expect(onDeleted).toHaveBeenCalledTimes(1)
  expect(onRefresh).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test.each([404, 500, 0])('uncertain or missing result %s preserves target until explicit list reconciliation', async (status) => {
  const fetchMock = status ? vi.fn().mockResolvedValue(response(status)) : vi.fn().mockRejectedValue(new TypeError('offline'))
  vi.stubGlobal('fetch', fetchMock)
  const { onDeleted, onRefresh, onClose } = setup()
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(onDeleted).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  onRefresh.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('목록을 확인하지 못했습니다'))
  fireEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test.each([409, 422])('known rejection %s is retryable and preserves the target', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response(204)))
  const { onDeleted } = setup()
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  expect((await screen.findByRole('alert')).textContent).toContain(status === 409 ? '자료를 먼저 각각 삭제' : 'ID가 올바르지')
  expect(onDeleted).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
})

test('successful deletion with failed list refresh does not repeat DELETE', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(204))
  vi.stubGlobal('fetch', fetchMock)
  const { onRefresh } = setup()
  onRefresh.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  expect((await screen.findByRole('alert')).textContent).toContain('삭제는 완료')
  fireEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('late response after navigation/unmount cannot mutate selection or refresh old page', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((r) => { resolve = r })))
  const { unmount, onDeleted, onRefresh, onClose } = setup()
  fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }))
  unmount()
  await act(async () => resolve(response(204)))
  expect(onDeleted).not.toHaveBeenCalled()
  expect(onRefresh).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
