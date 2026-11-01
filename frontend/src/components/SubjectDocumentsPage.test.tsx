import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import SubjectDocumentsPage from './SubjectDocumentsPage'

test('collapses and restores the document list with keyboard focus', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  render(<SubjectDocumentsPage subject={{ id: 1, name: '수업' }} selectedDocumentId={null} onBack={() => {}} onSelectDocument={() => {}} />)
  await screen.findByText('등록된 자료가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '자료 목록 접기' }))
  const show = screen.getByRole('button', { name: '자료 목록 펼치기' })
  expect(show.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(show)
  expect(document.getElementById('document-sidebar')?.hasAttribute('inert')).toBe(true)
  fireEvent.click(show)
  const hide = screen.getByRole('button', { name: '자료 목록 접기' })
  expect(hide.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(hide)
  expect(document.getElementById('document-sidebar')?.hasAttribute('inert')).toBe(false)
  expect(screen.getByText('등록된 자료가 없습니다.')).toBeTruthy()
  vi.unstubAllGlobals()
})
