import { useEffect, useState } from 'react'
import { initialSubjects, mockDocuments } from './mocks/data'
import ConfirmPopup from './components/ConfirmPopup'
import SubjectCreateForm from './components/SubjectCreateForm'

function App() {
  const [subjects, setSubjects] = useState(initialSubjects)
  const [isAdding, setIsAdding] = useState(false)
  const [openSubjectMenuId, setOpenSubjectMenuId] = useState<number | null>(null)
  const [subjectToDeleteId, setSubjectToDeleteId] = useState<number | null>(null)
  const subjectToDelete = subjects.find((subject) => subject.id === subjectToDeleteId)

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
          const documents = mockDocuments.filter((document) => document.subject_id === subject.id)
          const latestUpload = documents.map((document) => document.uploaded_at).sort().at(-1)
          const date = latestUpload
            ? new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul',
              }).format(new Date(latestUpload))
            : '등록된 자료 없음'

          return (
            <li
              className={`notebook-card${openSubjectMenuId === subject.id ? ' has-open-menu' : ''}`}
              key={subject.id}
            >
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
                <p>{date}<span aria-hidden="true"> · </span>자료 {documents.length}개</p>
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

export default App
