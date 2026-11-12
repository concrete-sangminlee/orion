/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appShortcutCommand, ChordTracker, CHORD_TIMEOUT_MS, listenForChords } from './shortcuts'

type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
const press = (k: Key) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k })
const ctrl = (key: string, extra: Partial<Key> = {}) => press({ key, ctrlKey: true, ...extra })

describe('ChordTracker', () => {
  it('maps Ctrl+K chords to their commands', () => {
    const chords = new ChordTracker()
    const chord = (second: Key) => {
      expect(chords.handle(ctrl('k'))).toBeNull()
      return chords.handle(press(second))
    }
    expect(chord({ key: 's', ctrlKey: true })).toBe('preferences.keyboardShortcuts')
    expect(chord({ key: 's' })).toBe('file.saveAll')
    expect(chord({ key: 'z' })).toBe('view.toggleZenMode')
    expect(chord({ key: 'o', ctrlKey: true })).toBe('file.openFolder')
    // The editor's own chords (fold all, unfold all) are left to it.
    expect(chord({ key: '0', ctrlKey: true })).toBeNull()
    expect(chord({ key: 'j', ctrlKey: true })).toBeNull()
  })

  it('is not fooled by pressing Ctrl again for the second key', () => {
    const chords = new ChordTracker()
    chords.handle(ctrl('k'))
    expect(chords.handle(ctrl('Control'))).toBeNull()
    expect(chords.handle(ctrl('s'))).toBe('preferences.keyboardShortcuts')
  })

  it('starts with Cmd+K on macOS, leaving Ctrl+K (delete to end of line) and the letter typed next alone', () => {
    const chords = new ChordTracker(() => 0, true)
    chords.handle(ctrl('k'))
    expect(chords.handle(press({ key: 's' }))).toBeNull()
    chords.handle(press({ key: 'k', metaKey: true }))
    expect(chords.handle(press({ key: 's' }))).toBe('file.saveAll')
    chords.handle(press({ key: 'k', metaKey: true }))
    expect(chords.handle(press({ key: 's', metaKey: true }))).toBe('preferences.keyboardShortcuts')
  })

  it('needs the second key soon after Ctrl+K, and only once', () => {
    let now = 0
    const chords = new ChordTracker(() => now)
    chords.handle(ctrl('k'))
    now = CHORD_TIMEOUT_MS + 1
    expect(chords.handle(ctrl('s'))).toBeNull()
    // A plain Ctrl+S with no Ctrl+K before it is the editor's save.
    expect(chords.handle(ctrl('s'))).toBeNull()
  })
})

describe('listenForChords', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

  it("consumes the chord's second key before the editor's earlier Ctrl+S listener sees it", () => {
    // EditorPanel's save listener: on window, bubble phase, registered first.
    const editorSave = vi.fn()
    const onSave = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === 's') editorSave() }
    window.addEventListener('keydown', onSave)
    cleanups.push(() => window.removeEventListener('keydown', onSave))

    const run = vi.fn()
    cleanups.push(listenForChords(window, run))

    const keydown = (init: KeyboardEventInit) =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    keydown({ key: 'k', ctrlKey: true })
    const notCancelled = keydown({ key: 's', ctrlKey: true })

    expect(run).toHaveBeenCalledExactlyOnceWith('preferences.keyboardShortcuts')
    expect(notCancelled).toBe(false)
    expect(editorSave).not.toHaveBeenCalled()

    // Without the chord, Ctrl+S still reaches the editor.
    keydown({ key: 's', ctrlKey: true })
    expect(editorSave).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  /**
   * Monaco's keybinding service, as it handles keys on its container: Ctrl+K
   * starts one of its own chords (Ctrl+K Ctrl+C...), and the next key ends it,
   * swallowed when it completes no chord of Monaco's.
   */
  function fakeMonaco() {
    const container = document.createElement('div')
    container.className = 'monaco-editor'
    const textarea = document.createElement('textarea')
    container.appendChild(textarea)
    document.body.appendChild(container)
    cleanups.push(() => container.remove())
    let inChord = false
    container.addEventListener('keydown', (e) => {
      if (inChord || (e.ctrlKey && e.key === 'k')) {
        inChord = !inChord
        e.preventDefault()
        e.stopPropagation()
      }
    })
    const keydown = (init: KeyboardEventInit) =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    return { keydown, inChord: () => inChord }
  }

  it('lets Monaco see the second key so it ends its own Ctrl+K chord, and still keeps it from the window listeners', () => {
    const windowListener = vi.fn()
    window.addEventListener('keydown', windowListener)
    cleanups.push(() => window.removeEventListener('keydown', windowListener))
    const run = vi.fn()
    cleanups.push(listenForChords(window, run))
    const monaco = fakeMonaco()

    monaco.keydown({ key: 'k', ctrlKey: true })
    expect(monaco.inChord()).toBe(true)
    expect(monaco.keydown({ key: 'z' })).toBe(false)
    expect(run).toHaveBeenCalledExactlyOnceWith('view.toggleZenMode')
    // Otherwise the next letter typed in the editor would be swallowed.
    expect(monaco.inChord()).toBe(false)
    expect(monaco.keydown({ key: 'a' })).toBe(true)
    expect(windowListener).toHaveBeenCalledTimes(1)
  })

  it('leaves the terminal its Ctrl+K and the letter typed after it', () => {
    const run = vi.fn()
    cleanups.push(listenForChords(window, run))
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const textarea = document.createElement('textarea')
    terminal.appendChild(textarea)
    document.body.appendChild(terminal)
    cleanups.push(() => terminal.remove())
    const shell = vi.fn()
    textarea.addEventListener('keydown', (e) => shell(e.key))

    const keydown = (init: KeyboardEventInit) =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    keydown({ key: 'k', ctrlKey: true })
    expect(keydown({ key: 's' })).toBe(true)
    expect(shell.mock.calls).toEqual([['k'], ['s']])
    // A Ctrl+K pressed elsewhere is forgotten once the terminal has a key.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'k', ctrlKey: true }))
    keydown({ key: 'x' })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'z' }))
    expect(run).not.toHaveBeenCalled()
  })

  it('stops a second key Monaco lets through before the window listeners', () => {
    const editorSave = vi.fn()
    const onSave = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === 's') editorSave() }
    window.addEventListener('keydown', onSave)
    cleanups.push(() => window.removeEventListener('keydown', onSave))
    const run = vi.fn()
    cleanups.push(listenForChords(window, run))
    const textarea = document.createElement('textarea')
    const container = document.createElement('div')
    container.className = 'monaco-editor'
    container.appendChild(textarea)
    document.body.appendChild(container)
    cleanups.push(() => container.remove())

    // An editor whose own Ctrl+K is a single key, so it is in no chord.
    const keydown = (init: KeyboardEventInit) =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    keydown({ key: 'k', ctrlKey: true })
    expect(keydown({ key: 's', ctrlKey: true })).toBe(false)
    expect(run).toHaveBeenCalledExactlyOnceWith('preferences.keyboardShortcuts')
    expect(editorSave).not.toHaveBeenCalled()
  })
})

