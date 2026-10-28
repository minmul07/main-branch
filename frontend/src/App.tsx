import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { getMockDocumentsForSubject, initialSubjects } from './mocks/data'
import ConfirmPopup from './components/ConfirmPopup'
import SubjectCreateForm from './components/SubjectCreateForm'
import SubjectDocumentsPage from './components/SubjectDocumentsPage'

function getSubjectIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/subjects\/(\d+)\/?$/)
  if (!match) return null

  const subjectId = Number(match[1])
  return Number.isSafeInteger(subjectId) && subjectId > 0 ? subjectId : null
}

function App() {
  const [subjects, setSubjects] = useState(initialSubjects)
  const [isAdding, setIsAdding] = useState(false)
  const [openSubjectMenuId, setOpenSubjectMenuId] = useState<number | null>(null)
  const [subjectToDeleteId, setSubjectToDeleteId] = useState<number | null>(null)
  const [activeSubjectId, setActiveSubjectId] = useState(() => getSubjectIdFromPath(window.location.pathname))
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null)
  const subjectToDelete = subjects.find((subject) => subject.id === subjectToDeleteId)
  const activeSubject = subjects.find((subject) => subject.id === activeSubjectId)

  useEffect(() => {
    function syncRouteFromHistory() {
      setActiveSubjectId(getSubjectIdFromPath(window.location.pathname))
      setSelectedDocumentId(null)
      setOpenSubjectMenuId(null)
    }

    window.addEventListener('popstate', syncRouteFromHistory)
    return () => window.removeEventListener('popstate', syncRouteFromHistory)
  }, [])

  useEffect(() => {
    if (openSubjectMenuId === null) return

    function closeMenuOnOutsideClick(event: globalThis.MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('[data-subject-menu]')) {
        setOpenSubjectMenuId(null)
      }
    }

    document.addEventListener('click', closeMenuOnOutsideClick)
    return () => document.removeEventListener('click', closeMenuOnOutsideClick)
  }, [openSubjectMenuId])

  function handleCreateSubject(name: string) {
    const nextId = Math.max(0, ...subjects.map((s) => s.id)) + 1
    setSubjects([...subjects, { id: nextId, name }])
    setIsAdding(false)
  }

  function navigateToSubjectList() {
    window.history.pushState({}, '', '/')
    setActiveSubjectId(null)
    setSelectedDocumentId(null)
    setOpenSubjectMenuId(null)
  }

  function handleSubjectNavigation(event: MouseEvent<HTMLAnchorElement>, subjectId: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()
    window.history.pushState({}, '', `/subjects/${subjectId}`)
    setActiveSubjectId(subjectId)
    setSelectedDocumentId(null)
    setOpenSubjectMenuId(null)
  }

  function handleRequestDelete(subjectId: number) {
    setOpenSubjectMenuId(null)
    setSubjectToDeleteId(subjectId)
  }

  function handleConfirmDelete() {
    if (subjectToDeleteId === null) return

    setSubjects((currentSubjects) => currentSubjects.filter((subject) => subject.id !== subjectToDeleteId))
    setSubjectToDeleteId(null)
  }

  return (
    <main className="notebooks">
      {activeSubjectId !== null ? (
        activeSubject ? (
          <SubjectDocumentsPage
            subject={activeSubject}
            selectedDocumentId={selectedDocumentId}
            onBack={navigateToSubjectList}
            onSelectDocument={setSelectedDocumentId}
          />
        ) : (
          <section className="subject-not-found" aria-labelledby="subject-not-found-title">
            <h1 id="subject-not-found-title">과목을 찾을 수 없습니다.</h1>
            <button className="subject-page-back" type="button" onClick={navigateToSubjectList}>
              내 수업으로 돌아가기
            </button>
          </section>
        )
      ) : (
        <>
          <header className="notebooks-header">
            <h1>내 수업</h1>
            <button
              className="new-notebook"
              type="button"
              aria-expanded={isAdding}
              aria-controls="add-subject"
              onClick={() => setIsAdding(true)}
            >
              <span className="plus" aria-hidden="true">＋</span>
              수업 추가
            </button>
          </header>

          {isAdding && (
            <SubjectCreateForm
              onClose={() => setIsAdding(false)}
              onCreateSubject={handleCreateSubject}
            />
          )}

          {subjectToDelete && (
            <ConfirmPopup
              title="과목 삭제 확인"
              message={`${subjectToDelete.name} 과목을 삭제하시겠습니까?`}
              confirmLabel="삭제"
              onClose={() => setSubjectToDeleteId(null)}
              onConfirm={handleConfirmDelete}
            />
          )}

          <ul className="notebook-grid" aria-label="과목 목록">
            {subjects.map((subject) => {
              const documents = getMockDocumentsForSubject(subject.id)

              return (
                <li
                  className={`notebook-card${openSubjectMenuId === subject.id ? ' has-open-menu' : ''}`}
                  key={subject.id}
                >
                  <a
                    className="notebook-card-link"
                    href={`/subjects/${subject.id}`}
                    aria-label={`${subject.name} 과목 열기`}
                    onClick={(event) => handleSubjectNavigation(event, subject.id)}
                  />
                  <div className="notebook-card-top">
                    <div className="notebook-info" data-subject-menu>
                      <button
                        className="notebook-info-toggle"
                        type="button"
                        aria-label={`${subject.name} 메뉴`}
                        aria-haspopup="dialog"
                        aria-expanded={openSubjectMenuId === subject.id}
                        aria-controls={openSubjectMenuId === subject.id ? `subject-menu-${subject.id}` : undefined}
                        onClick={() => setOpenSubjectMenuId((currentId) => currentId === subject.id ? null : subject.id)}
                      >
                        ⋮
                      </button>
                      {openSubjectMenuId === subject.id && (
                        <div
                          className="notebook-info-content"
                          id={`subject-menu-${subject.id}`}
                          role="dialog"
                          aria-label={`${subject.name} 메뉴`}
                        >
                          <button type="button" onClick={() => handleRequestDelete(subject.id)}>
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="notebook-card-text">
                    <h2 title={subject.name}>{subject.name}</h2>
                    <p>자료 {documents.length}개</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}

export default App
