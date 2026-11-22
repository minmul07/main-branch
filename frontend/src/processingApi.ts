import { API_BASE_URL } from './config'

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type DocumentProcessing = {
  document_id: number
  status: ProcessingStatus
  error_code: string | null
  page_kinds: string[] | null
}

export class ProcessingRequestError extends Error {
  status: number
  constructor(status: number) { super(`HTTP ${status}`); this.status = status }
}

export async function getProcessing(documentId: number): Promise<DocumentProcessing> {
  const response = await fetch(`${API_BASE_URL}/documents/${documentId}/processing`)
  if (!response.ok) throw new ProcessingRequestError(response.status)
  return response.json()
}

export async function retryProcessing(documentId: number): Promise<DocumentProcessing> {
  const response = await fetch(`${API_BASE_URL}/documents/${documentId}/processing/retry`, { method: 'POST' })
  if (response.status !== 202) throw new ProcessingRequestError(response.status)
  return response.json()
}
