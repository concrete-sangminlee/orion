/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useProblemsStore, type Problem } from '@/store/problems'
import ProblemsPanel from './ProblemsPanel'

const problem: Problem = {
  id: '/w/a.ts#0', severity: 'error', message: "Cannot find name 'y'.", file: '/w/a.ts', line: 3, column: 5, source: 'typescript',
}

beforeEach(() => useProblemsStore.setState({ problems: [] }))
afterEach(cleanup)

describe('ProblemsPanel', () => {
  it('shows the reported problem with only controls that do something', () => {
    useProblemsStore.setState({ problems: [problem] })
    const { container } = render(<ProblemsPanel />)
    expect(screen.getByText("Cannot find name 'y'.")).toBeTruthy()

    fireEvent.contextMenu(screen.getByText("Cannot find name 'y'."))
    expect(screen.getByText('Go to Problem')).toBeTruthy()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/Quick Fix|Dismiss Problem|Clear Problems/)
    expect(container.querySelector('[title*="Quick fix"], [title*="quick fixes"], [title*="Clear"]')).toBeNull()
  })

  it('does not claim ESLint or other servers that do not run', () => {
    const { container } = render(<ProblemsPanel />)
    expect(container.textContent).toContain('No problems detected')
    expect(container.textContent).not.toMatch(/ESLint|language servers/)
  })
})
