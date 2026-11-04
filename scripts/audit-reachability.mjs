#!/usr/bin/env node
/**
 * Report renderer modules under src/ that the app can never load.
 *
 * Walks the import graph from src/main.tsx with esbuild (static and dynamic
 * `import()` with literal specifiers) and lists every non-test .ts/.tsx file
 * under src/ that is not in it. Unreachable modules still compile and are
 * still type-checked, so bugs fixed there do not reach users, and features
 * implemented only there do not exist in the shipped app.
 *
 * Usage: npm run audit:reachability [-- --json]
 * Exit code is always 0 — this is a report, not a gate.
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const asJson = process.argv.includes('--json')

const result = await build({
  entryPoints: [path.join(SRC, 'main.tsx')],
  bundle: true,
  write: false,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
  jsx: 'automatic',
  absWorkingDir: ROOT,
  alias: { '@': SRC, '@shared': path.join(ROOT, 'shared') },
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
})

const reachable = new Set(Object.keys(result.metafile.inputs).map((input) => path.resolve(ROOT, input)))

function listSources(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...listSources(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

const countLines = (file) => fs.readFileSync(file, 'utf8').split('\n').length
const all = listSources(SRC)
const unreachable = all
  .filter((file) => !reachable.has(file))
  .map((file) => ({ file: path.relative(ROOT, file).split(path.sep).join('/'), lines: countLines(file) }))
  .sort((a, b) => b.lines - a.lines)

const totalLines = all.reduce((sum, file) => sum + countLines(file), 0)
const unreachableLines = unreachable.reduce((sum, entry) => sum + entry.lines, 0)

if (asJson) {
  console.log(JSON.stringify({ files: all.length, unreachableFiles: unreachable.length, totalLines, unreachableLines, unreachable }, null, 2))
} else {
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0')
  console.log(`Renderer modules unreachable from src/main.tsx: ${unreachable.length} of ${all.length} files (${pct(unreachable.length, all.length)}%)`)
  console.log(`Lines in unreachable modules: ${unreachableLines} of ${totalLines} (${pct(unreachableLines, totalLines)}%)\n`)
  for (const { file, lines } of unreachable) console.log(`${String(lines).padStart(6)}  ${file}`)
}
