import { API_BASE_URL } from './config'
import type { Subject } from './types'

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function listSubjects(): Promise<Subject[]> { return request('/subjects') }
export function createSubject(name: string): Promise<Subject> {
  return request('/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
}
