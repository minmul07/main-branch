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
}

function ConfirmPopup({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  onClose,
  onConfirm,
  returnFocusRef,
}: ConfirmPopupProps) {
  const dialogRef = useDialogFocus(returnFocusRef)

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div className="subject-modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <section
        ref={dialogRef}
        className="subject-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-popup-title"
        aria-describedby="confirm-popup-message"
        tabIndex={-1}
      >
        <header className="subject-modal-header">
          <h2 id="confirm-popup-title">{title}</h2>
          <button
            type="button"
            className="subject-modal-close"
            aria-label="팝업 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <p className="confirm-popup-message" id="confirm-popup-message">{message}</p>
        <div className="subject-create-actions confirm-popup-actions">
          <button type="button" className="subject-create-cancel" onClick={onClose} autoFocus data-dialog-autofocus>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-popup-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ConfirmPopup
