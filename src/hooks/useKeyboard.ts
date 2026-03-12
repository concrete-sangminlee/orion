/**
 * Global keyboard shortcut handler hook.
 * Manages keyboard events and dispatches to registered handlers.
 */

import { useEffect, useCallback, useRef } from 'react'

type KeyHandler = (e: KeyboardEvent) => void | boolean

interface ShortcutDef {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  when?: () => boolean
  handler: KeyHandler
  preventDefault?: boolean
}

const registeredShortcuts: ShortcutDef[] = []

/** Register a keyboard shortcut. Returns a cleanup function. */
export function registerShortcut(def: ShortcutDef): () => void {
  registeredShortcuts.push(def)
  return () => {
    const idx = registeredShortcuts.indexOf(def)
    if (idx >= 0) registeredShortcuts.splice(idx, 1)
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace('escape', 'escape').replace('enter', 'enter')
}

function matchesShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  const key = normalizeKey(e.key)
  const defKey = normalizeKey(def.key)

  if (key !== defKey) return false
  if (!!def.ctrl !== (e.ctrlKey || e.metaKey)) return false
  if (!!def.shift !== e.shiftKey) return false
  if (!!def.alt !== e.altKey) return false
  if (def.when && !def.when()) return false

  return true
}

/** Parse a shortcut string like "Ctrl+Shift+P" into a ShortcutDef */
export function parseShortcut(shortcut: string, handler: KeyHandler, when?: () => boolean): ShortcutDef {
  const parts = shortcut.split('+').map(p => p.trim().toLowerCase())
  return {
    key: parts[parts.length - 1],
    ctrl: parts.includes('ctrl') || parts.includes('cmd'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta'),
    handler,
    when,
    preventDefault: true,
  }
}

/** React hook: register keyboard shortcuts for a component's lifetime */
export function useKeyboardShortcuts(shortcuts: Array<{ shortcut: string; handler: KeyHandler; when?: () => boolean }>) {
  useEffect(() => {
    const cleanups: (() => void)[] = []
    for (const { shortcut, handler, when } of shortcuts) {
      if (!shortcut) continue
      // Handle chord shortcuts (e.g., "Ctrl+K Ctrl+C")
      if (shortcut.includes(' ')) {
        // Chord not supported in this simple implementation
        continue
      }
      cleanups.push(registerShortcut(parseShortcut(shortcut, handler, when)))
    }
    return () => cleanups.forEach(c => c())
  }, [shortcuts])
}

/** Global keyboard event listener — call once at app root */
export function useGlobalKeyboardHandler() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs (unless it's a global shortcut with Ctrl)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey

      if (isInput && !hasModifier) return

      for (const def of registeredShortcuts) {
        if (matchesShortcut(e, def)) {
          if (def.preventDefault !== false) {
            e.preventDefault()
            e.stopPropagation()
          }
          const result = def.handler(e)
          if (result !== false) return // First match wins
        }
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])
}

/** Hook: detect if a specific key combination is currently pressed */
export function useKeyPress(targetKey: string): boolean {
  const pressedRef = useRef(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === targetKey.toLowerCase()) pressedRef.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === targetKey.toLowerCase()) pressedRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [targetKey])

  return pressedRef.current
}

/** Hook: detect when user presses Escape */
export function useEscapeKey(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [handler, enabled])
}

/** Hook: detect clicks outside a ref element */
export function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler()
      }
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler, enabled])
}
