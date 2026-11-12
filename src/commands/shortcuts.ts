/**
 * The keys App handles itself, as command ids. Each has exactly one owner:
 * keys the editor panel or Monaco handle (Ctrl+S, Ctrl+F, Ctrl+G...) are not
 * listed here.
 */
type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

const CTRL_SHIFT: Record<string, string> = {
  S: 'file.saveAs',
  P: 'view.commandPalette',
  E: 'view.explorer',
  F: 'view.search',
  G: 'view.sourceControl',
  O: 'go.symbol',
}

const CTRL: Record<string, string> = {
  n: 'file.newFile',
  w: 'file.closeEditor',
  p: 'go.file',
  b: 'view.toggleSidebar',
  '`': 'view.toggleTerminal',
  j: 'view.togglePanel',
  l: 'view.showChat',
  ',': 'preferences.settings',
}

/** The command for a single key press (not part of a Ctrl+K chord), or null. */
export function appShortcutCommand(e: KeyPress): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  return (e.shiftKey ? CTRL_SHIFT[e.key] : CTRL[e.key]) ?? null
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt'])

/** How long after Ctrl+K the second key of a chord counts. */
export const CHORD_TIMEOUT_MS = 1000

/**
 * Ctrl+K chords. Feed it every keydown, before anything else sees the key:
 * when it returns a command, the key is the chord's and nothing else may act
 * on it (Ctrl+K Ctrl+S used to open the shortcuts and also save, because the
 * editor's own Ctrl+S listener ran first).
 */
export class ChordTracker {
  private pendingSince: number | null = null

  constructor(
    private readonly now: () => number = () => Date.now(),
    // Cmd+K on macOS, where Ctrl+K deletes to the end of the line in the
    // editor and in text fields, and the next letter typed must not be taken.
    private readonly mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform),
  ) {}

  /** Forget a pending Ctrl+K. */
  reset(): void {
    this.pendingSince = null
  }

  handle(e: KeyPress): string | null {
    const ctrl = this.mac ? e.metaKey : e.ctrlKey
    const key = e.key.toLowerCase()
    if (ctrl && !e.shiftKey && !e.altKey && key === 'k') {
      this.pendingSince = this.now()
      return null
    }
    // Pressing Ctrl again for the second key is not the second key.
    if (this.pendingSince === null || MODIFIER_KEYS.has(e.key)) return null
    const inTime = this.now() - this.pendingSince <= CHORD_TIMEOUT_MS
    this.pendingSince = null
    if (!inTime || e.shiftKey || e.altKey) return null
    if (key === 's') return ctrl ? 'preferences.keyboardShortcuts' : 'file.saveAll'
    if (key === 'o' && ctrl) return 'file.openFolder'
    if (key === 'z') return 'view.toggleZenMode'
    // Any other second key (Ctrl+K Ctrl+0 fold all, ...) belongs to the editor.
    return null
  }
}

/**
 * Run Ctrl+K chords from `target`'s keydowns, in the capture phase so the
 * chord's second key is consumed before the editor's own key listeners
 * (registered earlier, in the bubble phase) see it.
 */
export function listenForChords(target: Window, run: (commandId: string) => void, chords = new ChordTracker()): () => void {
  // Second keys pressed in a Monaco editor. Monaco took the Ctrl+K as the
  // start of one of its own chords; it must see the second key to end that
  // chord, or it swallows the next key typed (for up to 5 s). They are
  // stopped once past the editor, on the document, before window listeners.
  const passingThroughEditor = new WeakSet<Event>()
  const onKeyDown = (e: KeyboardEvent) => {
    // The terminal sends Ctrl+K (kill line) to the shell; the letter typed
    // next is the shell's too.
    if (e.target instanceof Element && e.target.closest('.xterm')) return chords.reset()
    const command = chords.handle(e)
    if (!command) return
    e.preventDefault()
    if (e.target instanceof Element && e.target.closest('.monaco-editor')) passingThroughEditor.add(e)
    else e.stopPropagation()
    run(command)
  }
  const stopPastEditor = (e: Event) => {
    if (passingThroughEditor.has(e)) e.stopPropagation()
  }
  target.addEventListener('keydown', onKeyDown, true)
  target.document.addEventListener('keydown', stopPastEditor)
  return () => {
    target.removeEventListener('keydown', onKeyDown, true)
    target.document.removeEventListener('keydown', stopPastEditor)
  }
}
