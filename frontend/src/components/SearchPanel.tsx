import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { searchPages } from '../searchApi'
import type { SearchResult } from '../types'

type SearchPanelProps = { onSelect: (result: SearchResult) => void }
type SearchState = 'idle' | 'loading' | 'ready' | 'error'

export default function SearchPanel({ onSelect }: SearchPanelProps) {
  const [input, setInput] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [results, setResults] = useState<SearchResult[]>([])
  const [emptyQuery, setEmptyQuery] = useState(false)
  // 늦게 도착한 이전 검색 결과가 최신 결과를 덮어쓰지 않도록 요청 번호를 센다.
  const requestId = useRef(0)

  async function run(query: string) {
    const id = ++requestId.current
    setSubmitted(query)
    setState('loading')
    try {
      const items = await searchPages(query)
      if (id !== requestId.current) return
      setResults(items)
      setState('ready')
    } catch {
      if (id !== requestId.current) return
      setState('error')
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = input.trim()
    if (!query) {
      requestId.current++
      setEmptyQuery(true)
      setResults([])
      setState('idle')
      return
    }
    setEmptyQuery(false)
    void run(query)
  }

  return (
    <section className="search-panel" aria-label="자료 검색">
      <form className="search-form" role="search" onSubmit={submit}>
        <input
          type="search"
          aria-label="검색어"
          placeholder="모든 수업에서 검색"
          maxLength={100}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={state === 'loading'}>검색</button>
      </form>
      {emptyQuery && <p role="alert">검색어를 입력하세요.</p>}
      {state === 'loading' && <p role="status">검색 중...</p>}
      {state === 'error' && (
        <div role="alert">
          검색하지 못했습니다. <button type="button" onClick={() => { void run(submitted) }}>다시 시도</button>
        </div>
      )}
      {state === 'ready' && results.length === 0 && <p>“{submitted}”에 대한 결과가 없습니다.</p>}
      {state === 'ready' && results.length > 0 && (
        <ul className="search-results" aria-label={`“${submitted}” 검색 결과`}>
          {results.map((result) => (
            <li key={result.page_id}>
              <button type="button" className="search-result" onClick={() => onSelect(result)}>
                <span className="search-result-path">
                  {result.subject_name} › {result.filename} · {result.week_number}주차 · {result.page_number}페이지
                </span>
                <span className="search-result-snippet">{result.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}