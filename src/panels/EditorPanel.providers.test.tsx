/** @vitest-environment jsdom */
/**
 * EditorPanel's Monaco wiring: editor settings reach the editor options,
 * global providers are registered once however often <Editor> remounts, and
 * the Problems store is fed from Monaco's markers.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useProblemsStore } from '@/store/problems'
import { useToastStore } from '@/store/toast'
import { createFakeMonaco, fakeModel } from '@/providers/__tests__/fakeMonaco'

interface MountedEditor {
  props: { path?: string; value?: string; options?: Record<string, unknown>; onMount?: (editor: unknown, monaco: unknown) => void }
  value: string
  decorations: Array<{ options?: { after?: { content?: string } } }>
}

const fake = vi.hoisted(() => ({
  editors: [] as MountedEditor[],
  monaco: null as unknown,
  /** Mount as @monaco-editor/react does once Monaco has loaded: after the panel's effects ran. */
  asyncMount: false,
}))

vi.mock('@/monaco/setup', () => ({
  disposeModelsExcept: vi.fn(),
  modelPathFor: (p: string) => `file://${p}`,
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  // Stands in for every editor API the panel touches that these tests do not inspect.
  const anything: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined
      if (prop === Symbol.iterator) return function* () {}
      if (prop === Symbol.toPrimitive) return () => 0
      return anything
    },
    apply: () => anything,
    construct: () => anything as object,
  })
  const withFallback = <T extends object>(target: T): T =>
    new Proxy(target, { get: (t, prop) => (prop in t ? (t as Record<PropertyKey, unknown>)[prop] : anything) })

  function Editor(props: MountedEditor['props']) {
    const ref = React.useRef<MountedEditor | null>(null)
    if (!ref.current) ref.current = { props, value: props.value ?? '', decorations: [] }
    const mounted = ref.current
    mounted.props = props
    React.useEffect(() => {
      fake.editors.push(mounted)
      const model = withFallback({
        uri: { toString: () => mounted.props.path },
        getValue: () => mounted.value,
        setValue: (v: string) => { mounted.value = v },
      })
      let disposed = false
      const api = withFallback({
        getModel: () => model,
        hasTextFocus: () => false,
        getAction: () => null,
        // A disposed Monaco editor ignores decoration changes.
        deltaDecorations: (_old: string[], next: MountedEditor['decorations']) => {
          if (disposed) return []
          mounted.decorations.push(...next)
          return next.map((_, i) => `d${i}`)
        },
      })
      const mount = () => {
        try {
          props.onMount?.(api, fake.monaco)
        } catch {
          // Per-editor setup that needs a real Monaco is not under test.
        }
      }
      if (fake.asyncMount) void Promise.resolve().then(mount)
      else mount()
      return () => {
        disposed = true
        fake.editors.splice(fake.editors.indexOf(mounted), 1)
      }
    }, [])
    return React.createElement('div', { 'data-testid': 'monaco' })
  }
  return { default: Editor, Editor, DiffEditor: () => null }
})

vi.mock('@/components/TabBar', () => ({ default: () => null }))
vi.mock('@/components/GhostTextProvider', () => ({ default: () => null }))
vi.mock('@/components/EmmetProvider', () => ({ default: () => null }))

import EditorPanel from './EditorPanel'

const file = (path: string, content: string): OpenFile => ({
  path, name: path.split('/').pop()!, content, language: 'typescript', isModified: false, aiModified: false,
})

/** The fake Monaco, with anything the panel calls that it lacks answered by a no-op. */
function deepFallback<T extends object>(target: T): T {
  const anything: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => 0 : anything),
    apply: () => anything,
  })
  return new Proxy(target, {
    get: (t, prop) => {
      if (!(prop in t)) return anything
      const v = (t as Record<PropertyKey, unknown>)[prop]
      return v && typeof v === 'object' ? deepFallback(v as object) : v
    },
  })
}

let monacoFake: ReturnType<typeof createFakeMonaco>
let writeFile: ReturnType<typeof vi.fn>

async function dispatch(name: string, detail?: unknown) {
  await act(async () => {
    window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }))
  })
}

const lastOptions = () => fake.editors[0].props.options!

beforeEach(() => {
  fake.editors.length = 0
  fake.asyncMount = false
  monacoFake = createFakeMonaco()
  fake.monaco = deepFallback(monacoFake.monaco)
  localStorage.clear()
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  writeFile = vi.fn().mockResolvedValue({ success: true })
  ;(window as unknown as { api: unknown }).api = { writeFile, readFile: vi.fn(), saveFileDialog: vi.fn() }
  useToastStore.setState({ toasts: [] })
  useProblemsStore.setState({ problems: [] })
  useEditorStore.setState({ openFiles: [file('/w/a.ts', 'let x = 1   ')], activeFilePath: '/w/a.ts', previewPath: null, pinnedTabs: [], tabHistory: [] })
})

afterEach(() => {
  cleanup()
})

