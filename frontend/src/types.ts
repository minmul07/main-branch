export type Subject = { id: number; name: string; document_count: number }

export type Note = {
  id: number
  document_id: number
  page_number: number | null
  title: string
  content: string
  created_at: string
  updated_at: string
}

export type MockDocument = {
  id: number
  subject_id: number
  week_number: number
  filename: string
  uploaded_at: string
  file_size_bytes: number
  page_count: number | null
}

export type SearchResult = {
  document_id: number
  page_id: number
  page_number: number
  filename: string
  subject_id: number
  subject_name: string
  week_number: number
  snippet: string
}

export type PageTarget = { documentId: number; page: number; nonce: number }