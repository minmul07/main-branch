import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export type DialogReturnFocusRef = {
  current: HTMLElement | null
}

function getFocusableElements(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element)
    return element.tabIndex >= 0
      && !element.closest('[hidden], [aria-hidden="true"]')
      && style.display !== 'none'
      && style.visibility !== 'hidden'
  })
}

export function useDialogFocus(returnFocusRef: DialogReturnFocusRef) {
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const returnFocusTarget = returnFocusRef.current
    // Read at close time on purpose: it is not a node this hook renders.
    const replacementTarget = () => returnFocusRef.current

    function focusFirstControl() {
      const activeDialog = dialogRef.current
      if (!activeDialog) return

      const autofocusElement = activeDialog.querySelector<HTMLElement>('[data-dialog-autofocus]:not(:disabled)')
      const firstFocusableElement = getFocusableElements(activeDialog)[0]
      ;(autofocusElement ?? firstFocusableElement ?? activeDialog).focus()
    }

    function containTabFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return

      const activeDialog = dialogRef.current
      if (!activeDialog) return

      const focusableElements = getFocusableElements(activeDialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        activeDialog.focus()
        return
      }

      const firstFocusableElement = focusableElements[0]
      const lastFocusableElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      const focusIsOutsideDialog = !activeDialog.contains(activeElement)

      if (event.shiftKey && (focusIsOutsideDialog || activeElement === firstFocusableElement || activeElement === activeDialog)) {
        event.preventDefault()
        lastFocusableElement.focus()
      } else if (!event.shiftKey && (focusIsOutsideDialog || activeElement === lastFocusableElement || activeElement === activeDialog)) {
        event.preventDefault()
        firstFocusableElement.focus()
      }
    }

    function containProgrammaticFocus(event: FocusEvent) {
      const activeDialog = dialogRef.current
      if (activeDialog && event.target instanceof Node && !activeDialog.contains(event.target)) {
        focusFirstControl()
      }
    }

    focusFirstControl()
    document.addEventListener('keydown', containTabFocus, true)
    document.addEventListener('focusin', containProgrammaticFocus, true)

    return () => {
      document.removeEventListener('keydown', containTabFocus, true)
      document.removeEventListener('focusin', containProgrammaticFocus, true)

      // The opener may be gone (e.g. its item was deleted); the caller can point the ref at a replacement.
      const target = [returnFocusTarget, replacementTarget()].find((element) => element?.isConnected)
      if (target) {
        target.focus()
      } else {
        getFocusableElements(document.body)[0]?.focus()
      }
    }
  }, [returnFocusRef])

  return dialogRef
}
