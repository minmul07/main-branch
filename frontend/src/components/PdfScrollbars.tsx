import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

type Metrics = { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number; left: number; top: number }
const empty: Metrics = { clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0, left: 0, top: 0 }

export default function PdfScrollbars({ area, content }: { area: HTMLElement | null; content: HTMLElement | null }) {
  const [metrics, setMetrics] = useState(empty)
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ axis: 'x' | 'y'; pointer: number; start: number; scroll: number; track: number; thumb: number } | null>(null)

  useEffect(() => {
    if (!area) return
    const measure = () => setMetrics({ clientWidth: area.clientWidth, clientHeight: area.clientHeight, scrollWidth: area.scrollWidth, scrollHeight: area.scrollHeight, left: area.scrollLeft, top: area.scrollTop })
    const scheduleHide = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { if (!drag.current) setVisible(false) }, 1000)
    }
    const onScroll = () => { measure(); setVisible(true); scheduleHide() }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(area)
    if (content) observer?.observe(content)
    area.addEventListener('scroll', onScroll, { passive: true })
    return () => { observer?.disconnect(); area.removeEventListener('scroll', onScroll); if (timer.current) clearTimeout(timer.current) }
  }, [area, content])

  const vertical = metrics.scrollHeight > metrics.clientHeight + 1
  const horizontal = metrics.scrollWidth > metrics.clientWidth + 1
  const trackY = Math.max(0, metrics.clientHeight - 24 - (horizontal ? 8 : 0))
  const trackX = Math.max(0, metrics.clientWidth - 24 - (vertical ? 8 : 0))
  const thumbY = Math.min(trackY, Math.max(24, trackY * metrics.clientHeight / (metrics.scrollHeight || 1)))
  const thumbX = Math.min(trackX, Math.max(24, trackX * metrics.clientWidth / (metrics.scrollWidth || 1)))
  const y = (metrics.top / (metrics.scrollHeight - metrics.clientHeight || 1)) * (trackY - thumbY)
  const x = (metrics.left / (metrics.scrollWidth - metrics.clientWidth || 1)) * (trackX - thumbX)

  function startDrag(event: PointerEvent<HTMLDivElement>, axis: 'x' | 'y', track: number, thumb: number) {
    if (!area || event.button !== 0) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = axis === 'y' ? event.clientY - rect.top : event.clientX - rect.left
    const offset = axis === 'y' ? y : x
    const maxScroll = axis === 'y' ? metrics.scrollHeight - metrics.clientHeight : metrics.scrollWidth - metrics.clientWidth
    let scroll = axis === 'y' ? area.scrollTop : area.scrollLeft
    if (position < offset || position > offset + thumb) {
      scroll = Math.max(0, Math.min(maxScroll, (position - thumb / 2) / (track - thumb || 1) * maxScroll))
      area.scrollTo(axis === 'y' ? { top: scroll } : { left: scroll })
    }
    if (timer.current) clearTimeout(timer.current)
    setVisible(true)
    drag.current = { axis, pointer: event.pointerId, start: axis === 'y' ? event.clientY : event.clientX, scroll, track, thumb }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!area || !current || current.pointer !== event.pointerId) return
    const distance = (current.axis === 'y' ? event.clientY : event.clientX) - current.start
    const maxScroll = current.axis === 'y' ? area.scrollHeight - area.clientHeight : area.scrollWidth - area.clientWidth
    const target = current.scroll + distance * maxScroll / (current.track - current.thumb || 1)
    area.scrollTo(current.axis === 'y' ? { top: target } : { left: target })
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 1000)
  }

  function reveal() {
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (!drag.current) setVisible(false) }, 1000)
  }

  const handlers = { onPointerEnter: reveal, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag }
  return <div className={`pdf-scrollbars${visible ? ' is-visible' : ''}`} aria-hidden="true">
    {vertical && <div className={`pdf-scrollbar pdf-scrollbar-vertical${horizontal ? ' has-crossbar' : ''}`} onPointerDown={(event) => startDrag(event, 'y', trackY, thumbY)} {...handlers}><div className="pdf-scrollbar-thumb" style={{ height: thumbY, transform: `translateY(${y}px)` }} /></div>}
    {horizontal && <div className={`pdf-scrollbar pdf-scrollbar-horizontal${vertical ? ' has-crossbar' : ''}`} onPointerDown={(event) => startDrag(event, 'x', trackX, thumbX)} {...handlers}><div className="pdf-scrollbar-thumb" style={{ width: thumbX, transform: `translateX(${x}px)` }} /></div>}
  </div>
}
