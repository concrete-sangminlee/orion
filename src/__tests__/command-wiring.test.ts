/**
 * Every command a user can trigger must do something.
 *
 * - An orion:* window event that a module the app can load dispatches, but no
 *   such module listens for, is a menu item, palette entry or button that does
 *   nothing. (About 120 of them did.)
 * - An app:* event the native application menu emits that the renderer does
 *   not subscribe to is a native menu item (and, on macOS, its accelerator:
 *   Cmd+S, Cmd+P, Cmd+F...) that does nothing.
 *
 * The modules the app can load are those reachable from src/main.tsx, found
 * with esbuild as in ipc-bridge-usage.test.ts.
 */
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { IPC_EVENT_CHANNELS } from '@shared/ipc-channels'
import { createElectronApi, type IpcRendererLike } from '../../electron/preload-api'

const ROOT = path.resolve(__dirname, '../..')

/**
 * Dispatched events nothing listens for, each with the reason it is
 * acceptable. Keep this short: most entries are a feature that does not work.
 */
const UNHANDLED_ALLOWLIST: Record<string, string> = {
  'orion:notification': 'Change notice from the toast store; the notification center reads the store.',
  'orion:setting-changed': 'Change notice from the settings store (its only listener, SettingsEditor, is not in the app); readers use the store.',
  'orion:workspace-changed': 'Change notice from the workspace store; readers use the store.',
  'orion:root-added': 'Change notice from the workspace store; readers use the store.',
  'orion:root-removed': 'Change notice from the workspace store; readers use the store.',
  'orion:token-colors-changed': 'Sent only by the theme store\'s setTokenColorOverrides(), which nothing in the app calls.',
  'orion:icon-theme-changed': 'Sent only by the theme store\'s setIconTheme(), which nothing in the app calls.',
}

/** orion:* strings that are not window events (storage keys and the like). */
const NOT_EVENTS: Record<string, string> = {
  'orion:activity-bar-order': 'localStorage key (ActivityBar)',
  'orion:activity-bar-hidden': 'localStorage key (ActivityBar)',
}

let graph: Promise<string[]> | null = null

