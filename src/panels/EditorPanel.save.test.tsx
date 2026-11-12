/** @vitest-environment jsdom */
/**
 * Save, split-pane and compare paths of EditorPanel, against a fake Monaco
 * that keeps the one behaviour these bugs hinge on: editors showing the same
 * path share one model, and an unmounting editor disposes its model unless
 * `keepCurrentModel` is set (as @monaco-editor/react does).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

interface FakeModel {
  uri: { toString(): string }
  value: string
  editors: Set<FakeEditorHandle>
}

interface FakeEditorProps {
  path?: string
  value?: string
  keepCurrentModel?: boolean
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
}

interface FakeEditorHandle {
  props: FakeEditorProps
  model: FakeModel | null
  focused: boolean
  rerender: () => void
  api: unknown
}

const fake = vi.hoisted(() => ({
  models: new Map<string, FakeModel>(),
  editors: [] as FakeEditorHandle[],
}))

vi.mock('@/monaco/setup', () => ({
  disposeModelsExcept: vi.fn(),
  modelPathFor: (p: string) => `file://${p}`,
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')

  // Stands in for every Monaco API the panel touches that these tests do not inspect.
  const anything: unknown = new Proxy(function () {}, {
    get: (_target, prop) => {
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

  const getOrCreateModel = (path: string, value: string): FakeModel => {
    let model = fake.models.get(path)
    if (!model) {
      model = { uri: { toString: () => path }, value, editors: new Set() }
      fake.models.set(path, model)
    }
    return model
  }
  const attach = (handle: FakeEditorHandle, model: FakeModel | null) => {
    handle.model?.editors.delete(handle)
    handle.model = model
    model?.editors.add(handle)
  }
  const disposeModel = (model: FakeModel) => {
    fake.models.delete(model.uri.toString())
    for (const editor of [...model.editors]) {
      attach(editor, null)
      editor.rerender()
    }
  }

  function Editor(props: FakeEditorProps) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0)
    const handleRef = React.useRef<FakeEditorHandle | null>(null)
    if (!handleRef.current) {
      const handle: FakeEditorHandle = { props, model: null, focused: false, rerender, api: null }
      handle.api = withFallback({
        getModel: () =>
          handle.model &&
          withFallback({
            uri: handle.model.uri,
            getValue: () => handle.model!.value,
            setValue: (v: string) => { handle.model!.value = v },
            getFullModelRange: () => ({}),
          }),
        executeEdits: (_source: string, edits: Array<{ text: string }>) => {
          if (handle.model) handle.model.value = edits[0].text
          return true
        },
        pushUndoStop: () => true,
        hasTextFocus: () => handle.focused,
        focus: () => { handle.focused = true },
        getAction: () => null,
      })
      handleRef.current = handle
    }
    const handle = handleRef.current
    handle.props = props
    // The library reads these once, at mount.
    const keepAtMount = React.useRef(props.keepCurrentModel)
    const firstValueRun = React.useRef(true)

    React.useEffect(() => {
      attach(handle, getOrCreateModel(props.path ?? '', props.value ?? ''))
      fake.editors.push(handle)
      rerender()
      try {
        handle.props.onMount?.(handle.api, anything)
      } catch {
        // The panel's provider registration is not under test.
      }
      return () => {
        const model = handle.model
        attach(handle, null)
        fake.editors.splice(fake.editors.indexOf(handle), 1)
        if (model && !keepAtMount.current) disposeModel(model)
      }
    }, [])

    React.useEffect(() => {
      if (handle.model && handle.model.uri.toString() !== props.path) {
        attach(handle, getOrCreateModel(props.path ?? '', props.value ?? ''))
        rerender()
      }
    }, [props.path])

    // Like the library, only a later value change is pushed into the model.
    React.useEffect(() => {
      if (firstValueRun.current) {
        firstValueRun.current = false
        return
      }
      if (handle.model && props.value !== undefined && handle.model.value !== props.value) {
        handle.model.value = props.value
        rerender()
      }
    }, [props.value])

    return React.createElement('div', {
      'data-testid': 'monaco',
      'data-path': props.path,
      'data-text': handle.model ? handle.model.value : '<no model>',
    })
  }

  function DiffEditor(props: { original?: string; modified?: string }) {
    return React.createElement('div', { 'data-testid': 'diff' }, `${props.original}|${props.modified}`)
  }

  return { default: Editor, Editor, DiffEditor }
})

// Not under test, and they need layout APIs jsdom lacks or a live Monaco.
vi.mock('@/components/TabBar', () => ({ default: () => null }))
vi.mock('@/components/GhostTextProvider', () => ({ default: () => null }))
vi.mock('@/components/EmmetProvider', () => ({ default: () => null }))

import EditorPanel from './EditorPanel'

const file = (path: string, content: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content,
  language: 'typescript',
  isModified: false,
  aiModified: false,
  ...overrides,
})

function openFiles(files: OpenFile[], activeFilePath = files[0]?.path ?? null) {
  useEditorStore.setState({ openFiles: files, activeFilePath, previewPath: null, pinnedTabs: [], tabHistory: [] })
}

interface ApiMock {
  writeFile: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
  saveFileDialog: ReturnType<typeof vi.fn>
}

let api: ApiMock

async function renderPanel() {
  await act(async () => {
    render(<EditorPanel />)
  })
}

async function dispatch(name: string) {
  await act(async () => {
    window.dispatchEvent(new Event(name))
  })
}

async function pressCtrlS() {
  await act(async () => {
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  })
}

function editorFor(path: string): FakeEditorHandle {
  const handle = fake.editors.find((e) => e.props.path === `file://${path}`)
  if (!handle) throw new Error(`no editor shows ${path}`)
  return handle
}

/** Type into one editor: every editor showing that model reports the change. */
async function typeInto(handle: FakeEditorHandle, text: string) {
  await act(async () => {
    handle.model!.value = text
    for (const editor of [...handle.model!.editors]) editor.props.onChange?.(text)
  })
}

