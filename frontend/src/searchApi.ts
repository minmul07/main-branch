import { API_BASE_URL } from './config'
import type { SearchResult } from './types'

export async function searchPages(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query })
  const response = await fetch(`${API_BASE_URL}/search?${params}`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}