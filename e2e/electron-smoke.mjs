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
import os from 'node:os'
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

for (const built of ['dist-electron/main.js', 'dist-electron/preload.cjs', 'dist/index.html']) {
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

// Isolated profile: the test writes settings and an API key file.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-e2e-'))
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-e2e-ws-'))
const sampleFile = path.join(workspaceDir, 'greeting.ts')
fs.writeFileSync(sampleFile, 'export const greeting: string = "hello from orion"\n')
const secondFile = path.join(workspaceDir, 'farewell.ts')
fs.writeFileSync(secondFile, 'export const farewell = "bye"\n')

const app = await _electron.launch({
  executablePath: require('electron'),
  args: [ROOT, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
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
  // Everything the renderer runs must come from the app bundle. Only the
  // local Ollama endpoint may be contacted over the network.
  const remoteRequests = []
  win.on('request', (request) => {
    const url = request.url()
    if (/^https?:/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) remoteRequests.push(url)
  })
  // Content-Security-Policy violations are reported on the console.
  const cspViolations = []
  win.on('console', (message) => {
    const text = message.text()
    if (/Content Security Policy|Refused to (load|execute|apply|connect|create|evaluate)/i.test(text)) cspViolations.push(text.slice(0, 200))
  })
  // Reload so the listeners above also see the initial page load.
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 30_000 })

  const state = await win.evaluate(() => ({
    url: location.href,
    api: typeof window.api,
    methods: window.api ? Object.keys(window.api).length : 0,
  }))
  check(state.url.startsWith('file:') && state.url.endsWith('/dist/index.html'), `window shows the bundled renderer (${state.url})`)
  const csp = await win.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '')
  check(/script-src 'self'(;|$)/.test(csp) && !csp.includes('unsafe-eval'), "Content-Security-Policy forbids remote, inline and eval'd scripts")
  const webPreferences = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return { sandbox: prefs?.sandbox, contextIsolation: prefs?.contextIsolation, nodeIntegration: prefs?.nodeIntegration }
  })
  check(
    webPreferences.sandbox === true && webPreferences.contextIsolation === true && webPreferences.nodeIntegration === false,
    `renderer is sandboxed and context-isolated (${JSON.stringify(webPreferences)})`,
  )
  check(state.api === 'object' && state.methods > 100, `preload exposes window.api (${state.methods} methods)`)
  check(true, 'React rendered into #root')

  const info = await win.evaluate(() => window.api.appGetInfo())
  check(info.version === pkg.version, `IPC round-trip app:get-info returns ${info.version}`)

  // Editor: open a workspace file the way the OS/menu does and wait for Monaco.
  // Open the folder the way the File menu does, so the workspace watcher runs.
  await app.evaluate(({ BrowserWindow }, dir) => {
    BrowserWindow.getAllWindows()[0].webContents.send('app:open-folder', dir)
  }, workspaceDir)
  await win.waitForFunction(() => document.body.innerText.includes('greeting.ts'), null, { timeout: 15_000 })
  const openFile = (filePath) =>
    app.evaluate(({ BrowserWindow }, file) => {
      BrowserWindow.getAllWindows()[0].webContents.send('app:open-file', file)
    }, filePath)
  // Monaco renders spaces as U+00A0.
  const editorText = async () =>
    (await win.locator('.monaco-editor .view-lines').first().innerText()).replace(/\u00a0/g, ' ')
  await openFile(sampleFile)
  await win.waitForSelector('.monaco-editor .view-lines', { timeout: 30_000 })
  await win.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('hello'), null, { timeout: 15_000 })
  check((await editorText()).includes('hello from orion'), 'opening a file shows it in the Monaco editor')

  // Undo must stay inside the file: with one shared model, Ctrl+Z after
  // switching tabs restored the previous file's text into the current one.
  await openFile(secondFile)
  await win.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('farewell'), null, { timeout: 15_000 })
  await win.locator('.monaco-editor .view-lines').first().click()
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(500)
  // Read the model, not the DOM: view-lines can be mid-render right after a key press.
  const afterUndo = await win.evaluate(() => window.monaco?.editor.getEditors().map((editor) => editor.getValue()).join('\n') ?? '')
  check(afterUndo.includes('farewell') && !afterUndo.includes('hello from orion'), 'undo after switching files does not bring back the other file')

  // Saving and external changes (farewell.ts is the active editor).
  const dialogs = []
  win.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  const modelValue = () => win.evaluate(() => window.monaco.editor.getEditors()[0].getValue())
  const typeAtEnd = async (text) => {
    await win.locator('.monaco-editor .view-lines').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type(text)
  }
  const disk = () => fs.readFileSync(secondFile, 'utf8')

  await typeAtEnd('// typed\n')
  await win.waitForTimeout(2000)
  check(disk().includes('// typed'), 'auto-save writes edits to disk')

  // An external change right after our own save must still reach the editor.
  fs.writeFileSync(secondFile, 'export const farewell = "changed outside"\n')
  await win.waitForFunction(() => window.monaco.editor.getEditors()[0].getValue().includes('changed outside'), null, { timeout: 10_000 }).catch(() => {})
  check((await modelValue()).includes('changed outside'), 'an external change shortly after a save reloads the clean editor')

  // With unsaved edits, an external change must not be overwritten.
  await typeAtEnd('// unsaved\n')
  fs.writeFileSync(secondFile, 'export const farewell = "edited elsewhere"\n')
  await win.waitForTimeout(2500)
  check(disk().includes('edited elsewhere'), 'auto-save does not overwrite a file that changed on disk')
  check((await win.locator('text=changed on disk').count()) > 0, 'the editor flags the conflict')
  await win.keyboard.press('Control+s')
  await win.waitForTimeout(800)
  check(dialogs.length > 0 && disk().includes('edited elsewhere'), 'Ctrl+S asks before overwriting it (declined here)')
  const workerUrls = win.workers().map((worker) => worker.url())
  check(workerUrls.length > 0 && workerUrls.every((url) => url.startsWith('file:')), `Monaco workers come from the bundle (${workerUrls.length})`)

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

  // API keys: stored encrypted by the main process, never readable back.
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  check(path.resolve(userData) === path.resolve(userDataDir), `isolated user data directory (${userData})`)
  const secret = 'sk-ant-api03-E2E-SMOKE-not-a-real-key'
  const saved = await win.evaluate((key) => window.api.omoSetApiKeys({ anthropic: key }), secret)
  check(saved.success && saved.configured?.anthropic === true, 'omo:set-api-keys stores a key and reports it configured')
  const status = await win.evaluate(() => window.api.omoGetApiKeyStatus())
  check(status.configured.anthropic === true && !JSON.stringify(status).includes(secret), 'omo:get-api-key-status reports configured without returning the key')
  const keyFile = path.join(userData, 'api-keys.json')
  if (saved.persisted) {
    const onDisk = fs.readFileSync(keyFile, 'utf8')
    check(!onDisk.includes(secret), 'api-keys.json does not contain the plaintext key')
  } else {
    check(!fs.existsSync(keyFile), 'without OS encryption no key file is written')
  }
  const removed = await win.evaluate(() => window.api.omoSetApiKeys({ anthropic: null }))
  check(removed.success && removed.configured?.anthropic === false, 'a key can be removed')

  check(cspViolations.length === 0, `no Content-Security-Policy violations${cspViolations.length ? `: ${cspViolations.slice(0, 3).join(' | ')}` : ''}`)
  check(remoteRequests.length === 0, `renderer loaded nothing from the network${remoteRequests.length ? `: ${[...new Set(remoteRequests)].slice(0, 3).join(', ')}` : ''}`)
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
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(workspaceDir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
