import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { API_BASE_URL } from '../config'

GlobalWorkerOptions.workerSrc = workerUrl

function PdfPage({ pdf, pageNumber, root }: { pdf: PDFDocumentProxy; pageNumber: number; root: HTMLElement | null }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [aspectRatio, setAspectRatio] = useState('1 / 1.414')
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
      const viewport = page.getViewport({ scale: 1.5 * (window.devicePixelRatio || 1) })
      setAspectRatio(`${viewport.width} / ${viewport.height}`)
      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      return renderTask.promise
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, pageNumber, visible])

  return <div ref={pageRef} className="pdf-page" data-page={pageNumber} style={{ aspectRatio }}>
    {error ? <p role="alert">{pageNumber}페이지를 표시하지 못했습니다.</p> : visible && <canvas ref={canvasRef} aria-label={`${pageNumber}페이지`} />}
  </div>
}

export default function PdfViewer({ documentId }: { documentId: number }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const task = getDocument({ url: `${API_BASE_URL}/documents/${documentId}/file` })
    task.promise.then((document) => { if (!cancelled) setPdf(document) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; void task.destroy() }
  }, [documentId, attempt])

  function goToPage(number: number) {
    const page = scrollArea?.querySelector<HTMLElement>(`[data-page="${number}"]`)
    if (!scrollArea || !page) return
    scrollArea.scrollTo({ top: scrollArea.scrollTop + page.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top, behavior: 'auto' })
    setPageNumber(number)
  }

  function updateCurrentPage() {
    if (!scrollArea) return
    const top = scrollArea.getBoundingClientRect().top
    const pages = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-page]'))
    const current = pages.reduce<HTMLElement | null>((closest, page) =>
      Math.abs(page.getBoundingClientRect().top - top) < Math.abs((closest?.getBoundingClientRect().top ?? Infinity) - top) ? page : closest, null)
    if (current) setPageNumber(Number(current.dataset.page))
  }

  return (
    <div className="pdf-viewer">
      {pdf && <div className="pdf-toolbar" aria-label="PDF 페이지 이동">
        <button type="button" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}>이전</button>
        <span aria-live="polite">{pageNumber} / {pdf.numPages}</span>
        <button type="button" disabled={pageNumber >= pdf.numPages} onClick={() => goToPage(pageNumber + 1)}>다음</button>
      </div>}
      <div className="pdf-page-area" ref={setScrollArea} onScroll={updateCurrentPage} tabIndex={0} role="region" aria-label="PDF 페이지">
        {error ? <div role="alert">PDF를 불러오지 못했습니다. <button type="button" onClick={() => { setError(false); setAttempt((n) => n + 1) }}>다시 시도</button></div>
          : pdf ? Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} root={scrollArea} />) : <p role="status">PDF를 불러오는 중...</p>}
      </div>
    </div>
  )
}
