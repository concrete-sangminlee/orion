#!/usr/bin/env node
/**
 * Desktop app smoke test: launches the *built* Electron app and checks that it
 * actually starts. Unit tests run in Node and cannot catch failures that only
 * exist in the real runtime; two such bugs shipped unnoticed:
 *
 *  - the ES-module main bundle used `__dirname`, so createWindow() threw and
 *    no window ever opened;
 *  - the renderer imported `node:path`, which crashed it at startup
 *    ("require is not defined") and left a blank window.
 *
 * Usage:  npm run build && npm run test:e2e
 * Linux without a display:  xvfb-run -a npm run test:e2e
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACTS = path.join(ROOT, 'e2e-artifacts')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const failures = []
const check = (condition, message) => {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    console.log(`  ✗ ${message}`)
    failures.push(message)
  }
}

for (const built of ['dist-electron/main.js', 'dist-electron/preload.js', 'dist/index.html']) {
  if (!fs.existsSync(path.join(ROOT, built))) {
    console.error(`Missing ${built} — run \`npm run build\` first.`)
    process.exit(1)
  }
}

const pageErrors = []
const mainLog = []
const env = { ...process.env }
delete env.VITE_DEV_SERVER_URL
delete env.NODE_OPTIONS
delete env.ELECTRON_RUN_AS_NODE

const app = await _electron.launch({
  executablePath: require('electron'),
  args: [ROOT, '--no-sandbox', '--disable-gpu'],
  env,
  timeout: 60_000,
})
app.process().stdout?.on('data', (chunk) => mainLog.push(String(chunk)))
app.process().stderr?.on('data', (chunk) => mainLog.push(String(chunk)))

let win
try {
  console.log('Electron smoke test')
  win = await app.firstWindow({ timeout: 30_000 })
  win.on('pageerror', (error) => pageErrors.push(error.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 30_000 })

  const state = await win.evaluate(() => ({
    url: location.href,
    api: typeof window.api,
    methods: window.api ? Object.keys(window.api).length : 0,
  }))
  check(state.url.startsWith('file:') && state.url.endsWith('/dist/index.html'), `window shows the bundled renderer (${state.url})`)
  check(state.api === 'object' && state.methods > 100, `preload exposes window.api (${state.methods} methods)`)
  check(true, 'React rendered into #root')

  const info = await win.evaluate(() => window.api.appGetInfo())
  check(info.version === pkg.version, `IPC round-trip app:get-info returns ${info.version}`)

  // Navigation guard: a file: URL must neither load in the window nor be
  // handed to the OS; an https link must go to shell.openExternal only.
  await app.evaluate(({ shell }) => {
    globalThis.__openedExternally = []
    shell.openExternal = async (url) => {
      globalThis.__openedExternally.push(url)
    }
  })
  await win.evaluate(() => {
    location.href = 'file:///etc/passwd'
  })
  await win.waitForTimeout(500)
  await win.evaluate(() => {
    location.href = 'https://example.com/docs'
  })
  await win.waitForTimeout(500)
  const opened = await app.evaluate(() => globalThis.__openedExternally)
  const urlAfter = await win.evaluate(() => location.href)
  check(urlAfter === state.url, 'window stayed on the app after navigation attempts')
  check(!opened.some((url) => url.startsWith('file:')), 'file: navigation was not handed to the OS')
  check(opened.includes('https://example.com/docs'), 'https navigation was routed to shell.openExternal')

  check(pageErrors.length === 0, `no uncaught renderer errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`)
  const mainErrors = mainLog.join('').split('\n').filter((line) => /Uncaught exception|Unhandled rejection/.test(line))
  check(mainErrors.length === 0, `no uncaught main-process errors${mainErrors.length ? `: ${mainErrors.join(' | ')}` : ''}`)
} catch (error) {
  failures.push(String(error?.message || error))
  console.log(`  ✗ ${error?.message || error}`)
} finally {
  if (failures.length && win) {
    fs.mkdirSync(ARTIFACTS, { recursive: true })
    await win.screenshot({ path: path.join(ARTIFACTS, 'electron-smoke.png') }).catch(() => {})
    fs.writeFileSync(path.join(ARTIFACTS, 'main-process.log'), mainLog.join(''))
  }
  await app.close().catch(() => {})
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
