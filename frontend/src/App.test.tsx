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

test('keeps subject validation and adds a notebook from the new notebook button', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '수업 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('alert').textContent).toBe('과목 이름을 입력하시오.')

  const input = screen.getByRole('textbox', { name: '과목 이름' })
  fireEvent.change(input, { target: { value: '자료구조' } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('alert').textContent).toBe('이미 존재하는 과목입니다.')

  fireEvent.change(input, { target: { value: '  선형대수학  ' } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(screen.getByRole('heading', { name: '선형대수학' })).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
})
