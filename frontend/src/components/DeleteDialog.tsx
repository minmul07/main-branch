import { useEffect, useRef, useState } from 'react'
import { DeleteError, deleteResource } from '../deleteApi'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { DialogReturnFocusRef } from '../hooks/useDialogFocus'

type Props = ({ kind: 'subjects'; documentCount: number } | { kind: 'documents'; documentCount?: never }) & {
  id: number
  name: string
  returnFocusRef: DialogReturnFocusRef
  onClose: () => void
  onDeleted: () => void
  onRefresh: () => Promise<void>
}

export default function DeleteDialog({ kind, id, name, documentCount, returnFocusRef, onClose, onDeleted, onRefresh }: Props) {
  const dialogRef = useDialogFocus(returnFocusRef)
  const alive = useRef(true)
  const locked = useRef(false)
  const [needsName, setNeedsName] = useState(kind === 'subjects' && documentCount > 0)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshRequired, setRefreshRequired] = useState(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  function close() { if (!locked.current) onClose() }
  async function refresh() {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try { await onRefresh(); if (alive.current) onClose() }
    catch { if (alive.current) setError('목록을 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.') }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  async function confirm() {
    if (locked.current || refreshRequired || (needsName && confirmation !== name)) return
    locked.current = true; setBusy(true); setError('')
    try {
      await deleteResource(kind, id, needsName ? confirmation : undefined)
      if (!alive.current) return
      onDeleted()
      setRefreshRequired(true)
      try { await onRefresh(); if (alive.current) onClose() }
      catch { if (alive.current) setError('삭제는 완료됐지만 목록을 갱신하지 못했습니다. 목록을 다시 확인하세요.') }
    } catch (reason) {
      if (!alive.current) return
      const status = reason instanceof DeleteError ? reason.status : 0
      if (status === 409 && kind === 'subjects') {
        setNeedsName(true); setConfirmation(''); setError(''); return
      }
      setRefreshRequired(status === 0 || status === 404 || status >= 500)
      setError(status === 409 ? '자료가 있는 과목은 삭제할 수 없습니다. 자료를 먼저 각각 삭제하세요.'
        : status === 404 ? '이미 삭제되었거나 존재하지 않는 대상입니다. 목록을 다시 확인하세요.'
        : status === 422 ? '삭제 대상 ID가 올바르지 않습니다.'
        : '삭제 결과를 확인할 수 없습니다. 서버에서 처리되었을 수 있으니 목록을 다시 확인하세요.')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
      else window.dispatchEvent(new Event('deletion-settled'))
    }
  }
  return <div className="subject-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="subject-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" aria-busy={busy} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <header className="subject-modal-header"><h2 id="delete-title">{kind === 'subjects' ? '과목' : '자료'} 삭제</h2></header>
      <p id="delete-description">{kind === 'subjects' ? needsName ? <>등록된 자료가 존재합니다. 과목을 삭제하려면 <strong>{name}</strong>을 입력하세요.</> : <><strong>{name}</strong>을 삭제하시겠습니까?</> : <>“{name}”을 삭제하시겠습니까? 자료와 원본 PDF 파일이 삭제됩니다. 되돌릴 수 없습니다.</>}</p>
      {needsName && <input className="subject-delete-name" type="text" aria-label="삭제할 과목명" placeholder={name} value={confirmation} disabled={busy || refreshRequired} onChange={(event) => setConfirmation(event.target.value)} />}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">처리 중...</p>}
      <div className="subject-create-actions confirm-popup-actions">
        <button type="button" className="subject-create-cancel" data-dialog-autofocus disabled={busy} onClick={close}>취소</button>
        {refreshRequired ? <button type="button" disabled={busy} onClick={refresh}>목록 다시 확인</button> : <button type="button" className="confirm-popup-confirm" disabled={busy || (needsName && confirmation !== name)} onClick={confirm}>삭제 확인</button>}
      </div>
    </section>
  </div>
}
