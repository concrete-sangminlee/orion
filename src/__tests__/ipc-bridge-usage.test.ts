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
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

async function reachableRendererModules(): Promise<string[]> {
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
  return Object.keys(result.metafile.inputs)
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
const KNOWN_GAPS: Record<string, string> = {
  // Inline AI completion calls `api.omoComplete`, which no IPC channel backs,
  // so ghost text never appears. Wiring it means picking the model that runs
  // on every typing pause (a cost decision), so it is deliberately left open.
  'src/components/GhostTextProvider.tsx': 'omoComplete has no main-process implementation',
}

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
})
