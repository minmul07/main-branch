import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import NotesPanel from './NotesPanel'
import PdfViewer from './PdfViewer'

const { getDocument, getPage, destroy, cancel } = vi.hoisted(() => ({
  getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn(), cancel: vi.fn(),
}))
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker' }))
vi.mock('../notesApi', () => ({ listNotes: () => Promise.resolve([]) }))

function renderViewerWithNotes() {
  return render(<PdfViewer documentId={7} renderNotes={(props) => <NotesPanel {...props} documentId={7} />} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollTo = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }), render: () => ({ promise: Promise.resolve(), cancel }) })
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
})

test('loads the selected PDF, navigates pages, and releases it', async () => {
  const { unmount } = render(<PdfViewer documentId={7} />)
  expect(getDocument).toHaveBeenCalledWith({
    url: 'http://127.0.0.1:8000/documents/7/file',
    cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, wasmUrl: '/pdfjs/wasm/',
    standardFontDataUrl: '/pdfjs/standard_fonts/', iccUrl: '/pdfjs/iccs/',
  })
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
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 400 } as DOMRect)
  vi.spyOn(pages[0], 'getBoundingClientRect').mockReturnValue({ top: -600, bottom: -10 } as DOMRect)
  vi.spyOn(pages[1], 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 810 } as DOMRect)
  fireEvent.scroll(area)
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('2')
})

test('toggles the memo sidebar without reloading the PDF and follows the current page', async () => {
  renderViewerWithNotes()
  const toggle = await screen.findByRole('button', { name: '메모' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('complementary', { name: '페이지 메모' })).toBeNull()

  fireEvent.click(toggle)
  const sidebar = screen.getByRole('complementary', { name: '페이지 메모' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.getAttribute('aria-controls')).toBe(sidebar.id)
  expect(sidebar.hasAttribute('inert')).toBe(false)
  expect(within(sidebar).getByText('1페이지')).toBeTruthy()
  await within(sidebar).findByText('이 페이지에는 메모가 없습니다.')

  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(within(sidebar).getByText('2페이지')).toBeTruthy()

  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(sidebar.hasAttribute('inert')).toBe(true)
  expect(screen.queryByRole('complementary', { name: '페이지 메모' })).toBeNull()
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('2')
  expect(getDocument).toHaveBeenCalledTimes(1)
})

test('preserves the reading position when the memo sidebar changes the fit width', async () => {
  const observers: (() => void)[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback) }
    observe() {}
    disconnect() {}
  })
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(440)
  try {
    renderViewerWithNotes()
    await waitFor(() => expect(screen.getByLabelText('확대 배율').textContent).toBe('330%'))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const area = screen.getByRole('region', { name: 'PDF 페이지' })
    const page = area.querySelector<HTMLElement>('[data-page="2"]')!
    area.scrollTop = 1120
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
    vi.spyOn(page, 'getBoundingClientRect').mockImplementation(() => (
      parseFloat(page.style.width) > 300 ? { top: -220, height: 880 } : { top: -660, height: 440 }
    ) as DOMRect)

    fireEvent.click(screen.getByRole('button', { name: '메모' }))
    width.mockReturnValue(220)
    act(() => { observers.forEach((measure) => measure()) })

    expect(screen.getByLabelText('확대 배율').textContent).toBe('165%')
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 570 })
    await screen.findByText('이 페이지에는 메모가 없습니다.')
  } finally {
    width.mockRestore()
    vi.unstubAllGlobals()
  }
})

test('offers retry when the PDF cannot be loaded', async () => {
  getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('failed')), destroy })
  render(<PdfViewer documentId={7} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('/ 2')).toBeTruthy()
  expect(getDocument).toHaveBeenCalledTimes(2)
})

test('automatically retries a page render once after a transient failure', async () => {
  const renderPage = vi.fn().mockImplementationOnce(() => ({ promise: Promise.reject(new Error('temporary')), cancel }))
    .mockImplementation(() => ({ promise: Promise.resolve(), cancel }))
  getPage.mockImplementation(async (number: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }), render: number === 1 ? renderPage : () => ({ promise: Promise.resolve(), cancel }) }))
  render(<PdfViewer documentId={7} />)
  await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('1페이지').hasAttribute('hidden')).toBe(false)
})

test('offers page retry after two failed renders and recovers on retry', async () => {
  const renderPage = vi.fn().mockImplementationOnce(() => ({ promise: Promise.reject(new Error('failed')), cancel }))
    .mockImplementationOnce(() => ({ promise: Promise.reject(new Error('failed')), cancel }))
    .mockImplementation(() => ({ promise: Promise.resolve(), cancel }))
  getPage.mockImplementation(async (number: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }), render: number === 1 ? renderPage : () => ({ promise: Promise.resolve(), cancel }) }))
  render(<PdfViewer documentId={7} />)
  expect((await screen.findByRole('alert')).textContent).toContain('1페이지를 표시하지 못했습니다.')
  expect(renderPage).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('1페이지').hasAttribute('hidden')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('1페이지').hasAttribute('hidden')).toBe(false)
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

test('keeps a tall visible page current while the next page is outside the viewport', async () => {
  render(<PdfViewer documentId={7} />)
  await screen.findByText('/ 2')
  const area = screen.getByRole('region', { name: 'PDF 페이지' })
  const pages = area.querySelectorAll<HTMLElement>('[data-page]')
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 400 } as DOMRect)
  vi.spyOn(pages[0], 'getBoundingClientRect').mockReturnValue({ top: -800, bottom: 480 } as DOMRect)
  const nextBounds = vi.spyOn(pages[1], 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 1780 } as DOMRect)
  fireEvent.scroll(area)
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('1')
  expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(false)
  nextBounds.mockReturnValue({ top: 300, bottom: 1580 } as DOMRect)
  fireEvent.scroll(area)
  expect((screen.getByRole('textbox', { name: '페이지 번호' }) as HTMLInputElement).value).toBe('2')
})
