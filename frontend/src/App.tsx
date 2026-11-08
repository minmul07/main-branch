import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { listSubjects, createSubject } from './subjectsApi'
import type { Subject } from './types'
import SubjectCreateForm from './components/SubjectCreateForm'
import SubjectDocumentsPage from './components/SubjectDocumentsPage'
import DeleteDialog from './components/DeleteDialog'

function routeId() {
  const match = window.location.pathname.match(/^\/subjects\/(\d+)\/?$/)
  const id = match ? Number(match[1]) : 0
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function App() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [activeId, setActiveId] = useState(routeId)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const [deleting, setDeleting] = useState<Subject | null>(null)
  const deleteFocus = useRef<HTMLElement | null>(null)
  const listVersion = useRef(0)
  const active = subjects.find((subject) => subject.id === activeId)

  useEffect(() => {
    let alive = true
    const version = ++listVersion.current
    listSubjects().then((data) => { if (alive && version === listVersion.current) { setSubjects(data); setState('ready') } })
      .catch(() => { if (alive && version === listVersion.current) setState('error') })
    return () => { alive = false }
  }, [attempt])
  useEffect(() => {
    function sync() { setActiveId(routeId()); setSelectedId(null); setOpenMenuId(null); setDeleting(null); setAttempt((n) => n + 1) }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  useEffect(() => {
    function reconcile() { setAttempt((n) => n + 1) }
    window.addEventListener('deletion-settled', reconcile)
    return () => window.removeEventListener('deletion-settled', reconcile)
  }, [])
  useEffect(() => {
    if (openMenuId === null) return
    function closeOutside(event: globalThis.MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('[data-subject-menu]')) setOpenMenuId(null)
    }
    document.addEventListener('click', closeOutside)
    return () => document.removeEventListener('click', closeOutside)
  }, [openMenuId])
  function navigate(id: number | null) {
    window.history.pushState({}, '', id === null ? '/' : `/subjects/${id}`)
    setActiveId(id); setSelectedId(null); setOpenMenuId(null); setDeleting(null)
    if (id === null) setAttempt((n) => n + 1)
  }
  async function refreshSubjects() {
    const version = ++listVersion.current
    const items = await listSubjects()
    if (version !== listVersion.current) return
    setSubjects(items)
    const currentId = routeId()
    if (currentId !== null && !items.some((item) => item.id === currentId)) navigate(null)
  }
  async function create(name: string) {
    const subject = await createSubject(name)
    setSubjects((current) => [...current, subject])
    setAdding(false)
    navigate(subject.id)
  }
  function open(event: MouseEvent<HTMLAnchorElement>, id: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); navigate(id)
  }
  return <main className={`notebooks${state === 'ready' && activeId !== null && active ? ' notebooks-subject' : ''}`}>
    {state === 'loading' ? <p role="status">과목을 불러오는 중입니다.</p> : state === 'error' ?
      <section role="alert"><p>과목을 불러오지 못했습니다.</p><button type="button" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>다시 시도</button></section> :
      activeId !== null ? active ?
        <SubjectDocumentsPage key={active.id} subject={active} selectedDocumentId={selectedId} onBack={() => navigate(null)} onSelectDocument={setSelectedId} /> :
        <section className="subject-not-found"><h1>과목을 찾을 수 없습니다.</h1><button type="button" onClick={() => navigate(null)}>내 수업으로 돌아가기</button></section> :
      <>
        <header className="notebooks-header"><h1>내 수업</h1><button ref={addRef} className="new-notebook" type="button" aria-expanded={adding} aria-controls="add-subject" onClick={() => setAdding(true)}><span className="plus" aria-hidden="true">＋</span>수업 추가</button></header>
        {adding && <SubjectCreateForm onClose={() => setAdding(false)} onCreateSubject={create} returnFocusRef={addRef} />}
        {deleting && <DeleteDialog kind="subjects" id={deleting.id} name={deleting.name} documentCount={deleting.document_count} returnFocusRef={deleteFocus} onClose={() => setDeleting(null)} onDeleted={() => setSubjects((items) => items.filter((item) => item.id !== deleting.id))} onRefresh={refreshSubjects} />}
        {subjects.length === 0 && <p>등록된 과목이 없습니다.</p>}
        <ul className="notebook-grid" aria-label="과목 목록">{subjects.map((subject) => <li className={`notebook-card${openMenuId === subject.id ? ' has-open-menu' : ''}`} key={subject.id}>
          <a className="notebook-card-link" href={`/subjects/${subject.id}`} aria-label={`${subject.name} 과목 열기`} onClick={(event) => open(event, subject.id)} />
          <div className="notebook-card-top">
            <div className="notebook-info" data-subject-menu>
              <button className="notebook-info-toggle" type="button" aria-label={`${subject.name} 메뉴`} aria-haspopup="dialog" aria-expanded={openMenuId === subject.id} aria-controls={openMenuId === subject.id ? `subject-menu-${subject.id}` : undefined} onClick={() => setOpenMenuId((current) => current === subject.id ? null : subject.id)}>⋮</button>
              {openMenuId === subject.id && <div className="notebook-info-content" id={`subject-menu-${subject.id}`} role="dialog" aria-label={`${subject.name} 메뉴`}>
                <button type="button" onClick={() => { deleteFocus.current = document.querySelector(`[aria-controls="subject-menu-${subject.id}"]`); setOpenMenuId(null); setDeleting(subject) }}>삭제</button>
              </div>}
            </div>
          </div>
          <div className="notebook-card-text"><h2 title={subject.name}>{subject.name}</h2></div>
        </li>)}</ul>
      </>}
  </main>
}
export default App
