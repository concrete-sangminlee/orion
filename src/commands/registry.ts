/**
 * The one list of user commands. The command palette, the title bar menus,
 * the native application menu (through its app:* events) and App's keyboard
 * shortcuts all run commands from here, so a command either works from every
 * one of them or is offered by none.
 */
import type { LucideIcon } from 'lucide-react'
import { useToastStore } from '@/store/toast'

export interface Command {
  /** Stable id, e.g. `file.save`. */
  id: string
  /** Palette group and menu prefix, e.g. `File`. */
  category: string
  title: string
  /** The shortcut that runs it, for display. Its handler lives where the key is handled. */
  keybinding?: string
  icon?: LucideIcon
  run: () => unknown
}

const commands = new Map<string, Command>()

/** Registering an id again replaces it (a hot-reloaded module re-registers its commands). */
export function registerCommands(list: readonly Command[]): void {
  for (const command of list) commands.set(command.id, command)
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id)
}

/** A command the caller names statically; a typo fails loudly instead of rendering a dead item. */
export function requireCommand(id: string): Command {
  const command = commands.get(id)
  if (!command) throw new Error(`Unknown command ${id}`)
  return command
}

export function listCommands(): Command[] {
  return [...commands.values()]
}

/**
 * Run a command. A failure is shown to the user rather than swallowed, so a
 * broken command is visible.
 */
export function runCommand(id: string): void {
  const command = commands.get(id)
  if (!command) {
    console.error(`[commands] Unknown command ${id}`)
    return
  }
  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    useToastStore.getState().addToast({ type: 'error', message: `${command.title} failed: ${message}` })
  }
  try {
    const result = command.run()
    if (result instanceof Promise) result.catch(fail)
  } catch (err) {
    fail(err)
  }
}
