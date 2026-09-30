import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders the App heading', () => {
  render(<App />)

  expect(screen.getByRole('heading', { level: 1, name: 'App' })).toBeTruthy()
})
