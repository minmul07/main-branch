import type { Subject, MockDocument } from '../types'

export const initialSubjects: Subject[] = [
  { id: 1, name: '자료구조' },
  { id: 2, name: '오픈소스소프트웨어개발' },
]

export const mockDocuments: MockDocument[] = [
  {
    id: 1, subject_id: 1, week_number: 1, filename: '1주차.pdf',
    uploaded_at: '2026-10-04T00:00:00Z',
    file_size_bytes: 245760, page_count: 12,
  },
  {
    id: 2, subject_id: 1, week_number: 2, filename: '2주차.pdf',
    uploaded_at: '2026-10-04T01:00:00Z',
    file_size_bytes: 131072, page_count: null,
  },
]