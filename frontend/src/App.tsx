import { useState } from 'react'
import type { FormEvent } from 'react'
import { initialSubjects, mockDocuments } from './mocks/data'

function App() {
  const [subjects, setSubjects] = useState(initialSubjects)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()

    if (trimmed === '') {
      setError('과목 이름을 입력하시오.')
      return
    }
    if ([...trimmed].length > 100) {
      setError('과목 이름은 100자 이하로 입력해주세요.')
      return
    }

    const nextId = Math.max(0, ...subjects.map((s) => s.id)) + 1
    setSubjects([...subjects, { id: nextId, name: trimmed }])
    setName('')
    setError('')
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
          onClick={() => {
            setIsAdding(!isAdding)
            setError('')
          }}
        >
          <span className="plus" aria-hidden="true">＋</span>
          수업 추가
        </button>
      </header>

      {isAdding && (
        <form id="add-subject" className="add-subject" onSubmit={handleSubmit}>
          <label htmlFor="subject-name">과목 이름</label>
          <div className="add-subject-fields">
            <input
              id="subject-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="과목 이름"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'subject-error' : undefined}
            />
            <button type="submit">과목 추가</button>
          </div>
          {error && <p id="subject-error" role="alert">{error}</p>}
        </form>
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
