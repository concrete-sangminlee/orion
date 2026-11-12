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
 * Packaged app:  ORION_E2E_APP=release/<version>/linux-unpacked/orion-ide npm run test:e2e
 *   (after `npx electron-builder --config electron-builder.yml --dir`), which also
 *   covers what only exists in a package: the asar layout and shipped native modules.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
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

// Set to a packaged executable to test the package instead of the build output.
const packagedApp = process.env.ORION_E2E_APP ? path.resolve(ROOT, process.env.ORION_E2E_APP) : null

for (const built of packagedApp ? [packagedApp] : ['dist-electron/main.js', 'dist-electron/preload.cjs', 'dist/index.html'].map((file) => path.join(ROOT, file))) {
  if (!fs.existsSync(built)) {
    console.error(`Missing ${built} — run \`npm run build\` first.`)
    process.exit(1)
  }
}

const pageErrors = []
const mainLog = []
// A stand-in for a local Ollama server, so inline completion can be checked
// without a model: it lists one code model and answers fill-in-the-middle
// requests with a fixed completion.
const ollamaRequests = []
const fakeOllama = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    ollamaRequests.push({ url: request.url, body: body ? JSON.parse(body) : null })
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/api/tags') response.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }))
    else if (request.url === '/api/generate') response.end(JSON.stringify({ response: '6 * 7' }))
    else {
      response.statusCode = 404
      response.end('{}')
    }
  })
})
await new Promise((resolve) => fakeOllama.listen(0, '127.0.0.1', resolve))

const env = { ...process.env, OLLAMA_HOST: `127.0.0.1:${fakeOllama.address().port}` }
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
  executablePath: packagedApp ?? require('electron'),
  args: [...(packagedApp ? [] : [ROOT]), '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  env,
  timeout: 60_000,
})
app.process().stdout?.on('data', (chunk) => mainLog.push(String(chunk)))
app.process().stderr?.on('data', (chunk) => mainLog.push(String(chunk)))