const shownTexts = () => screen.getAllByTestId('monaco').map((el) => el.getAttribute('data-text'))

beforeEach(() => {
  fake.models.clear()
  fake.editors.length = 0
  localStorage.clear()
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  api = {
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn(),
    saveFileDialog: vi.fn().mockResolvedValue(null),
  }
  ;(window as unknown as { api: ApiMock }).api = api
  window.confirm = vi.fn(() => false)
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('split view (#45)', () => {
  it('keeps pane 1 showing the file when a split of the same file is closed', async () => {
    openFiles([file('/w/a.ts', 'A')])
    await renderPanel()
    await dispatch('orion:split-editor-right')
    expect(shownTexts()).toEqual(['A', 'A'])

    await act(async () => {
      fireEvent.click(screen.getByTitle('Close Split'))
    })

    expect(shownTexts()).toEqual(['A'])
  })

  it('keeps pane 2 showing the file when pane 1 switches to the JSON tree view', async () => {
    openFiles([file('/w/a.json', '{"a":1}', { language: 'json' })])
    await renderPanel()
    await dispatch('orion:split-editor-right')

    await act(async () => {
      fireEvent.click(screen.getByTitle('Toggle Tree View'))
    })

    expect(shownTexts()).toEqual(['{"a":1}'])
  })

  it('shows buffer changes made while no editor showed the file, instead of the kept stale text', async () => {
    openFiles([file('/w/a.json', '{"a":1}', { language: 'json' })])
    await renderPanel()
    await act(async () => {
      fireEvent.click(screen.getByTitle('Toggle Tree View'))
    })
    // e.g. an edit in the tree view, or Reload from disk while the editor is hidden
    await act(async () => {
      useEditorStore.getState().updateFileContent('/w/a.json', '{"a":2}')
    })
    await act(async () => {
      fireEvent.click(screen.getByTitle('Toggle Tree View'))
    })

    expect(shownTexts()).toEqual(['{"a":2}'])
  })

  it('catches pane 2 up the same way when it is opened again', async () => {
    openFiles([file('/w/a.ts', 'A'), file('/w/b.ts', 'B')])
    await renderPanel()
    await dispatch('orion:split-editor-right')
    await act(async () => {
      fireEvent.click(screen.getByTitle('Close Split'))
    })
    await act(async () => {
      useEditorStore.getState().updateFileContent('/w/b.ts', 'B reloaded')
    })
    await dispatch('orion:split-editor-right')

    expect(shownTexts()).toEqual(['A', 'B reloaded'])
  })
})

describe('saving from the split pane (#40)', () => {
  beforeEach(() => {
    openFiles([file('/w/a.ts', 'A'), file('/w/b.ts', 'B')])
  })

  it('auto-saves edits typed in pane 2', async () => {
    vi.useFakeTimers()
    await renderPanel()
    await dispatch('orion:split-editor-right')

    await typeInto(editorFor('/w/b.ts'), 'B edited')
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(api.writeFile).toHaveBeenCalledTimes(1)
    expect(api.writeFile).toHaveBeenCalledWith('/w/b.ts', 'B edited')
  })

  it('Ctrl+S in pane 2 saves the file shown in pane 2', async () => {
    await renderPanel()
    await dispatch('orion:split-editor-right')
    await typeInto(editorFor('/w/b.ts'), 'B edited')
    editorFor('/w/b.ts').focused = true

    await pressCtrlS()

    expect(api.writeFile).toHaveBeenCalledTimes(1)
    expect(api.writeFile).toHaveBeenCalledWith('/w/b.ts', 'B edited')
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Saved b.ts')
  })

  it('File > Save after clicking into pane 2 saves the file shown in pane 2', async () => {
    await renderPanel()
    await dispatch('orion:split-editor-right')
    await typeInto(editorFor('/w/b.ts'), 'B edited')
    await act(async () => {
      fireEvent.click(screen.getByText('Group 2'))
    })

    await dispatch('orion:save-file')

    expect(api.writeFile).toHaveBeenCalledTimes(1)
    expect(api.writeFile.mock.calls[0][0]).toBe('/w/b.ts')
  })

  it('still saves pane 1 when it has the focus', async () => {
    await renderPanel()
    await dispatch('orion:split-editor-right')
    await act(async () => {
      fireEvent.click(screen.getByText('Group 2'))
    })
    editorFor('/w/a.ts').focused = true

    await pressCtrlS()

    expect(api.writeFile).toHaveBeenCalledWith('/w/a.ts', 'A')
  })
})

describe('untitled buffers and Save As (#41)', () => {
  it('Ctrl+S on an untitled buffer asks where to save, writes there and moves the tab', async () => {
    openFiles([file('untitled-1', 'draft', { name: 'Untitled-1', language: 'plaintext', isModified: true })])
    api.saveFileDialog.mockResolvedValue({ filePath: '/w/notes.md', language: 'markdown' })
    await renderPanel()

    await pressCtrlS()

    expect(api.saveFileDialog).toHaveBeenCalledWith('Untitled-1')
    expect(api.writeFile).toHaveBeenCalledTimes(1)
    expect(api.writeFile).toHaveBeenCalledWith('/w/notes.md', 'draft')
    const state = useEditorStore.getState()
    expect(state.activeFilePath).toBe('/w/notes.md')
    expect(state.openFiles).toEqual([
      expect.objectContaining({ path: '/w/notes.md', name: 'notes.md', language: 'markdown', content: 'draft', isModified: false }),
    ])
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    openFiles([file('untitled-1', 'draft', { name: 'Untitled-1', isModified: true })])
    await renderPanel()

    await dispatch('orion:save-file')

    expect(api.saveFileDialog).toHaveBeenCalledTimes(1)
    expect(api.writeFile).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ path: 'untitled-1', isModified: true })
  })

  it('File > Save As writes a real file to the new path and leaves the old file alone', async () => {
    openFiles([file('/w/a.ts', 'A edited', { isModified: true })])
    api.saveFileDialog.mockResolvedValue({ filePath: '/w/copy.ts', language: 'typescript' })
    await renderPanel()

    await dispatch('orion:save-file-as')

    expect(api.saveFileDialog).toHaveBeenCalledWith('a.ts')
    expect(api.writeFile.mock.calls.map((c) => c[0])).toEqual(['/w/copy.ts'])
    expect(useEditorStore.getState().openFiles.map((f) => f.path)).toEqual(['/w/copy.ts'])
  })

  it('Save As onto the buffer\'s own file still asks before overwriting a version changed on disk', async () => {
    openFiles([file('/w/a.ts', 'mine', { isModified: true, hasExternalChange: true })])
    api.saveFileDialog.mockResolvedValue({ filePath: '/w/a.ts', language: 'typescript' })
    await renderPanel()

    await dispatch('orion:save-file-as')

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(api.writeFile).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ path: '/w/a.ts', isModified: true, hasExternalChange: true })
  })

  it('refuses a Save As target that is open in another tab', async () => {
    openFiles([file('untitled-1', 'draft', { name: 'Untitled-1', isModified: true }), file('/w/b.ts', 'B')])
    api.saveFileDialog.mockResolvedValue({ filePath: '/w/b.ts', language: 'typescript' })
    await renderPanel()

    await pressCtrlS()

    expect(api.writeFile).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles.map((f) => f.path)).toEqual(['untitled-1', '/w/b.ts'])
  })
})

