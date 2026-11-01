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
  getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }), render: () => ({ promise: Promise.resolve(), cancel }) })
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
})

test('loads the selected PDF, navigates pages, and releases it', async () => {
  const { unmount } = render(<PdfViewer documentId={7} />)
  expect(getDocument).toHaveBeenCalledWith({ url: 'http://127.0.0.1:8000/documents/7/file' })
  expect(await screen.findByText('/ 2')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('1')
  expect((screen.getByRole('button', { name: '이전' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled()
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('2')
  await waitFor(() => expect(getPage).toHaveBeenCalledWith(2))
  expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
  unmount()
  expect(destroy).toHaveBeenCalled()
})

test('updates the current page when the viewer scrolls', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  const area = screen.getByRole('region', { name: 'PDF 페이지' })
  const pages = area.querySelectorAll<HTMLElement>('[data-page]')
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
  vi.spyOn(pages[0], 'getBoundingClientRect').mockReturnValue({ top: -600 } as DOMRect)
  vi.spyOn(pages[1], 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect)
  fireEvent.scroll(area)
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('2')
})

test('offers retry when the PDF cannot be loaded', async () => {
  getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('failed')), destroy })
  render(<PdfViewer documentId={7} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('/ 2')).toBeTruthy()
  expect(getDocument).toHaveBeenCalledTimes(2)
})

test('validates page input and jumps to a valid page', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  const input = screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '2' } })
  fireEvent.submit(input.closest('form')!)
  expect(input.value).toBe('2')
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled()
  for (const value of ['', '2.5', '0', '3']) {
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    expect(input.value).toBe('2')
  }
})

test('changes zoom with buttons and control wheel', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  expect(screen.getByLabelText('확대 배율').textContent).toBe('100%')
  fireEvent.click(screen.getByRole('button', { name: '확대' }))
  expect(screen.getByLabelText('확대 배율').textContent).toBe('120%')
  fireEvent.click(screen.getByRole('button', { name: '축소' }))
  expect(screen.getByLabelText('확대 배율').textContent).toBe('100%')
  fireEvent.wheel(screen.getByRole('region', { name: 'PDF 페이지' }), { ctrlKey: true, deltaY: -100 })
  expect(screen.getByLabelText('확대 배율').textContent).toBe('122%')
})

test('edits zoom by click and rejects invalid values', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  fireEvent.click(screen.getByRole('button', { name: '확대 배율' }))
  let input = screen.getByRole('textbox', { name: '확대 배율' }) as HTMLInputElement
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: '175%' } })
  fireEvent.submit(input.closest('form')!)
  expect(screen.getByRole('button', { name: '확대 배율' }).textContent).toBe('175%')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '확대 배율' }))
  expect(screen.getByRole('button', { name: '너비 맞춤' })).toBeTruthy()
  for (const value of ['', 'abc', '24', '401']) {
    fireEvent.click(screen.getByRole('button', { name: '확대 배율' }))
    input = screen.getByRole('textbox', { name: '확대 배율' }) as HTMLInputElement
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    expect(screen.getByRole('button', { name: '확대 배율' }).textContent).toBe('175%')
  }
  fireEvent.click(screen.getByRole('button', { name: '확대 배율' }))
  input = screen.getByRole('textbox', { name: '확대 배율' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '200' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '확대 배율' }).textContent).toBe('175%')
})

test('fits to viewport width and height', async () => {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(440)
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(440)
  try {
    render(<PdfViewer documentId={7} />)
    await waitFor(() => expect(screen.getByLabelText('확대 배율').textContent).toBe('330%'))
    expect(screen.getByRole('region', { name: 'PDF 페이지' }).classList.contains('pdf-fit-width')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '높이 맞춤' }))
    expect(screen.getByLabelText('확대 배율').textContent).toBe('150%')
    expect(screen.getByRole('region', { name: 'PDF 페이지' }).classList.contains('pdf-fit-width')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '너비 맞춤' }))
    expect(screen.getByLabelText('확대 배율').textContent).toBe('330%')
    fireEvent.click(screen.getByRole('button', { name: '축소' }))
    expect(screen.getByRole('button', { name: '너비 맞춤' })).toBeTruthy()
  } finally { width.mockRestore(); height.mockRestore() }
})

test('zooms with a two-finger pinch', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  const area = screen.getByRole('region', { name: 'PDF 페이지' })
  fireEvent.touchStart(area, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] })
  fireEvent.touchMove(area, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 150, clientY: 0 }] })
  expect(screen.getByLabelText('확대 배율').textContent).toBe('150%')
  fireEvent.touchEnd(area, { touches: [] })
})
