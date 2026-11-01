import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { API_BASE_URL } from '../config'

GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const CSS_UNITS = 96 / 72
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
type PageSize = { width: number; height: number }

function PdfPage({ pdf, pageNumber, root, scale, defaultSize }: { pdf: PDFDocumentProxy; pageNumber: number; root: HTMLElement | null; scale: number; defaultSize: PageSize }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [size, setSize] = useState<PageSize | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!root || !pageRef.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root, rootMargin: '100% 0px' })
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    pdf.getPage(pageNumber).then((page) => {
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
      return renderTask.promise
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, pageNumber, visible, scale])

  const dimensions = size ?? defaultSize
  return <div ref={pageRef} className="pdf-page" data-page={pageNumber} style={{ width: dimensions.width * scale, aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
    {error ? <p role="alert">{pageNumber}페이지를 표시하지 못했습니다.</p> : visible && <canvas key={scale} ref={canvasRef} aria-label={`${pageNumber}페이지`} />}
  </div>
}

export default function PdfViewer({ documentId }: { documentId: number }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null)
  const [pageInput, setPageInput] = useState('1')
  const [manualScale, setManualScale] = useState(1)
  const [editingZoom, setEditingZoom] = useState(false)
  const [zoomInput, setZoomInput] = useState('')
  const [fit, setFit] = useState<'width' | 'height' | 'manual'>('width')
  const [pageSize, setPageSize] = useState<PageSize>({ width: 816, height: 1056 })
  const [firstPageSize, setFirstPageSize] = useState<PageSize>({ width: 816, height: 1056 })
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const pageInputRef = useRef<HTMLInputElement>(null)
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const zoomButtonRef = useRef<HTMLButtonElement>(null)
  const restoreZoomFocus = useRef(false)
  const scaleRef = useRef(1)
  const zoomAnchor = useRef<{ x: number; y: number; left: number; top: number; scale: number } | null>(null)
  const available = fit === 'width' ? areaSize.width : areaSize.height - 40
  const dimension = fit === 'width' ? pageSize.width : pageSize.height
  const scale = fit !== 'manual' && available > 0 && dimension > 0 ? clampScale(available / dimension) : manualScale

  useLayoutEffect(() => {
    if (editingZoom) { zoomInputRef.current?.focus(); zoomInputRef.current?.select() }
    else if (restoreZoomFocus.current) { zoomButtonRef.current?.focus(); restoreZoomFocus.current = false }
  }, [editingZoom])

  useEffect(() => {
    let cancelled = false
    const task = getDocument({ url: `${API_BASE_URL}/documents/${documentId}/file` })
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

  useEffect(() => {
    if (!scrollArea) return
    const measure = () => setAreaSize({ width: scrollArea.clientWidth, height: scrollArea.clientHeight })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(scrollArea)
    return () => observer?.disconnect()
  }, [scrollArea])

  useLayoutEffect(() => {
    scaleRef.current = scale
    const anchor = zoomAnchor.current
    if (!scrollArea || !anchor) return
    const ratio = scale / anchor.scale
    scrollArea.scrollTo({ left: (anchor.left + anchor.x) * ratio - anchor.x, top: (anchor.top + anchor.y) * ratio - anchor.y })
    zoomAnchor.current = null
  }, [scale, scrollArea])

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
    const top = scrollArea.getBoundingClientRect().top
    const pages = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-page]'))
    const current = pages.reduce<HTMLElement | null>((closest, page) =>
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
      {pdf && <div className="pdf-toolbar" aria-label="PDF 페이지 이동">
        <button type="button" aria-label="이전" title="이전 페이지" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg></button>
        <form onSubmit={(event) => { event.preventDefault(); submitPage() }}><input ref={pageInputRef} aria-label="페이지 번호" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={submitPage} /> <span>/ {pdf.numPages}</span></form>
        <button type="button" aria-label="다음" title="다음 페이지" disabled={pageNumber >= pdf.numPages} onClick={() => goToPage(pageNumber + 1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
        <button type="button" aria-label="축소" title="축소" disabled={scale <= MIN_SCALE} onClick={() => changeZoom(1 / 1.2)}>−</button>
        {editingZoom ? <form onSubmit={(event) => { event.preventDefault(); restoreZoomFocus.current = true; submitZoom() }}><input ref={zoomInputRef} aria-label="확대 배율" inputMode="decimal" value={zoomInput} onChange={(event) => setZoomInput(event.target.value)} onBlur={submitZoom} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); restoreZoomFocus.current = true; setEditingZoom(false) } }} /></form> : <button ref={zoomButtonRef} className="zoom-value" type="button" aria-label="확대 배율" title="확대 배율 입력" onClick={() => { setZoomInput(String(Math.round(scale * 100))); setEditingZoom(true) }}>{Math.round(scale * 100)}%</button>}
        <button type="button" aria-label="확대" title="확대" disabled={scale >= MAX_SCALE} onClick={() => changeZoom(1.2)}>+</button>
        <button type="button" aria-label={fit === 'width' ? '높이 맞춤' : '너비 맞춤'} title={fit === 'width' ? '높이 맞춤' : '너비 맞춤'} onClick={() => setFit(fit === 'width' ? 'height' : 'width')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="12" height="16" rx="1" />{fit === 'width' ? <path d="M12 8v8m-2-6 2-2 2 2m-4 4 2 2 2-2" /> : <path d="M8 12h8m-6-2-2 2 2 2m4-4 2 2-2 2" />}</svg></button>
      </div>}
      <div className={`pdf-page-area${fit === 'width' ? ' pdf-fit-width' : ''}`} ref={setScrollArea} onScroll={updateCurrentPage} tabIndex={0} role="region" aria-label="PDF 페이지">
        {error ? <div role="alert">PDF를 불러오지 못했습니다. <button type="button" onClick={() => { setError(false); setAttempt((n) => n + 1) }}>다시 시도</button></div>
          : pdf ? Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} root={scrollArea} scale={scale} defaultSize={firstPageSize} />) : <p role="status">PDF를 불러오는 중...</p>}
      </div>
    </div>
  )
}