describe('"changed on disk" Compare (#6)', () => {
  it('diffs the disk version against the buffer and keeps the overwrite guard', async () => {
    openFiles([file('/w/a.ts', 'mine', { isModified: true, hasExternalChange: true })])
    api.readFile.mockResolvedValue({ content: 'theirs', language: 'typescript' })
    await renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    })

    expect(api.readFile).toHaveBeenCalledWith('/w/a.ts')
    expect(screen.getByTestId('diff').textContent).toBe('theirs|mine')
    expect(useEditorStore.getState().openFiles[0].hasExternalChange).toBe(true)

    // Saving still asks before overwriting the disk version (declined here).
    await pressCtrlS()
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  it('does not label another file\'s buffer "On disk" when a file compare starts from that view', async () => {
    openFiles([file('/w/a.ts', 'mine', { isModified: true, hasExternalChange: true }), file('/w/b.ts', 'B')])
    api.readFile.mockResolvedValue({ content: 'theirs', language: 'typescript' })
    await renderPanel()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    })

    // jsdom has no scrollIntoView; the file picker calls it.
    Element.prototype.scrollIntoView = vi.fn()
    // Switch to b.ts and start "Compare Active File With...".
    await act(async () => {
      useEditorStore.setState({ activeFilePath: '/w/b.ts' })
    })
    await dispatch('orion:compare-files')

    // The original side is now b.ts's buffer, not a.ts's disk text.
    expect(screen.queryByText('On disk:')).toBeNull()
    expect(screen.getByTestId('diff').textContent).toBe('B|mine')
  })
})
