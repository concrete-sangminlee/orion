/**
 * Guards the renderer side of the IPC contract.
 *
 * The preload only exposes `window.api`. `window.electron` / `window.electronAPI`
 * are always undefined, so optional-chained calls through them silently do
 * nothing, and `(window as any).api` hides contract mismatches from the
 * compiler. Several shipped features were dead for exactly these reasons.
 *
 * This walks the real import graph from the app entry point (with esbuild, the
 * same resolver family Vite uses) and fails if any module the app can actually
 * load uses one of those escape hatches. Unreachable legacy modules are not
 * checked; wiring one into the app makes it subject to this test.
 */
import path from 'node:path'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import { build, type Metafile } from 'esbuild'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

let graph: Promise<Metafile> | null = null

function rendererGraph(): Promise<Metafile> {
  graph ??= buildRendererGraph()
  return graph
}

async function buildRendererGraph(): Promise<Metafile> {
  const result = await build({
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
  })
  return result.metafile
}

async function reachableRendererModules(): Promise<string[]> {
  const metafile = await rendererGraph()
  return Object.keys(metafile.inputs)
    .map((input) => path.resolve(ROOT, input))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(`${path.sep}node_modules${path.sep}`))
}

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bwindow\.electron\b(?!API)/, reason: 'window.electron is never exposed by the preload' },
  { pattern: /\bwindow\.electronAPI\b/, reason: 'window.electronAPI is never exposed by the preload' },
  { pattern: /\(\s*window\s+as\s+any\s*\)\s*\.\s*(api|electron|electronAPI)\b/, reason: 'any-cast bypasses the typed window.api contract' },
  { pattern: /\bipcRenderer\b/, reason: 'the renderer has no ipcRenderer (contextIsolation); use window.api' },
]

/**
 * Known gaps, each with the reason it is not fixed yet. Keep this list short;
 * an entry here is a feature that does not work in the shipped app.
 */
const KNOWN_GAPS: Record<string, string> = {}

describe('renderer IPC bridge usage', () => {
  it(
    'modules reachable from src/main.tsx only talk to the main process through typed window.api',
    async () => {
      const modules = await reachableRendererModules()
      // Sanity check: the graph really covers the app shell and its panels.
      expect(modules.some((file) => file.endsWith(path.join('src', 'App.tsx')))).toBe(true)
      expect(modules.some((file) => file.endsWith(path.join('panels', 'SourceControlPanel.tsx')))).toBe(true)

      const violations: string[] = []
      for (const file of modules) {
        if (KNOWN_GAPS[path.relative(ROOT, file).split(path.sep).join('/')]) continue
        const lines = fs.readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          const code = line.replace(/\/\/.*$/, '')
          for (const { pattern, reason } of FORBIDDEN) {
            if (pattern.test(code)) violations.push(`${path.relative(ROOT, file)}:${index + 1} — ${reason}`)
          }
        })
      }
      expect(violations).toEqual([])

      // A gap that is no longer reachable (or got fixed) must leave the list.
      const reachable = new Set(modules.map((file) => path.relative(ROOT, file).split(path.sep).join('/')))
      for (const gap of Object.keys(KNOWN_GAPS)) {
        const source = fs.readFileSync(path.join(ROOT, gap), 'utf8')
        const stillViolates = FORBIDDEN.some(({ pattern }) => source.split('\n').some((line) => pattern.test(line.replace(/\/\/.*$/, ''))))
        expect({ gap, reachable: reachable.has(gap), stillViolates }).toEqual({ gap, reachable: true, stillViolates: true })
      }
    },
    30_000,
  )

  it(
    'modules reachable from src/main.tsx import no Node built-ins (the renderer has no Node)',
    async () => {
      // Regression: src/utils/ipcResult.ts imported node:path. Unit tests run
      // in Node and passed, but the packaged renderer crashed at startup with
      // "require is not defined" and rendered nothing.
      const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
      const metafile = await rendererGraph()
      const offenders: string[] = []
      for (const [input, { imports }] of Object.entries(metafile.inputs)) {
        if (input.includes('node_modules')) continue
        for (const imported of imports) {
          if (builtins.has(imported.path)) offenders.push(`${input} imports ${imported.path}`)
        }
      }
      expect(offenders).toEqual([])
    },
    30_000,
  )
})
