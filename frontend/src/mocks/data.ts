import type { Subject, MockDocument } from '../types'

export const initialSubjects: Subject[] = [
  { id: 1, name: '자료구조' },
  { id: 2, name: '오픈소스소프트웨어개발' },
]

const mockDocumentDetails = [
  { week_number: 1, filename: 'test1.pdf', uploaded_at: '2026-10-04T00:00:00Z', file_size_bytes: 245760, page_count: 12 },
  { week_number: 2, filename: 'test2.pdf', uploaded_at: '2026-10-04T01:00:00Z', file_size_bytes: 131072, page_count: 8 },
  { week_number: 3, filename: 'test3.pdf', uploaded_at: '2026-10-04T02:00:00Z', file_size_bytes: 196608, page_count: 16 },
  { week_number: 4, filename: 'test4.pdf', uploaded_at: '2026-10-04T03:00:00Z', file_size_bytes: 327680, page_count: 10 },
  { week_number: 5, filename: 'test5.pdf', uploaded_at: '2026-10-04T04:00:00Z', file_size_bytes: 163840, page_count: null },
]

export function getMockDocumentsForSubject(subjectId: number): MockDocument[] {
  return mockDocumentDetails.map((document, index) => ({
    ...document,
    id: (subjectId - 1) * mockDocumentDetails.length + index + 1,
    subject_id: subjectId,
  }))
}