let win
try {
  console.log(`Electron smoke test${packagedApp ? ` (packaged: ${path.relative(ROOT, packagedApp)})` : ''}`)
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
  // Inline completion: typing asks the (fake) local model once after a pause,
  // Tab inserts the suggestion, and moving the caret asks for nothing.
  const completionFile = path.join(workspaceDir, 'answer.ts')
  fs.writeFileSync(completionFile, 'export const one = 1\n')
  await openFile(completionFile)
  await win.waitForFunction(() => window.monaco.editor.getEditors()[0].getValue().includes('one = 1'), null, { timeout: 15_000 })
  await typeAtEnd('export const answer = ')
  await win.waitForFunction(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('6 * 7'), null, { timeout: 10_000 }).catch(() => {})
  // Earlier typing in this test asked for completions too; count this line's.
  const generateRequests = ollamaRequests.filter(
    (request) => request.url === '/api/generate' && request.body.prompt.endsWith('export const answer = '),
  )
  check(generateRequests.length === 1, `typing a line requests one inline completion after a pause (${generateRequests.length} request(s))`)
  await win.keyboard.press('Tab')
  await win.waitForTimeout(300)
  check((await modelValue()).includes('export const answer = 6 * 7'), 'Tab accepts the inline suggestion')
  const requestsBeforeCaretMoves = ollamaRequests.length
  await win.keyboard.press('ArrowUp')
  await win.keyboard.press('ArrowDown')
  await win.waitForTimeout(1200)
  check(ollamaRequests.length === requestsBeforeCaretMoves, 'moving the caret requests no completion')

  // Integrated terminal: a real pty runs a command in the workspace.
  const terminal = await win.evaluate(async () => {
    let output = ''
    const unsubscribe = window.api.onTermData((id, data) => {
      if (id === 'e2e-term') output += data
    })
    const created = await window.api.termCreate('e2e-term')
    await new Promise((resolve) => setTimeout(resolve, 800))
    window.api.termWrite('e2e-term', 'echo orion-$((6*7))\r')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    unsubscribe()
    window.api.termKill('e2e-term')
    return { created, output }
  })
  check(terminal.created.success === true && terminal.output.includes('orion-42'), `integrated terminal runs commands${terminal.created.error ? ` (${terminal.created.error})` : ''}`)

  // File safety. "New File" used to truncate an existing file and a rename
  // replaced its target; both now fail and leave the file alone.
  const keepFile = path.join(workspaceDir, 'keep.md')
  fs.writeFileSync(keepFile, 'a week of work\n')
  await win.waitForFunction(() => document.body.innerText.includes('keep.md'), null, { timeout: 10_000 })
  await win.locator('[title="New File"]').first().click()
  await win.keyboard.type('keep.md')
  await win.keyboard.press('Enter')
  await win.waitForFunction(() => document.body.innerText.includes('already exists'), null, { timeout: 5_000 }).catch(() => {})
  check(
    fs.readFileSync(keepFile, 'utf8') === 'a week of work\n' && (await win.locator('text=already exists').count()) > 0,
    'New File with the name of an existing file reports it and leaves the file intact',
  )
  const renamedOnto = await win.evaluate(([from, to]) => window.api.renameFile(from, to), [sampleFile, keepFile])
  check(
    renamedOnto.success === false && fs.existsSync(sampleFile) && fs.readFileSync(keepFile, 'utf8') === 'a week of work\n',
    `renaming onto an existing file is refused (${renamedOnto.error})`,
  )

  // Encodings. A file is opened only if it can be saved back unchanged.
  const latin1File = path.join(workspaceDir, 'legacy-latin1.txt')
  const latin1Bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
  fs.writeFileSync(latin1File, latin1Bytes)
  await openFile(latin1File)
  await win.waitForFunction(() => document.body.innerText.includes('not UTF-8'), null, { timeout: 5_000 }).catch(() => {})
  const tabsAfterLatin1 = await win.evaluate(() => window.monaco.editor.getModels().map((model) => model.uri.path))
  check(
    (await win.locator('text=not UTF-8').count()) > 0 && !tabsAfterLatin1.some((uri) => uri.endsWith('legacy-latin1.txt')) && fs.readFileSync(latin1File).equals(latin1Bytes),
    'a file that is not UTF-8 is refused with a reason instead of opened as mangled text',
  )
  const utf16File = path.join(workspaceDir, 'wide.txt')
  fs.writeFileSync(utf16File, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo\n', 'utf16le')]))
  await openFile(utf16File)
  await win.waitForFunction(() => window.monaco.editor.getEditors()[0].getValue().includes('héllo'), null, { timeout: 15_000 })
  await typeAtEnd('wörld')
  await win.waitForTimeout(2000)
  const utf16Saved = fs.readFileSync(utf16File)
  check(
    utf16Saved[0] === 0xff && utf16Saved[1] === 0xfe && utf16Saved.subarray(2).toString('utf16le') === 'héllo\nwörld',
    'a UTF-16 file edited in the editor is saved back as UTF-16',
  )
  // 1x1 PNG: opens as an image preview, and no save can write over it.
  const pngFile = path.join(workspaceDir, 'pixel.png')
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  fs.writeFileSync(pngFile, pngBytes)
  await openFile(pngFile)
  await win.waitForFunction(() => [...document.images].some((image) => image.src.endsWith('/pixel.png') && image.naturalWidth === 1), null, { timeout: 10_000 }).catch(() => {})
  const pngShown = await win.evaluate(() => [...document.images].some((image) => image.src.endsWith('/pixel.png') && image.naturalWidth === 1))
  const pngWrite = await win.evaluate((file) => window.api.writeFile(file, ''), pngFile)
  check(pngShown && pngWrite.success === false && fs.readFileSync(pngFile).equals(pngBytes), `an image opens as a preview and cannot be overwritten (${pngWrite.error})`)

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
  fakeOllama.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(workspaceDir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
