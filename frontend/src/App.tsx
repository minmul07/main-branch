import { useState } from 'react'
import type { FormEvent } from 'react'
import { initialSubjects } from './mocks/data'

function App() {
  const [subjects, setSubjects] = useState(initialSubjects)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()

    if (trimmed === '') {
      setError('과목 이름을 입력하시오.')
      return
    }
    if (subjects.some((s) => s.name === trimmed)) {
      setError('이미 존재하는 과목입니다.')
      return
    }

    const nextId = Math.max(0, ...subjects.map((s) => s.id)) + 1
    setSubjects([...subjects, { id: nextId, name: trimmed }])
    setName('')
    setError('')
  }

  return (
    <main>
      <h1>App</h1>

      <form onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="과목 이름"
        />
        <button type="submit">과목 추가</button>
      </form>
      {error && <p role="alert">{error}</p>}

      <ul>
        {subjects.map((subject) => (
          <li key={subject.id}>{subject.name}</li>
        ))}
      </ul>
    </main>
  )
}

export default App