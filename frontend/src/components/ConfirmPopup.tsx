import { useEffect } from 'react'
import type { MouseEvent } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { DialogReturnFocusRef } from '../hooks/useDialogFocus'

type ConfirmPopupProps = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onClose: () => void
  onConfirm: () => void
  returnFocusRef: DialogReturnFocusRef
  busy?: boolean
  error?: string
}

function ConfirmPopup({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  onClose,
  onConfirm,
  returnFocusRef,
  busy = false,
  error,
}: ConfirmPopupProps) {
  const dialogRef = useDialogFocus(returnFocusRef)

  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy, dialogRef])

  function close() {
    if (!busy) onClose()
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      close()
    }
  }

  return (
    <div className="subject-modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <section
        ref={dialogRef}
        className="subject-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="confirm-popup-title"
        aria-describedby="confirm-popup-message"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
      >
        <header className="subject-modal-header">
          <h2 id="confirm-popup-title">{title}</h2>
          <button
            type="button"
            className="subject-modal-close"
            aria-label="팝업 닫기"
            onClick={close}
            disabled={busy}
          >
            ×
          </button>
        </header>

        <p className="confirm-popup-message" id="confirm-popup-message">{message}</p>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">처리 중…</p>}
        <div className="subject-create-actions confirm-popup-actions">
          <button type="button" className="subject-create-cancel" onClick={close} disabled={busy} autoFocus data-dialog-autofocus>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-popup-confirm" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ConfirmPopup
