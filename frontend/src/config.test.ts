import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

test('uses the configured API base URL', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
  const { API_BASE_URL } = await import('./config')

  expect(API_BASE_URL).toBe('https://api.example.com')
})

test.each([undefined, ''])('uses the local API URL when env is %s', async (value) => {
  vi.stubEnv('VITE_API_BASE_URL', value)
  const { API_BASE_URL } = await import('./config')

  expect(API_BASE_URL).toBe('http://127.0.0.1:8000')
})
