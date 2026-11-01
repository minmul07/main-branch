import { API_BASE_URL } from './config'
import type { MockDocument } from './types'

export async function listDocuments(subjectId: number): Promise<MockDocument[]> {
  const response = await fetch(`${API_BASE_URL}/documents?subject_id=${subjectId}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
export async function uploadDocument(file: File, subjectId: number, week: string): Promise<void> {
  const body = new FormData()
  body.append('file', file); body.append('subject_id', String(subjectId)); body.append('week_number', week)
  const response = await fetch(`${API_BASE_URL}/documents`, { method: 'POST', body })
  if (!response.ok) throw new Error(response.status === 404 ? '과목을 찾을 수 없습니다.' : response.status === 413 ? '파일 크기가 서버 제한을 초과했습니다.' : response.status === 422 ? '파일 또는 주차가 올바르지 않습니다.' : '서버 오류가 발생했습니다.')
}
