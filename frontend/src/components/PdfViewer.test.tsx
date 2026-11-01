import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import PdfViewer from './PdfViewer'

const { getDocument, getPage, destroy, cancel } = vi.hoisted(() => ({
  getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn(), cancel: vi.fn(),
}))
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker' }))

beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollTo = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  getPage.mockResolvedValue({ getViewport: () => ({ width: 100, height: 200 }), render: () => ({ promise: Promise.resolve(), cancel }) })
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
})

test('loads the selected PDF, navigates pages, and releases it', async () => {
  const { unmount } = render(<PdfViewer documentId={7} />)
  expect(getDocument).toHaveBeenCalledWith({ url: 'http://127.0.0.1:8000/documents/7/file' })
  expect(await screen.findByText('1 / 2')).toBeTruthy()
  expect((screen.getByRole('button', { name: '이전' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled()
  expect(screen.getByText('2 / 2')).toBeTruthy()
  await waitFor(() => expect(getPage).toHaveBeenCalledWith(2))
  expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
  unmount()
  expect(destroy).toHaveBeenCalled()
})

test('updates the current page when the viewer scrolls', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('1 / 2')
  const area = screen.getByRole('region', { name: 'PDF 페이지' })
  const pages = area.querySelectorAll<HTMLElement>('[data-page]')
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
  vi.spyOn(pages[0], 'getBoundingClientRect').mockReturnValue({ top: -600 } as DOMRect)
  vi.spyOn(pages[1], 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect)
  fireEvent.scroll(area)
  expect(screen.getByText('2 / 2')).toBeTruthy()
})

test('offers retry when the PDF cannot be loaded', async () => {
  getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('failed')), destroy })
  render(<PdfViewer documentId={7} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('1 / 2')).toBeTruthy()
  expect(getDocument).toHaveBeenCalledTimes(2)
})
