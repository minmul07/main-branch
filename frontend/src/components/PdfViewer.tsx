import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { API_BASE_URL } from '../config'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useDocumentNotes } from '../hooks/useDocumentNotes'
import PageNotes from './PageNotes'
import PdfScrollbars from './PdfScrollbars'

GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const CSS_UNITS = 96 / 72
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
// The notes margin is 40% of the viewer, between 240px and 320px.
const memoMarginWidth = (area: number) => Math.round(Math.min(320, Math.max(240, area * 0.4)))
const COMPACT_QUERY = '(max-width: 760px)'
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia?.(COMPACT_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const isCompact = () => window.matchMedia?.(COMPACT_QUERY).matches ?? false
// The margin slides out before the layout changes; keep in sync with the memo-out animation in index.css.
const MEMO_EXIT_MS = 180
const MEMO_FLIP_MS = 220
const canAnimate = () => !!window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
type PageSize = { width: number; height: number }

function PdfPage({ pdf, pageNumber, root, scale, defaultSize, children }: { pdf: PDFDocumentProxy; pageNumber: number; root: HTMLElement | null; scale: number; defaultSize: PageSize; children?: ReactNode }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [size, setSize] = useState<PageSize | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!root || !pageRef.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root, rootMargin: '100% 0px' })
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible || error) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    async function renderPage() {
      for (let retry = 0; retry < 2; retry++) {
        try {
          const page = await pdf.getPage(pageNumber)
          if (cancelled || !canvasRef.current) return
          const canvas = canvasRef.current
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas unavailable')
          const base = page.getViewport({ scale: CSS_UNITS })
          setSize({ width: base.width, height: base.height })
          const viewport = page.getViewport({ scale: CSS_UNITS * scale * (window.devicePixelRatio || 1) })
          canvas.width = viewport.width
          canvas.height = viewport.height
          renderTask = page.render({ canvas, canvasContext: context, viewport })
          await renderTask.promise
          return
        } catch {
          if (cancelled) return
          if (retry === 1) setError(true)
        }
      }
    }
    void renderPage()
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, pageNumber, visible, scale, error, attempt])

  const dimensions = size ?? defaultSize
  return <div ref={pageRef} className="pdf-page" data-page={pageNumber} style={{ width: dimensions.width * scale, aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
    {error && <div role="alert"><p>{pageNumber}페이지를 표시하지 못했습니다.</p><button type="button" onClick={() => { setError(false); setAttempt((value) => value + 1) }}>다시 시도</button></div>}
    {visible && <canvas key={scale} ref={canvasRef} aria-label={`${pageNumber}페이지`} hidden={error} />}
    {children}
  </div>
}

type ViewerProps = {
  documentId: number
  // Shows page notes: in the right margin beside each page on wide screens, in a bottom sheet on narrow ones.
  showNotes?: boolean
}

export default function PdfViewer({ documentId, showNotes = false }: ViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null)
  const [scrollContent, setScrollContent] = useState<HTMLDivElement | null>(null)
  const [pageInput, setPageInput] = useState('1')
  const [memoOpen, setMemoOpen] = useState(false)
  // The margin stays mounted while it animates out, then the layout changes.
  const [memoLeaving, setMemoLeaving] = useState(false)
  const [manualScale, setManualScale] = useState(1)
  const [editingZoom, setEditingZoom] = useState(false)
  const [zoomInput, setZoomInput] = useState('')
  const [fit, setFit] = useState<'width' | 'height' | 'manual'>('width')
  const [pageSize, setPageSize] = useState<PageSize>({ width: 816, height: 1056 })
  const [firstPageSize, setFirstPageSize] = useState<PageSize>({ width: 816, height: 1056 })
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const notesId = useId()
  const notes = useDocumentNotes(documentId, showNotes)
  const pageInputRef = useRef<HTMLInputElement>(null)
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const zoomButtonRef = useRef<HTMLButtonElement>(null)
  const memoToggleRef = useRef<HTMLButtonElement>(null)
  const restoreZoomFocus = useRef(false)
  const scaleRef = useRef(1)
  const zoomAnchor = useRef<{ x: number; y: number; left: number; top: number; scale: number } | null>(null)
  const resizeAnchor = useRef<{ page: HTMLElement; offset: number } | null>(null)
  // Page boxes before the notes margin changes the fit width, so the new layout can animate from them.
  const pageBoxes = useRef<Map<number, DOMRect> | null>(null)
  // A new object per badge click so the request runs even when the page is already current.
  const [notesRequest, setNotesRequest] = useState<{ page: number } | null>(null)
  const compact = useSyncExternalStore(subscribeCompact, isCompact, () => false)
  // Wide screens: every page row gets a notes margin. Fit-width pages end at
  // the margin, and pages wider than the viewer scroll underneath the sticky margin notes.
  const marginOpen = showNotes && memoOpen && !compact
  const memoInset = marginOpen ? memoMarginWidth(areaSize.width) : 0
  const sheetOpen = showNotes && memoOpen && compact
  const available = fit === 'width' ? areaSize.width - memoInset : areaSize.height - 40
  const dimension = fit === 'width' ? pageSize.width : pageSize.height
  const scale = fit !== 'manual' && available > 0 && dimension > 0 ? clampScale(available / dimension) : manualScale

  useLayoutEffect(() => {
    if (editingZoom) { zoomInputRef.current?.focus(); zoomInputRef.current?.select() }
    else if (restoreZoomFocus.current) { zoomButtonRef.current?.focus(); restoreZoomFocus.current = false }
  }, [editingZoom])

  useEffect(() => {
    let cancelled = false
    const task = getDocument({
      url: `${API_BASE_URL}/documents/${documentId}/file`,
      cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
      cMapPacked: true,
      wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
      standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
      iccUrl: `${import.meta.env.BASE_URL}pdfjs/iccs/`,
    })
    task.promise.then((document) => { if (!cancelled) setPdf(document) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; void task.destroy() }
  }, [documentId, attempt])

  useEffect(() => {
    if (!pdf) return
    let active = true
    pdf.getPage(pageNumber).then((page) => {
      if (!active) return
      const viewport = page.getViewport({ scale: CSS_UNITS })
      const size = { width: viewport.width, height: viewport.height }
      setPageSize(size)
      if (pageNumber === 1) setFirstPageSize(size)
    }).catch(() => {})
    return () => { active = false }
  }, [pdf, pageNumber])

  // Fit-width pages change height when the visible PDF width changes, so remember where the
  // current page was before the change and restore it after the new scale is rendered.
  function rememberReadingPosition() {
    if (fit !== 'width' || !scrollArea) return
    const page = scrollArea.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`)
    const bounds = page?.getBoundingClientRect()
    if (page && bounds?.height) {
      resizeAnchor.current = { page, offset: (scrollArea.getBoundingClientRect().top - bounds.top) / bounds.height }
    }
  }

  function rememberPageBoxes() {
    if (!scrollArea || !canAnimate() || typeof scrollArea.animate !== 'function') return
    const view = scrollArea.getBoundingClientRect()
    const boxes = new Map<number, DOMRect>()
    for (const page of scrollArea.querySelectorAll<HTMLElement>('[data-page]')) {
      const box = page.getBoundingClientRect()
      if (box.bottom > view.top && box.top < view.bottom) boxes.set(Number(page.dataset.page), box)
    }
    pageBoxes.current = boxes
  }

  // The layout changes at once (so the canvases render at the new scale); each visible page then
  // glides from its old box to the new one, keeping the reading position fixed.
  const animatePagesFrom = useEffectEvent((boxes: Map<number, DOMRect>) => {
    if (!scrollArea) return
    for (const page of scrollArea.querySelectorAll<HTMLElement>('[data-page]')) {
      const from = boxes.get(Number(page.dataset.page))
      const to = page.getBoundingClientRect()
      if (!from || !to.width || !to.height) continue
      const dx = from.left - to.left
      const dy = from.top - to.top
      const sx = from.width / to.width
      const sy = from.height / to.height
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue
      page.animate(
        [{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
        { duration: MEMO_FLIP_MS, easing: 'ease' },
      )
    }
  })

  const measureScrollArea = useEffectEvent((area: HTMLDivElement) => {
    const size = { width: area.clientWidth, height: area.clientHeight }
    if (size.width === areaSize.width && size.height === areaSize.height) return
    if (size.width !== areaSize.width) rememberReadingPosition()
    setAreaSize(size)
  })

  useEffect(() => {
    if (!scrollArea) return
    const measure = () => measureScrollArea(scrollArea)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(scrollArea)
    return () => observer?.disconnect()
  }, [scrollArea])

  useLayoutEffect(() => {
    scaleRef.current = scale
    const resize = resizeAnchor.current
    resizeAnchor.current = null
    if (!scrollArea) return

    const zoom = zoomAnchor.current
    if (zoom) {
      const ratio = scale / zoom.scale
      scrollArea.scrollTo({ left: (zoom.left + zoom.x) * ratio - zoom.x, top: (zoom.top + zoom.y) * ratio - zoom.y })
      zoomAnchor.current = null
    } else if (resize) {
      const bounds = resize.page.getBoundingClientRect()
      const top = scrollArea.scrollTop + bounds.top - scrollArea.getBoundingClientRect().top + bounds.height * resize.offset
      scrollArea.scrollTo({ top })
    }

    const boxes = pageBoxes.current
    pageBoxes.current = null
    if (boxes) animatePagesFrom(boxes)
  }, [scale, scrollArea, areaSize, memoInset])

  // A page badge opens the notes for that page: scroll to it once the new layout is rendered.
  const runNotesRequest = useEffectEvent((page: number) => {
    goToPage(page)
    // The sheet keeps one notes group across pages, so the focused element survives the page change.
    document.getElementById(compact ? `${notesId}-sheet-group` : `${notesId}-page-${page}`)?.focus({ preventScroll: true })
  })

  useLayoutEffect(() => {
    if (notesRequest) runNotesRequest(notesRequest.page)
  }, [notesRequest])

  useEffect(() => {
    if (!scrollArea) return
    let pinchDistance = 0
    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      const rect = scrollArea.getBoundingClientRect()
      const current = scaleRef.current
      const next = clampScale(current * factor)
      if (next !== current) zoomAnchor.current = { x: clientX - rect.left, y: clientY - rect.top, left: scrollArea.scrollLeft, top: scrollArea.scrollTop, scale: current }
      setFit('manual')
      setManualScale(next)
    }
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      zoomAt(Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY)
    }
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const touchStart = (event: TouchEvent) => { if (event.touches.length === 2) pinchDistance = distance(event.touches) }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchDistance) return
      event.preventDefault()
      const next = distance(event.touches)
      zoomAt(next / pinchDistance, (event.touches[0].clientX + event.touches[1].clientX) / 2, (event.touches[0].clientY + event.touches[1].clientY) / 2)
      pinchDistance = next
    }
    const touchEnd = () => { pinchDistance = 0 }
    scrollArea.addEventListener('wheel', wheel, { passive: false })
    scrollArea.addEventListener('touchstart', touchStart, { passive: true })
    scrollArea.addEventListener('touchmove', touchMove, { passive: false })
    scrollArea.addEventListener('touchend', touchEnd)
    scrollArea.addEventListener('touchcancel', touchEnd)
    return () => {
      scrollArea.removeEventListener('wheel', wheel)
      scrollArea.removeEventListener('touchstart', touchStart)
      scrollArea.removeEventListener('touchmove', touchMove)
      scrollArea.removeEventListener('touchend', touchEnd)
      scrollArea.removeEventListener('touchcancel', touchEnd)
    }
  }, [scrollArea])

  function goToPage(number: number) {
    const page = scrollArea?.querySelector<HTMLElement>(`[data-page="${number}"]`)
    if (!scrollArea || !page) return
    scrollArea.scrollTo({ top: scrollArea.scrollTop + page.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top, behavior: 'auto' })
    setPageNumber(number)
    setPageInput(String(number))
  }

  function updateCurrentPage() {
    if (!scrollArea) return
    const viewport = scrollArea.getBoundingClientRect()
    const top = viewport.top
    const pages = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-page]'))
    const visiblePages = pages.filter((page) => {
      const bounds = page.getBoundingClientRect()
      return bounds.bottom > top && bounds.top < viewport.bottom
    })
    const current = visiblePages.reduce<HTMLElement | null>((closest, page) =>
      Math.abs(page.getBoundingClientRect().top - top) < Math.abs((closest?.getBoundingClientRect().top ?? Infinity) - top) ? page : closest, null)
    if (current) {
      const number = Number(current.dataset.page)
      setPageNumber(number)
      if (document.activeElement !== pageInputRef.current) setPageInput(String(number))
    }
  }

  function submitPage() {
    const value = Number(pageInput)
    if (/^[0-9]+$/.test(pageInput) && Number.isSafeInteger(value) && pdf && value >= 1 && value <= pdf.numPages) goToPage(value)
    else setPageInput(String(pageNumber))
  }

  function changeZoom(factor: number) { setFit('manual'); setManualScale(clampScale(scale * factor)) }

  const finishMemoExit = useEffectEvent(() => {
    rememberReadingPosition()
    rememberPageBoxes()
    setMemoOpen(false)
    setMemoLeaving(false)
  })

  useEffect(() => {
    if (!memoLeaving) return
    const timer = setTimeout(finishMemoExit, MEMO_EXIT_MS)
    return () => clearTimeout(timer)
  }, [memoLeaving])

  function toggleMemo() {
    if (memoLeaving) return setMemoLeaving(false) // reopening cancels the exit
    if (memoOpen && !compact && canAnimate()) return setMemoLeaving(true)
    if (!compact) { rememberReadingPosition(); rememberPageBoxes() }
    setMemoOpen((open) => !open)
  }

  function openNotesAt(page: number) {
    setMemoOpen(true)
    setNotesRequest({ page })
  }

  // Escape inside the notes closes them, except while typing in a note field.
  function closeMemoOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !memoOpen || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (!target.closest('.page-notes, .pdf-notes-sheet') || target.closest('input, textarea')) return
    event.preventDefault()
    toggleMemo()
    memoToggleRef.current?.focus()
  }

  function submitZoom() {
    const input = zoomInput.trim().replace(/%$/, '').trim()
    const value = Number(input)
    if (/^\d+(?:\.\d+)?$/.test(input) && value >= MIN_SCALE * 100 && value <= MAX_SCALE * 100) {
      setManualScale(value / 100)
      setFit('manual')
    }
    setEditingZoom(false)
  }

  return (
    <div className="pdf-viewer">
      {pdf && <div className="pdf-toolbar" role="group" aria-label="PDF 뷰어 도구">
        <div className="pdf-toolbar-controls">
          <div>
            <button type="button" aria-label="이전" title="이전 페이지" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg></button>
            <form onSubmit={(event) => { event.preventDefault(); submitPage() }}><input ref={pageInputRef} aria-label="페이지 번호" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={submitPage} /> <span>/ {pdf.numPages}</span></form>
            <button type="button" aria-label="다음" title="다음 페이지" disabled={pageNumber >= pdf.numPages} onClick={() => goToPage(pageNumber + 1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
          </div>
          <div>
            <button type="button" aria-label="축소" title="축소" disabled={scale <= MIN_SCALE} onClick={() => changeZoom(1 / 1.2)}>−</button>
            {editingZoom ? <form onSubmit={(event) => { event.preventDefault(); restoreZoomFocus.current = true; submitZoom() }}><input ref={zoomInputRef} aria-label="확대 배율" inputMode="decimal" value={zoomInput} onChange={(event) => setZoomInput(event.target.value)} onBlur={submitZoom} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); restoreZoomFocus.current = true; setEditingZoom(false) } }} /></form> : <button ref={zoomButtonRef} className="zoom-value" type="button" aria-label="확대 배율" title="확대 배율 입력" onClick={() => { setZoomInput(String(Math.round(scale * 100))); setEditingZoom(true) }}>{Math.round(scale * 100)}%</button>}
            <button type="button" aria-label="확대" title="확대" disabled={scale >= MAX_SCALE} onClick={() => changeZoom(1.2)}>+</button>
            <button type="button" aria-label={fit === 'width' ? '높이 맞춤' : '너비 맞춤'} title={fit === 'width' ? '높이 맞춤' : '너비 맞춤'} onClick={() => setFit(fit === 'width' ? 'height' : 'width')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="12" height="16" rx="1" />{fit === 'width' ? <path d="M12 8v8m-2-6 2-2 2 2m-4 4 2 2 2-2" /> : <path d="M8 12h8m-6-2-2 2 2 2m4-4 2 2-2 2" />}</svg></button>
          </div>
        </div>
        {showNotes && <button
          ref={memoToggleRef}
          className="pdf-memo-toggle"
          type="button"
          aria-label="메모"
          aria-controls={compact ? `${notesId}-sheet` : undefined}
          aria-pressed={memoOpen && !memoLeaving}
          title={memoOpen && !memoLeaving ? '메모 숨기기' : '메모 보기'}
          onClick={toggleMemo}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8l-8 8Z" />
            <path d="M13 21v-6a2 2 0 0 1 2-2h6M7 8h10m-10 4h3" />
          </svg>
        </button>}
      </div>}
      <div
        className={`pdf-viewer-content${marginOpen ? ' has-notes-margin' : ''}${memoLeaving ? ' is-leaving' : ''}${sheetOpen ? ' has-notes-sheet' : ''}`}
        style={{ '--memo-inset': `${memoInset}px` } as CSSProperties}
        onKeyDown={closeMemoOnEscape}
      >
        <div className="pdf-scroll-wrapper">
          <div className={`pdf-page-area${fit === 'width' ? ' pdf-fit-width' : ''}`} ref={setScrollArea} onScroll={updateCurrentPage} tabIndex={0} role="region" aria-label="PDF 페이지">
            <div className="pdf-pages" ref={setScrollContent}>
              {error ? <div role="alert">PDF를 불러오지 못했습니다. <button type="button" onClick={() => { setError(false); setAttempt((n) => n + 1) }}>다시 시도</button></div>
                : pdf ? Array.from({ length: pdf.numPages }, (_, index) => {
                  const page = index + 1
                  const pageNotes = notes.byPage.get(page) ?? []
                  return <div key={page} className="pdf-page-row">
                    <PdfPage pdf={pdf} pageNumber={page} root={scrollArea} scale={scale} defaultSize={firstPageSize}>
                      {showNotes && !marginOpen && notes.state === 'ready' && pageNotes.length > 0 && (
                        <button className="pdf-page-note-badge" type="button" aria-label={`${page}페이지 메모 ${pageNotes.length}개 보기`} title="메모 보기" onClick={() => openNotesAt(page)}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8l-8 8Z" /></svg>
                          {pageNotes.length}
                        </button>
                      )}
                    </PdfPage>
                    {marginOpen && <div className="pdf-page-margin">
                      <PageNotes id={`${notesId}-page-${page}`} page={page} notes={pageNotes} api={notes} current={page === pageNumber} variant="margin" />
                    </div>}
                  </div>
                }) : <p role="status">PDF를 불러오는 중...</p>}
            </div>
          </div>
          <PdfScrollbars area={scrollArea} content={scrollContent} />
        </div>
        {pdf && showNotes && compact && (
          <section id={`${notesId}-sheet`} className="pdf-notes-sheet" aria-labelledby={`${notesId}-sheet-title`} aria-hidden={!sheetOpen} inert={!sheetOpen}>
            <header>
              <h3 id={`${notesId}-sheet-title`}>{pageNumber}페이지 메모</h3>
              <button type="button" aria-label="메모 닫기" title="메모 닫기" onClick={() => { setMemoOpen(false); memoToggleRef.current?.focus() }}>×</button>
            </header>
            <div className="pdf-notes-sheet-body">
              <PageNotes id={`${notesId}-sheet-group`} page={pageNumber} notes={notes.byPage.get(pageNumber) ?? []} api={notes} current variant="sheet" />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