describe('editor settings (#44)', () => {
  it('applies every Settings > Editor value to the editor options', async () => {
    await act(async () => { render(<EditorPanel />) })
    await dispatch('orion:editor-config', {
      tabSize: 4, insertSpaces: false, cursorBlinking: 'phase', lineNumbersMode: 'relative',
      rulers: [80, 120], minimap: true, minimapSide: 'left', stickyScroll: false, smoothScrolling: false,
      bracketPairColorization: false, formatOnPaste: true, wordWrap: true, wordWrapMode: 'wordWrapColumn', wordWrapColumn: 100,
    })

    expect(lastOptions()).toMatchObject({
      tabSize: 4, insertSpaces: false, cursorBlinking: 'phase', lineNumbers: 'relative', rulers: [80, 120],
      minimap: { enabled: true, side: 'left' }, stickyScroll: { enabled: false }, smoothScrolling: false,
      bracketPairColorization: { enabled: false }, formatOnPaste: true, wordWrap: 'wordWrapColumn', wordWrapColumn: 100,
    })
  })

  it('File > Save uses the save settings as they are now, not as they were when the panel mounted', async () => {
    await act(async () => { render(<EditorPanel />) })
    await dispatch('orion:editor-config', { trimTrailingWhitespace: false, insertFinalNewline: false })
    await dispatch('orion:save-file')

    expect(writeFile).toHaveBeenCalledWith('/w/a.ts', 'let x = 1   ')
  })
})

describe('Monaco providers (#46, #76)', () => {
  it('registers the global providers once although the editor remounts', async () => {
    await act(async () => { render(<EditorPanel />) })
    const afterFirstMount = monacoFake.providers.length
    await act(async () => { useEditorStore.setState({ openFiles: [], activeFilePath: null }) })
    await act(async () => { useEditorStore.setState({ openFiles: [file('/w/a.ts', 'x')], activeFilePath: '/w/a.ts' }) })

    expect(fake.editors).toHaveLength(1)
    expect(afterFirstMount).toBeGreaterThan(0)
    expect(monacoFake.providers.length).toBe(afterFirstMount)
  })
})

describe('Problems feed (#61)', () => {
  it('lists the markers Monaco reports for the open file', async () => {
    await act(async () => { render(<EditorPanel />) })
    const model = fakeModel('/w/a.ts', 'let x = 1   ')
    await act(async () => {
      monacoFake.report(model, 'typescript', [{ severity: 8, message: "Cannot find name 'y'.", startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 6 }])
    })

    expect(useProblemsStore.getState().problems).toEqual([
      expect.objectContaining({ file: '/w/a.ts', severity: 'error', message: "Cannot find name 'y'.", source: 'typescript', line: 1, column: 5 }),
    ])
  })

  it('does not write the store back into Monaco as a second set of markers', async () => {
    useEditorStore.setState({ openFiles: [file('/w/a.ts', 'a'), file('/w/b.ts', 'b')], activeFilePath: '/w/b.ts' })
    await act(async () => { render(<EditorPanel />) })
    // The error lens redraws for a.ts on the switch.
    await act(async () => { useEditorStore.setState({ activeFilePath: '/w/a.ts' }) })
    await act(async () => {
      monacoFake.report(fakeModel('/w/a.ts', 'a'), 'typescript', [{ severity: 8, message: 'Bad', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }])
    })

    expect(monacoFake.markers.map((m) => m.owner)).toEqual(['typescript'])
    expect(useProblemsStore.getState().problems).toHaveLength(1)
  })

  describe('error lens in an editor Monaco mounts after the file is shown', () => {
    const lensMessages = (editor: MountedEditor) =>
      editor.decorations.map((d) => d.options?.after?.content?.trim()).filter(Boolean)
    const reportError = (message: string) => act(async () => {
      monacoFake.report(fakeModel('/w/a.ts', 'let x = 1   '), 'typescript', [{ severity: 8, message, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }])
    })
    const mountLater = async () => { await act(async () => { await Promise.resolve() }) }

    it('draws the messages for the first file opened', async () => {
      fake.asyncMount = true
      await act(async () => { render(<EditorPanel />) })
      await mountLater()
      await reportError('Bad')

      expect(lensMessages(fake.editors[0])).toEqual(['Bad'])
    })

    it('draws them in the new editor after a remount, not in the disposed one', async () => {
      fake.asyncMount = true
      await act(async () => { render(<EditorPanel />) })
      await mountLater()
      await act(async () => { useEditorStore.setState({ openFiles: [], activeFilePath: null }) })
      await act(async () => { useEditorStore.setState({ openFiles: [file('/w/a.ts', 'let x = 1   ')], activeFilePath: '/w/a.ts' }) })
      await mountLater()
      await reportError('Still bad')

      expect(fake.editors).toHaveLength(1)
      expect(lensMessages(fake.editors[0])).toEqual(['Still bad'])
    })
  })
})
