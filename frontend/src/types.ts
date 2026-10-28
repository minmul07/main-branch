export type Subject = { id: number; name: string }

export type MockDocument = {
  id: number
  subject_id: number
  week_number: number
  filename: string
  uploaded_at: string
  file_size_bytes: number
  page_count: number | null
}