import { useEffect } from 'react'
import { runEditorActionAtSymbol } from './editor'
import { subscribeNativeMenu } from './nativeMenu'

/**
 * The Outline panel's Peek References and Rename Symbol: Monaco's own
 * actions, run at the symbol on the active editor.
 */
export function listenForSymbolRequests(): () => void {
  const at = (actionId: string, title: string) => (event: Event) => {
    const detail = (event as CustomEvent<{ name?: unknown; line?: unknown } | undefined>).detail
    if (typeof detail?.name !== 'string' || typeof detail.line !== 'number') return
    void runEditorActionAtSymbol(actionId, title, detail.name, detail.line)
  }
  const peek = at('editor.action.referenceSearch.trigger', 'Peek References')
  const rename = at('editor.action.rename', 'Rename Symbol')
  window.addEventListener('orion:peek-references', peek)
  window.addEventListener('orion:rename-symbol', rename)
  return () => {
    window.removeEventListener('orion:peek-references', peek)
    window.removeEventListener('orion:rename-symbol', rename)
  }
}

/** Mount once, in App: the native menu's app:* events and the events above run commands. */
export function useCommandBridges(): void {
  useEffect(() => {
    const stopMenu = subscribeNativeMenu(window.api)
    const stopSymbols = listenForSymbolRequests()
    return () => {
      stopMenu()
      stopSymbols()
    }
  }, [])
}
