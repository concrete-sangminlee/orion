/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useProblemsStore } from '@/store/problems'
import { createFakeMonaco, fakeModel } from './__tests__/fakeMonaco'
import { LINT_HINT_OWNER, syncProblemsWithMonaco } from './diagnostics'

const open = (...paths: string[]) => useEditorStore.setState({
  openFiles: paths.map((path): OpenFile => ({ path, name: path, content: '', language: 'typescript', isModified: false, aiModified: false })),
  activeFilePath: paths[0] ?? null,
})
const marker = (severity: number, message: string, line = 1) =>
  ({ severity, message, startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 2 })

beforeEach(() => {
  useProblemsStore.setState({ problems: [] })
  open()
})

describe('syncProblemsWithMonaco', () => {
  it('lists what the language services report for open files, and nothing for closed ones', () => {
    const fake = createFakeMonaco()
    open('/w/a.ts')
    syncProblemsWithMonaco(fake.monaco as never)
    const a = fakeModel('/w/a.ts', 'x')
    const b = fakeModel('/w/b.json', '{')

    fake.report(a, 'typescript', [marker(8, "Cannot find name 'x'."), marker(4, 'Deprecated', 2), marker(1, 'unused (hint)')])
    fake.report(b, 'json', [marker(8, 'Expected value')])

    expect(useProblemsStore.getState().problems.map(({ file, severity, message, source }) => ({ file, severity, message, source }))).toEqual([
      { file: '/w/a.ts', severity: 'error', message: "Cannot find name 'x'.", source: 'typescript' },
      { file: '/w/a.ts', severity: 'warning', message: 'Deprecated', source: 'typescript' },
    ])

    open('/w/a.ts', '/w/b.json')
    expect(useProblemsStore.getState().problems.map((p) => p.message)).toContain('Expected value')
    open('/w/b.json')
    expect(useProblemsStore.getState().problems.map((p) => p.message)).toEqual(['Expected value'])
  })

  it('publishes JS/TS lint hints as Monaco markers, never as errors', () => {
    const fake = createFakeMonaco()
    open('/w/a.ts')
    syncProblemsWithMonaco(fake.monaco as never)
    const model = fakeModel('/w/a.ts', "const s = x.replace(/'/g, \"x\")\n// TODO: tidy\nconsole.log(s)")
    fake.addModel(model)

    const hints = fake.markers.filter((m) => m.owner === LINT_HINT_OWNER)
    expect(hints.map((m) => [m.message, m.startLineNumber])).toEqual([['TODO: tidy', 2], ['console.log statement', 3]])
    expect(useProblemsStore.getState().problems.map((p) => [p.severity, p.source])).toEqual([['info', 'todo'], ['info', 'lint-hint']])

    model.edit('const s = 1', 1)
    expect(fake.markers.filter((m) => m.owner === LINT_HINT_OWNER)).toEqual([])
    expect(useProblemsStore.getState().problems).toEqual([])
  })

  it('does not scan other languages', () => {
    const fake = createFakeMonaco()
    syncProblemsWithMonaco(fake.monaco as never)
    fake.addModel(fakeModel('/w/run.sh', 'case $1 in\n  start) echo // TODO no\nesac', 'shell'))
    expect(fake.markers).toEqual([])
  })
})
