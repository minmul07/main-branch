import { useState } from 'react'
import { initialSubjects, mockDocuments } from './mocks/data'
import SubjectCreateForm from './components/SubjectCreateForm'

function App() {
  const [subjects, setSubjects] = useState(initialSubjects)
  const [isAdding, setIsAdding] = useState(false)

  function handleCreateSubject(name: string) {
    const nextId = Math.max(0, ...subjects.map((s) => s.id)) + 1
    setSubjects([...subjects, { id: nextId, name }])
    setIsAdding(false)
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
            <li className="notebook-card" key={subject.id}>
              <div className="notebook-card-top">
                <details className="notebook-info">
                  <summary aria-label={`${subject.name} 정보`}>⋮</summary>
                  <div className="notebook-info-content">
                    <strong>{subject.name}</strong>
                    <span>자료 {documents.length}개</span>
                  </div>
                </details>
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
