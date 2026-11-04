import { API_BASE_URL } from './config'

export class DeleteError extends Error {
  status: number
  constructor(status: number) { super(`HTTP ${status}`); this.status = status }
}

export async function deleteResource(kind: 'subjects' | 'documents', id: number, confirmedName?: string): Promise<void> {
  const query = confirmedName === undefined ? '' : `?confirmed_name=${encodeURIComponent(confirmedName)}`
  const response = await fetch(`${API_BASE_URL}/${kind}/${id}${query}`, { method: 'DELETE' })
  if (response.status !== 204) throw new DeleteError(response.status)
}
