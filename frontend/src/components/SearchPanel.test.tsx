import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import SearchPanel from './SearchPanel'
import type { SearchResult } from '../types'

const ok = (data: unknown) => ({ ok: true, json: async () => data }) as Response
const first: SearchResult = {
  document_id: 4, page_id: 130, page_number: 21, filename: 'week1.pdf',
  subject_id: 1, subject_name: '자료구조', week_number: 1,
  snippet: '…DOUBLY LINKED LISTS 1. Before the delete…',
}
const second: SearchResult = {
  document_id: 2, page_id: 3, page_number: 3, filename: 'week2.pdf',
  subject_id: 1, subject_name: '자료구조', week_number: 2,
  snippet: '…nodes linked in a row…',
}

beforeEach(() => { vi.restoreAllMocks() })

function search(query: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: '검색어' }), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
}
const requestedUrl = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => new URL(fetchMock.mock.calls[call][0] as string)

test('asks for a query instead of searching when the input is blank', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPanel onSelect={() => {}} />)
  search('   ')
  expect(screen.getByRole('alert').textContent).toBe('검색어를 입력하세요.')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('shows the searching state, then page results with location and context', async () => {
  let resolve!: (response: Response) => void
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolve = r }))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPanel onSelect={() => {}} />)
  search('  linked ')
  expect(screen.getByRole('status').textContent).toBe('검색 중...')
  expect((screen.getByRole('button', { name: '검색' }) as HTMLButtonElement).disabled).toBe(true)
  resolve(ok([first, second]))
  const list = await screen.findByRole('list', { name: '“linked” 검색 결과' })
  expect(screen.queryByRole('status')).toBeNull()
  expect(requestedUrl(fetchMock).pathname).toBe('/search')
  expect(requestedUrl(fetchMock).searchParams.get('q')).toBe('linked')
  const items = list.querySelectorAll('li')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('week1.pdf')
  expect(items[0].textContent).toContain('자료구조 · 1주차 · 21페이지')
  expect(items[0].textContent).toContain('DOUBLY LINKED LISTS')
  expect(items[0].querySelector('mark')?.textContent).toBe('LINKED')
})

test('sends special characters and Korean in the query safely', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok([]))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPanel onSelect={() => {}} />)
  search('a&b 한글')
  await screen.findByText('“a&b 한글”에 대한 결과가 없습니다.')
  expect(requestedUrl(fetchMock).searchParams.get('q')).toBe('a&b 한글')
})

test('shows a message when nothing matches', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([])))
  render(<SearchPanel onSelect={() => {}} />)
  search('elephant')
  expect(await screen.findByText('“elephant”에 대한 결과가 없습니다.')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

test('shows a failure and retries the same query', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(ok([first]))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPanel onSelect={() => {}} />)
  search('linked')
  expect((await screen.findByRole('alert')).textContent).toContain('검색하지 못했습니다.')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('list', { name: '“linked” 검색 결과' })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(requestedUrl(fetchMock, 1).searchParams.get('q')).toBe('linked')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('reports the chosen result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([first, second])))
  const onSelect = vi.fn()
  render(<SearchPanel onSelect={onSelect} />)
  search('linked')
  fireEvent.click(await screen.findByRole('button', { name: /week2\.pdf/ }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(second)
})

test('ignores a slower earlier search that finishes after a newer one', async () => {
  let resolveFirst!: (response: Response) => void
  const fetchMock = vi.fn()
    .mockReturnValueOnce(new Promise<Response>((r) => { resolveFirst = r }))
    .mockResolvedValueOnce(ok([second]))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPanel onSelect={() => {}} />)
  search('old')
  fireEvent.change(screen.getByRole('searchbox', { name: '검색어' }), { target: { value: 'new' } })
  fireEvent.submit(screen.getByRole('search'))
  await screen.findByRole('button', { name: /week2\.pdf/ })
  resolveFirst(ok([first]))
  await new Promise((r) => setTimeout(r, 0))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: /week1\.pdf/ })).toBeNull()
  expect(screen.getByRole('list', { name: '“new” 검색 결과' })).toBeTruthy()
})

test('blank search clears earlier results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([first])))
  render(<SearchPanel onSelect={() => {}} />)
  search('linked')
  await screen.findByRole('list')
  search('  ')
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByRole('alert').textContent).toBe('검색어를 입력하세요.')
})