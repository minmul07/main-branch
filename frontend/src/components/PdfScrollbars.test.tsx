import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import PdfScrollbars from './PdfScrollbars'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('shows both scrollbars while scrolling and hides them one second after the last scroll', () => {
  vi.useFakeTimers()
  const area = document.createElement('div')
  Object.defineProperties(area, {
    clientWidth: { value: 300 }, clientHeight: { value: 400 },
    scrollWidth: { value: 600 }, scrollHeight: { value: 1200 },
    scrollLeft: { value: 0, writable: true }, scrollTop: { value: 0, writable: true },
  })
  const { container, unmount } = render(<PdfScrollbars area={area} content={null} />)
  const bars = container.querySelector('.pdf-scrollbars')!
  expect(container.querySelector('.pdf-scrollbar-vertical')).toBeTruthy()
  expect(container.querySelector('.pdf-scrollbar-horizontal')).toBeTruthy()
  expect(bars.classList.contains('is-visible')).toBe(false)
  area.scrollTop = 200
  fireEvent.scroll(area)
  expect(bars.classList.contains('is-visible')).toBe(true)
  expect((container.querySelector('.pdf-scrollbar-vertical .pdf-scrollbar-thumb') as HTMLElement).style.transform).not.toBe('translateY(0px)')
  act(() => { vi.advanceTimersByTime(900) })
  fireEvent.scroll(area)
  act(() => { vi.advanceTimersByTime(999) })
  expect(bars.classList.contains('is-visible')).toBe(true)
  act(() => { vi.advanceTimersByTime(1) })
  expect(bars.classList.contains('is-visible')).toBe(false)
  unmount()
})

test('dragging the thumb scrolls the PDF area', () => {
  class TestPointerEvent extends MouseEvent { pointerId = 1 }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  const area = document.createElement('div')
  Object.defineProperties(area, { clientWidth: { value: 300 }, clientHeight: { value: 400 }, scrollWidth: { value: 300 }, scrollHeight: { value: 1200 }, scrollTop: { value: 0, writable: true } })
  area.scrollTo = vi.fn()
  const { container } = render(<PdfScrollbars area={area} content={null} />)
  fireEvent.scroll(area)
  const track = container.querySelector('.pdf-scrollbar-vertical') as HTMLElement
  track.setPointerCapture = vi.fn()
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
  fireEvent.pointerDown(track, { button: 0, clientY: 20 })
  fireEvent.pointerMove(track, { clientY: 100 })
  expect(area.scrollTo).toHaveBeenCalledWith({ top: expect.any(Number) })
  expect((area.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0].top).toBeGreaterThan(0)
  fireEvent.pointerUp(track)
})
