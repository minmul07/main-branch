import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders notebooks using the existing mock subjects and documents', () => {
  render(<App />)

  expect(screen.getByRole('heading', { level: 1, name: '내 수업' })).toBeTruthy()
  const cards = within(screen.getByRole('list', { name: '과목 목록' })).getAllByRole('listitem')
  expect(cards).toHaveLength(2)
  expect(within(cards[0]).getByRole('heading', { name: '자료구조' })).toBeTruthy()
  expect(within(cards[0]).getByText(/2026년 10월 4일.*자료 2개/)).toBeTruthy()
  expect(within(cards[1]).getByRole('heading', { name: '오픈소스소프트웨어개발' })).toBeTruthy()
  expect(within(cards[1]).getByText(/등록된 자료 없음.*자료 0개/)).toBeTruthy()
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
