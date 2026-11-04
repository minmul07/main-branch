import { API_BASE_URL } from './config'

export class DeleteError extends Error {
  status: number
  constructor(status: number) { super(`HTTP ${status}`); this.status = status }
}

export async function deleteResource(kind: 'subjects' | 'documents', id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/${kind}/${id}`, { method: 'DELETE' })
  if (response.status !== 204) throw new DeleteError(response.status)
}
