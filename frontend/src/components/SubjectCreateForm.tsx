import { useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { DialogReturnFocusRef } from '../hooks/useDialogFocus'

type SubjectCreateFormProps = {
  onClose: () => void
  onCreateSubject: (name: string) => void
  returnFocusRef: DialogReturnFocusRef
}

function SubjectCreateForm({ onClose, onCreateSubject, returnFocusRef }: SubjectCreateFormProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const dialogRef = useDialogFocus(returnFocusRef)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()

    if (trimmed === '') {
      setError('과목 이름을 입력하시오.')
      return
    }
    if ([...trimmed].length > 100) {
      setError('과목 이름은 100자 이하로 입력해주세요.')
      return
    }

    onCreateSubject(trimmed)
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div className="subject-modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <section
        id="add-subject"
        ref={dialogRef}
        className="subject-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subject-modal-title"
        tabIndex={-1}
      >
        <header className="subject-modal-header">
          <h2 id="subject-modal-title">과목 추가</h2>
          <button
            type="button"
            className="subject-modal-close"
            aria-label="팝업 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="subject-create-form" onSubmit={handleSubmit}>
          <label htmlFor="subject-name">과목 이름</label>
          <div className="subject-create-fields">
            <input
              id="subject-name"
              autoFocus
              data-dialog-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="과목 이름"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'subject-error' : undefined}
            />
          </div>
          {error && <p id="subject-error" role="alert">{error}</p>}
          <div className="subject-create-actions">
            <button type="button" className="subject-create-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit">과목 추가</button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default SubjectCreateForm
