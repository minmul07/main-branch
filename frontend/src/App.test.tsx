import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import App from './App'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

test('renders the existing subjects with five mock documents each', () => {
  render(<App />)

  expect(screen.getByRole('heading', { level: 1, name: '내 수업' })).toBeTruthy()
  const cards = within(screen.getByRole('list', { name: '과목 목록' })).getAllByRole('listitem')
  expect(cards).toHaveLength(2)
  expect(within(cards[0]).getByRole('heading', { name: '자료구조' })).toBeTruthy()
  expect(within(cards[0]).getByText('자료 5개')).toBeTruthy()
  expect(within(cards[0]).queryByText(/2026년/)).toBeNull()
  expect(within(cards[1]).getByRole('heading', { name: '오픈소스소프트웨어개발' })).toBeTruthy()
  expect(within(cards[1]).getByText('자료 5개')).toBeTruthy()
  expect(within(cards[1]).queryByText('등록된 자료 없음')).toBeNull()
})

test('shows a PDF sidebar and the selected document metadata', () => {
  render(<App />)

  fireEvent.click(screen.getByRole('link', { name: '자료구조 과목 열기' }))
  expect(window.location.pathname).toBe('/subjects/1')
  expect(screen.getByRole('heading', { level: 1, name: '자료구조' })).toBeTruthy()
  expect(screen.getByRole('complementary', { name: '자료 목록' })).toBeTruthy()
  expect(screen.getByText('PDF를 선택하면 파일 정보가 여기에 표시됩니다.')).toBeTruthy()

  const documentRows = within(screen.getByRole('list', { name: '자료구조 자료 목록' })).getAllByRole('button')
  expect(documentRows).toHaveLength(5)
  documentRows.forEach((row, index) => {
    expect(row.textContent).toBe(`test${index + 1}.pdf${index + 1}주차`)
    expect(row.getAttribute('aria-pressed')).toBe('false')
  })

  fireEvent.click(documentRows[0])
  expect(documentRows[0].getAttribute('aria-pressed')).toBe('true')
  const details = screen.getByRole('region', { name: '자료 정보' })
  expect(within(details).getByText('test1.pdf')).toBeTruthy()
  expect(within(details).getByText('1주차')).toBeTruthy()
  expect(within(details).getByText('240 KB')).toBeTruthy()
  expect(within(details).getByText('12페이지')).toBeTruthy()
  expect(within(details).getByText('추가 일시').parentElement?.querySelector('dd')?.textContent).not.toBe('')

  fireEvent.click(documentRows[1])
  expect(documentRows[0].getAttribute('aria-pressed')).toBe('false')
  expect(documentRows[1].getAttribute('aria-pressed')).toBe('true')
  expect(within(details).getByText('test2.pdf')).toBeTruthy()

  fireEvent.click(documentRows[4])
  expect(within(details).getByText('확인 전')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '내 수업' }))
  expect(window.location.pathname).toBe('/')
})

test('newly created subjects also receive the five mock PDF rows', () => {
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: '수업 추가' }))
  fireEvent.change(screen.getByRole('textbox', { name: '과목 이름' }), { target: { value: '새 과목' } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))

  expect(window.location.pathname).toBe('/subjects/3')
  expect(screen.getByRole('heading', { level: 1, name: '새 과목' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '과목 이름' })).toBeNull()
  const documentRows = within(screen.getByRole('list', { name: '새 과목 자료 목록' })).getAllByRole('button')
  expect(documentRows).toHaveLength(5)
  expect(documentRows[0].textContent).toBe('test1.pdf1주차')
  expect(documentRows[4].textContent).toBe('test5.pdf5주차')
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
  expect(window.location.pathname).toBe('/subjects/3')
  expect(screen.getByRole('heading', { level: 1, name: hundredCharacters })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '과목 이름' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '내 수업' }))
  fireEvent.click(screen.getByRole('button', { name: '수업 추가' }))
  fireEvent.change(screen.getByRole('textbox', { name: '과목 이름' }), { target: { value: '  자료구조  ' } })
  fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
  expect(window.location.pathname).toBe('/subjects/4')

  fireEvent.click(screen.getByRole('button', { name: '내 수업' }))
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

test('keeps keyboard focus inside the subject creation dialog and restores its opener', () => {
  render(<App />)
  const opener = screen.getByRole('button', { name: '수업 추가' })
  opener.focus()
  fireEvent.click(opener)

  const input = screen.getByRole('textbox', { name: '과목 이름' })
  const cancelButton = screen.getByRole('button', { name: '취소' })
  const submitButton = screen.getByRole('button', { name: '과목 추가' })
  expect(document.activeElement).toBe(input)

  submitButton.focus()
  fireEvent.keyDown(submitButton, { key: 'Tab' })
  const closeButton = screen.getByRole('button', { name: '팝업 닫기' })
  expect(document.activeElement).toBe(closeButton)
  closeButton.focus()
  fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(submitButton)

  fireEvent.click(cancelButton)
  expect(document.activeElement).toBe(opener)
})

test('keeps keyboard focus inside the deletion dialog and restores its menu opener', () => {
  render(<App />)
  const menuOpener = screen.getByRole('button', { name: '자료구조 메뉴' })
  menuOpener.focus()
  fireEvent.click(menuOpener)
  const deleteButton = screen.getByRole('button', { name: '삭제' })
  deleteButton.focus()
  fireEvent.click(deleteButton)

  const dialog = screen.getByRole('dialog', { name: '과목 삭제 확인' })
  const closeButton = within(dialog).getByRole('button', { name: '팝업 닫기' })
  const cancelButton = within(dialog).getByRole('button', { name: '취소' })
  const confirmButton = within(dialog).getByRole('button', { name: '삭제' })
  expect(document.activeElement).toBe(cancelButton)

  confirmButton.focus()
  fireEvent.keyDown(confirmButton, { key: 'Tab' })
  expect(document.activeElement).toBe(closeButton)
  closeButton.focus()
  fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(confirmButton)

  fireEvent.click(cancelButton)
  expect(document.activeElement).toBe(menuOpener)
})
