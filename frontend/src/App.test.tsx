import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders notebooks using the existing mock subjects and documents', () => {
  render(<App />)

  expect(screen.getByRole('heading', { level: 1, name: '내 수업' })).toBeTruthy()
  const cards = within(screen.getByRole('list', { name: '과목 목록' })).getAllByRole('listitem')
  expect(cards).toHaveLength(2)
  expect(within(cards[0]).getByRole('heading', { name: '자료구조' })).toBeTruthy()
  expect(within(cards[0]).getByText('자료 2개')).toBeTruthy()
  expect(within(cards[0]).queryByText(/2026년/)).toBeNull()
  expect(within(cards[1]).getByRole('heading', { name: '오픈소스소프트웨어개발' })).toBeTruthy()
  expect(within(cards[1]).getByText('자료 0개')).toBeTruthy()
  expect(within(cards[1]).queryByText('등록된 자료 없음')).toBeNull()
})

test('validates subject name length and allows duplicate names', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '수업 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('alert').textContent).toBe('과목 이름을 입력하시오.')

  const input = screen.getByRole('textbox', { name: '과목 이름' })
  fireEvent.change(input, { target: { value: '가'.repeat(101) } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('alert').textContent).toBe('과목 이름은 100자 이하로 입력해주세요.')

  const hundredCharacters = '가'.repeat(100)
  fireEvent.change(input, { target: { value: hundredCharacters } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('heading', { name: hundredCharacters })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '수업 추가' }))
  fireEvent.change(screen.getByRole('textbox', { name: '과목 이름' }), { target: { value: '  자료구조  ' } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getAllByRole('heading', { name: '자료구조' })).toHaveLength(2)
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('shows one subject menu at a time and closes it when clicking outside', () => {
  render(<App />)
  const subjectList = screen.getByRole('list', { name: '과목 목록' })
  const cards = within(subjectList).getAllByRole('listitem')

  fireEvent.click(within(cards[0]).getByRole('button', { name: '자료구조 메뉴' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(within(cards[0]).getByRole('button', { name: '삭제' })).toBeTruthy()

  fireEvent.click(within(cards[1]).getByRole('button', { name: '오픈소스소프트웨어개발 메뉴' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(within(cards[0]).queryByRole('dialog')).toBeNull()
  expect(within(cards[1]).getByRole('dialog')).toBeTruthy()

  fireEvent.click(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('confirms before deleting the selected subject', () => {
  render(<App />)
  const subjectList = screen.getByRole('list', { name: '과목 목록' })
  const cards = within(subjectList).getAllByRole('listitem')

  fireEvent.click(within(cards[0]).getByRole('button', { name: '자료구조 메뉴' }))
  fireEvent.click(within(cards[0]).getByRole('button', { name: '삭제' }))
  let confirmDialog = screen.getByRole('dialog', { name: '과목 삭제 확인' })
  expect(within(confirmDialog).getByText('자료구조 과목을 삭제하시겠습니까?')).toBeTruthy()
  expect(within(subjectList).getAllByRole('listitem')).toHaveLength(2)

  fireEvent.click(within(confirmDialog).getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('dialog', { name: '과목 삭제 확인' })).toBeNull()
  expect(within(subjectList).getAllByRole('listitem')).toHaveLength(2)

  fireEvent.click(within(cards[0]).getByRole('button', { name: '자료구조 메뉴' }))
  fireEvent.click(within(cards[0]).getByRole('button', { name: '삭제' }))
  confirmDialog = screen.getByRole('dialog', { name: '과목 삭제 확인' })
  fireEvent.click(within(confirmDialog).getByRole('button', { name: '삭제' }))

  const remainingCards = within(subjectList).getAllByRole('listitem')
  expect(remainingCards).toHaveLength(1)
  expect(within(remainingCards[0]).getByRole('heading', { name: '오픈소스소프트웨어개발' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '과목 삭제 확인' })).toBeNull()
})

test('closes deletion confirmation on outside click without deleting', () => {
  render(<App />)
  const subjectList = screen.getByRole('list', { name: '과목 목록' })
  const cards = within(subjectList).getAllByRole('listitem')

  fireEvent.click(within(cards[0]).getByRole('button', { name: '자료구조 메뉴' }))
  fireEvent.click(within(cards[0]).getByRole('button', { name: '삭제' }))
  const confirmDialog = screen.getByRole('dialog', { name: '과목 삭제 확인' })
  fireEvent.click(confirmDialog.parentElement as HTMLDivElement)

  expect(screen.queryByRole('dialog', { name: '과목 삭제 확인' })).toBeNull()
  expect(within(subjectList).getAllByRole('listitem')).toHaveLength(2)
})