function reachableModules(): Promise<string[]> {
  graph ??= build({
    entryPoints: [path.join(ROOT, 'src/main.tsx')],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    jsx: 'automatic',
    absWorkingDir: ROOT,
    alias: { '@': path.join(ROOT, 'src'), '@shared': path.join(ROOT, 'shared') },
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
  }).then(({ metafile }) =>
    Object.keys(metafile.inputs)
      .filter((input) => /\.(ts|tsx)$/.test(input) && !input.includes('node_modules'))
      .map((input) => path.resolve(ROOT, input)),
  )
  return graph
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

const EVENT_NAME = /^orion:[a-z0-9-]+$/

/** `dispatch('orion:x')`, `emit(...)`, `dispatchWorkspaceEvent(...)`: helpers that dispatch their first argument. */
function isDispatchHelper(callee: ts.Expression): boolean {
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  return /dispatch|^emit$/i.test(name) && name !== 'addEventListener'
}

type Use = 'dispatch' | 'listen' | 'other'

/** How an expression holding an event name is used where it appears. */
function useOf(expr: ts.Node): Use | 'unknown' {
  const parent = expr.parent
  if (ts.isNewExpression(parent) && parent.arguments?.[0] === expr && /^(Custom)?Event$/.test(parent.expression.getText())) {
    return 'dispatch'
  }
  if (ts.isCallExpression(parent) && parent.arguments[0] === expr) {
    if (ts.isPropertyAccessExpression(parent.expression)) {
      const method = parent.expression.name.text
      if (method === 'addEventListener') return 'listen'
      if (method === 'removeEventListener') return 'other'
    }
    if (isDispatchHelper(parent.expression)) return 'dispatch'
  }
  return 'unknown'
}

/** Uses of `expr`, following it through `const x = expr` to the uses of `x`. */
function usesThrough(expr: ts.Node, source: ts.SourceFile): Use[] {
  const direct = useOf(expr)
  if (direct !== 'unknown') return [direct]
  const parent = expr.parent
  if (!ts.isVariableDeclaration(parent) || parent.initializer !== expr || !ts.isIdentifier(parent.name)) return []
  const name = parent.name
  const uses: Use[] = []
  walk(source, (ref) => {
    if (ts.isIdentifier(ref) && ref.text === name.text && ref !== name) {
      const use = useOf(ref)
      if (use !== 'unknown') uses.push(use)
    }
  })
  return uses
}

interface Census {
  dispatched: Map<string, string[]>
  listened: Set<string>
  notEvents: Set<string>
  unclassified: string[]
}

function census(files: string[]): Census {
  const result: Census = { dispatched: new Map(), listened: new Set(), notEvents: new Set(), unclassified: [] }
  const record = (use: Use, name: string, where: string) => {
    if (use === 'listen') result.listened.add(name)
    else if (use === 'dispatch') result.dispatched.set(name, [...(result.dispatched.get(name) ?? []), where])
  }

  for (const file of files) {
    const source = parse(file)
    const text = source.getFullText()
    const rel = path.relative(ROOT, file)
    walk(source, (node) => {
      if (!ts.isStringLiteralLike(node) || !EVENT_NAME.test(node.text)) return
      const name = node.text
      const where = `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      const parent = node.parent

      const direct = useOf(node)
      if (direct !== 'unknown') return record(direct, name, where)

      // `const handlers = { 'orion:x': () => ... }` registered in a loop.
      if (ts.isPropertyAssignment(parent) && parent.name === node) {
        const declaration = parent.parent.parent
        if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
          const map = declaration.name.text
          const registered = new RegExp(`Object\\.(entries|keys)\\(${map}\\)`).test(text) && /addEventListener\(\s*[a-zA-Z]/.test(text)
          if (registered) return record('listen', name, where)
        }
      }

      // `const NAME = 'orion:x'`, then used by name.
      if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
        const uses = usesThrough(node, source)
        if (uses.includes('dispatch') || uses.includes('listen')) {
          for (const use of new Set(uses)) record(use, name, where)
          return
        }
        if (NOT_EVENTS[name]) return void result.notEvents.add(name)
      }

      // `const EVENTS = { editor: 'orion:x' }`, dispatched as `EVENTS[group]`.
      if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
        const declaration = parent.parent.parent
        if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
          const map = declaration.name.text
          const uses: Use[] = []
          walk(source, (ref) => {
            if (ts.isElementAccessExpression(ref) && ref.expression.getText() === map) uses.push(...usesThrough(ref, source))
          })
          if (uses.includes('dispatch') || uses.includes('listen')) {
            for (const use of new Set(uses)) record(use, name, where)
            return
          }
        }
      }

      result.unclassified.push(`${where} ${name}`)
    })

    // `new CustomEvent('orion:split-editor-' + side)`: the name is not known here.
    walk(source, (node) => {
      if (!ts.isNewExpression(node) || !/^(Custom)?Event$/.test(node.expression.getText())) return
      const arg = node.arguments?.[0]
      if (arg && (ts.isBinaryExpression(arg) || ts.isTemplateExpression(arg)) && arg.getText().includes('orion:')) {
        result.unclassified.push(`${rel}:${source.getLineAndCharacterOfPosition(arg.getStart()).line + 1} dynamic ${arg.getText()}`)
      }
    })
  }
  return result
}

/** app:* channels a call `emit(win, 'app:x', ...)` sends inside `node`. */
function emittedAppEvents(node: ts.Node): string[] {
  const channels: string[] = []
  walk(node, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 'emit') {
      const channel = n.arguments[1]
      if (channel && ts.isStringLiteralLike(channel) && channel.text.startsWith('app:')) channels.push(channel.text)
    }
  })
  return channels
}

function buildAppMenuEvents(): string[] {
  const source = parse(path.join(ROOT, 'electron/main.ts'))
  let menu: ts.FunctionDeclaration | undefined
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'buildAppMenu') menu = node
  })
  expect(menu, 'electron/main.ts declares buildAppMenu()').toBeDefined()
  return [...new Set(emittedAppEvents(menu!))].sort()
}

/** The channel each window.api.onApp* method subscribes to. */
function channelsOfSubscribers(methodNames: Iterable<string>): Set<string> {
  let subscribed = ''
  const ipc: IpcRendererLike = {
    invoke: async () => undefined,
    send: () => {},
    on: (channel) => { subscribed = channel },
    removeListener: () => {},
  }
  const api = createElectronApi(ipc) as unknown as Record<string, (callback: () => void) => unknown>
  const channels = new Set<string>()
  for (const name of methodNames) {
    subscribed = ''
    api[name]?.(() => {})
    if (subscribed) channels.add(subscribed)
  }
  return channels
}

describe('command wiring', () => {
  it(
    'every orion:* event a reachable module dispatches has a reachable listener',
    async () => {
      const modules = await reachableModules()
      expect(modules.some((file) => file.endsWith(path.join('src', 'App.tsx')))).toBe(true)
      const { dispatched, listened, notEvents, unclassified } = census(modules)

      // Sanity: the census sees the app's own wiring.
      expect(listened.has('orion:save-file')).toBe(true)
      expect(dispatched.has('orion:save-file')).toBe(true)

      // A use of an event name the census cannot classify would hide a dead command.
      expect(unclassified).toEqual([])

      const unhandled = [...dispatched.keys()]
        .filter((name) => !listened.has(name) && !UNHANDLED_ALLOWLIST[name])
        .sort()
        .map((name) => `${name} (dispatched at ${dispatched.get(name)!.join(', ')})`)
      expect(unhandled).toEqual([])

      // An allowlist entry that is handled now, or no longer dispatched, must go.
      const stale = Object.keys(UNHANDLED_ALLOWLIST).filter((name) => !dispatched.has(name) || listened.has(name))
      expect(stale).toEqual([])
      expect(Object.keys(NOT_EVENTS).filter((name) => !notEvents.has(name))).toEqual([])
    },
    60_000,
  )

  it(
    'the renderer subscribes to every app:* event the native menu emits',
    async () => {
      const menuEvents = buildAppMenuEvents()
      expect(menuEvents).toContain('app:save')

      const subscribers = new Set<string>()
      for (const file of await reachableModules()) {
        walk(parse(file), (node) => {
          if (ts.isPropertyAccessExpression(node) && /^onApp[A-Z]\w*$/.test(node.name.text)) subscribers.add(node.name.text)
        })
      }
      const subscribed = channelsOfSubscribers(subscribers)
      expect(menuEvents.filter((channel) => !subscribed.has(channel))).toEqual([])
    },
    60_000,
  )

  it('every app:* event channel in the contract is still emitted by the main process', () => {
    const electronFiles = fs
      .readdirSync(path.join(ROOT, 'electron'), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file))
      .map((file) => path.join(ROOT, 'electron', file))
    const emitted = new Set(electronFiles.flatMap((file) => emittedAppEvents(parse(file))))
    const contractAppEvents = IPC_EVENT_CHANNELS.filter((channel) => channel.startsWith('app:'))
    expect(contractAppEvents.filter((channel) => !emitted.has(channel))).toEqual([])
  })
})