describe('appShortcutCommand', () => {
  it('maps the keys App owns', () => {
    expect(appShortcutCommand(ctrl('S', { shiftKey: true }))).toBe('file.saveAs')
    expect(appShortcutCommand(ctrl('w'))).toBe('file.closeEditor')
    expect(appShortcutCommand(ctrl('p'))).toBe('go.file')
    expect(appShortcutCommand(ctrl('P', { shiftKey: true }))).toBe('view.commandPalette')
    // Go to Symbol, as the menus label it.
    expect(appShortcutCommand(ctrl('O', { shiftKey: true }))).toBe('go.symbol')
    expect(appShortcutCommand(press({ key: 'w', metaKey: true }))).toBe('file.closeEditor')
  })

  it('leaves keys the editor owns alone', () => {
    expect(appShortcutCommand(ctrl('s'))).toBeNull()
    expect(appShortcutCommand(ctrl('f'))).toBeNull()
    expect(appShortcutCommand(ctrl('g'))).toBeNull()
    expect(appShortcutCommand(press({ key: 'w' }))).toBeNull()
    expect(appShortcutCommand(ctrl('w', { altKey: true }))).toBeNull()
  })
})

describe('shown shortcuts match what the keys do', () => {
  /** A displayed shortcut ("Ctrl+Shift+P", "Ctrl+K S") as the key presses it is made of. */
  const presses = (shortcut: string) =>
    shortcut.split(' ').map((chord) => {
      const parts = chord.split('+')
      const key = parts[parts.length - 1]
      const shift = parts.includes('Shift')
      return press({
        key: key.length === 1 ? (shift ? key.toUpperCase() : key.toLowerCase()) : key,
        ctrlKey: parts.includes('Ctrl'),
        shiftKey: shift,
        altKey: parts.includes('Alt'),
      })
    })

  it('a key App handles runs the command that shows it', async () => {
    const { listCommands } = await import('./registry')
    await import('./appCommands')
    const mismatches: string[] = []
    for (const command of listCommands()) {
      if (!command.keybinding) continue
      const keys = presses(command.keybinding)
      if (keys.length === 1) {
        const ran = appShortcutCommand(keys[0])
        if (ran && ran !== command.id) mismatches.push(`${command.keybinding}: shows ${command.id}, runs ${ran}`)
      } else {
        const chords = new ChordTracker()
        chords.handle(keys[0])
        const chordRan = chords.handle(keys[1])
        if (chordRan && chordRan !== command.id) mismatches.push(`${command.keybinding}: shows ${command.id}, runs ${chordRan}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
