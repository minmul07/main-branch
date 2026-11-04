import { useEffect, useRef, useState } from 'react'
import { DeleteError, deleteResource } from '../deleteApi'
import { listDocuments } from '../documentsApi'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { DialogReturnFocusRef } from '../hooks/useDialogFocus'

type Props = {
  kind: 'subjects' | 'documents'
  id: number
  name: string
  returnFocusRef: DialogReturnFocusRef
  onClose: () => void
  onDeleted: () => void
  onRefresh: () => Promise<void>
}

export default function DeleteDialog({ kind, id, name, returnFocusRef, onClose, onDeleted, onRefresh }: Props) {
  const dialogRef = useDialogFocus(returnFocusRef)
  const alive = useRef(true)
  const locked = useRef(false)
  const [needsName, setNeedsName] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshRequired, setRefreshRequired] = useState(false)
  const [checking, setChecking] = useState(kind === 'subjects')
  const [checkFailed, setCheckFailed] = useState(false)
  const [checkAttempt, setCheckAttempt] = useState(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (kind !== 'subjects') return
    let current = true
    listDocuments(id).then((documents) => {
      if (current) setNeedsName(documents.length > 0)
    }).catch(() => {
      if (current) { setCheckFailed(true); setError('등록된 자료를 확인하지 못했습니다. 다시 시도하세요.') }
    }).finally(() => { if (current) setChecking(false) })
    return () => { current = false }
  }, [kind, id, checkAttempt])
  function close() { if (!locked.current) onClose() }
  async function refresh() {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try { await onRefresh(); if (alive.current) onClose() }
    catch { if (alive.current) setError('목록을 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.') }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  async function confirm() {
    if (locked.current || checking || checkFailed || refreshRequired || (needsName && confirmation !== name)) return
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
      <p id="delete-description">{checking ? '등록된 자료를 확인하는 중입니다.' : checkFailed ? '등록된 자료 확인이 필요합니다.' : kind === 'subjects' ? needsName ? <>등록된 자료가 존재합니다. 과목을 삭제하려면 <strong>{name}</strong>을 입력하세요.</> : <><strong>{name}</strong>을 삭제하시겠습니까?</> : <>“{name}”을 삭제하시겠습니까? 자료와 원본 PDF 파일이 삭제됩니다. 되돌릴 수 없습니다.</>}</p>
      {needsName && <label>삭제할 과목명<input type="text" value={confirmation} disabled={busy || refreshRequired} onChange={(event) => setConfirmation(event.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">처리 중...</p>}
      <div className="subject-create-actions confirm-popup-actions">
        <button type="button" className="subject-create-cancel" data-dialog-autofocus disabled={busy} onClick={close}>취소</button>
        {checkFailed ? <button type="button" onClick={() => { setChecking(true); setCheckFailed(false); setError(''); setCheckAttempt((attempt) => attempt + 1) }}>다시 시도</button> : refreshRequired ? <button type="button" disabled={busy} onClick={refresh}>목록 다시 확인</button> : <button type="button" className="confirm-popup-confirm" disabled={busy || checking || (needsName && confirmation !== name)} onClick={confirm}>삭제 확인</button>}
      </div>
    </section>
  </div>
}
