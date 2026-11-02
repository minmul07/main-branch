import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { DialogReturnFocusRef } from '../hooks/useDialogFocus'
import { uploadDocument } from '../documentsApi'

type Item = { id: number; file: File; week: string; status: 'waiting' | 'uploading' | 'success' | 'error'; error?: string }
type Props = { subjectId: number; returnFocusRef: DialogReturnFocusRef; onClose: () => void; onUploaded: () => void }
export default function UploadDialog({ subjectId, returnFocusRef, onClose, onUploaded }: Props) {
  const dialogRef = useDialogFocus(returnFocusRef)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const busy = useRef(false)
  const [items, setItems] = useState<Item[]>([])
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const allUploaded = !pending && items.length > 0 && items.every((item) => item.status === 'success')
  function add(files: FileList | File[]) {
    const all = Array.from(files)
    const valid = all.filter((file) => /\.pdf$/i.test(file.name))
    setNotice(valid.length !== all.length ? 'PDF 파일만 추가할 수 있습니다.' : '')
    setItems((current) => [...current, ...valid.map((file): Item => ({ id: nextId.current++, file, week: '', status: 'waiting' }))])
  }
  function update(id: number, patch: Partial<Item>) { setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current) return
    const targets = items.filter((item) => item.status !== 'success')
    if (!targets.length) return
    if (targets.some((item) => !/^[0-9]+$/.test(item.week) || !Number.isSafeInteger(Number(item.week)) || Number(item.week) <= 0)) { setNotice('각 파일의 주차에 1 이상의 정수를 입력해주세요.'); return }
    busy.current = true; setPending(true); setNotice('')
    for (const item of targets) {
      update(item.id, { status: 'uploading', error: undefined })
      try { await uploadDocument(item.file, subjectId, item.week); update(item.id, { status: 'success' }); onUploaded() }
      catch (error) { update(item.id, { status: 'error', error: error instanceof TypeError ? '네트워크 오류: 저장 여부를 확인할 수 없습니다. 재시도하면 중복될 수 있습니다.' : error instanceof Error ? error.message : '업로드 실패' }) }
    }
    busy.current = false; setPending(false)
  }
  return <div className="subject-modal-backdrop"><section ref={dialogRef} className="subject-modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" tabIndex={-1}>
    <header className="subject-modal-header"><h2 id="upload-title">PDF 자료 추가</h2><button className="subject-modal-close" type="button" aria-label="팝업 닫기" disabled={pending} onClick={onClose}>×</button></header>
    <form onSubmit={submit}>
      <div className="upload-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!pending) add(e.dataTransfer.files) }}><strong>PDF를 여기에 놓으세요</strong><p>또는 기기에서 파일을 선택하세요</p><button type="button" disabled={pending} onClick={() => inputRef.current?.click()}>파일 선택하기</button><input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} /></div>
      {notice && <p role="alert">{notice}</p>}
      <ul className="upload-list">{items.map((item) => <li key={item.id}><span className="upload-name" title={item.file.name}>{item.file.name}</span><label>주차 <input aria-label={`${item.file.name} 주차`} inputMode="numeric" value={item.week} disabled={pending || item.status === 'success'} onChange={(e) => update(item.id, { week: e.target.value.replace(/[^0-9]/g, '') })} /></label><button type="button" aria-label={`${item.file.name} 제거`} disabled={pending} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>×</button><small role="status">{item.status === 'uploading' ? '업로드 중' : item.status === 'success' ? '완료' : item.status === 'error' ? item.error : ''}</small></li>)}</ul>
      <div className="subject-create-actions">{allUploaded ? <button type="button" onClick={onClose}>닫기</button> : <><button type="button" className="subject-create-cancel" disabled={pending} onClick={onClose}>닫기</button><button type="submit" disabled={pending || !items.some((item) => item.status !== 'success')}>{pending ? '업로드 중...' : '업로드'}</button></>}</div>
    </form>
  </section></div>
}
