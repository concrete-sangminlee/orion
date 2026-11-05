import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decideNavigation, isAppUrl, type AppOrigin } from './app-origin'

const rendererRoot = path.resolve('/opt/orion/resources/app.asar/dist')
const prod: AppOrigin = { rendererRoot }
const dev: AppOrigin = { rendererRoot, devServerUrl: 'http://localhost:5173/' }
const fileUrl = (p: string) => pathToFileURL(p).href

describe('isAppUrl (production, file://)', () => {
  it('accepts the bundled renderer and its assets, with hash or query', () => {
    expect(isAppUrl(fileUrl(path.join(rendererRoot, 'index.html')), prod)).toBe(true)
    expect(isAppUrl(fileUrl(path.join(rendererRoot, 'index.html')) + '#/settings?x=1', prod)).toBe(true)
    expect(isAppUrl(fileUrl(path.join(rendererRoot, 'assets', 'x.js')), prod)).toBe(true)
  })

  it('rejects other local files, including traversal and sibling-prefix paths', () => {
    expect(isAppUrl(fileUrl('/etc/passwd'), prod)).toBe(false)
    expect(isAppUrl(fileUrl(path.join(rendererRoot, '..', 'secrets.html')), prod)).toBe(false)
    expect(isAppUrl(fileUrl(rendererRoot + '-evil/index.html'), prod)).toBe(false)
    expect(isAppUrl('file:///opt/orion/resources/app.asar/dist/../../evil.html', prod)).toBe(false)
  })

  it('rejects UNC-style file URLs and every non-file scheme', () => {
    expect(isAppUrl('file://attacker-host/share/index.html', prod)).toBe(false)
    expect(isAppUrl('https://example.com/', prod)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', prod)).toBe(false)
    expect(isAppUrl('about:blank', prod)).toBe(false)
    expect(isAppUrl('', prod)).toBe(false)
    expect(isAppUrl(undefined, prod)).toBe(false)
    expect(isAppUrl('not a url', prod)).toBe(false)
  })
})

describe('isAppUrl (development, dev server)', () => {
  it('accepts exactly the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/src/App.tsx?import', dev)).toBe(true)
  })

  it('rejects look-alike origins that a startsWith check accepted', () => {
    expect(isAppUrl('http://localhost:5173.attacker.example/', dev)).toBe(false)
    expect(isAppUrl('http://localhost:51730/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
    expect(isAppUrl('http://user@localhost:5173@attacker.example/', dev)).toBe(false)
  })

  it('does not trust the production file:// renderer while a dev server is configured', () => {
    expect(isAppUrl(fileUrl(path.join(rendererRoot, 'index.html')), dev)).toBe(false)
  })
})

describe('decideNavigation', () => {
  it('keeps app navigation inside the window', () => {
    expect(decideNavigation(fileUrl(path.join(rendererRoot, 'index.html')), prod)).toBe('allow')
  })

  it('opens allowlisted links in the OS', () => {
    expect(decideNavigation('https://github.com/concrete-sangminlee/orion', prod)).toBe('open-external')
    expect(decideNavigation('mailto:team@example.com', prod)).toBe('open-external')
  })

  it.each([
    'file:///C:/Users/me/Downloads/invoice.pdf.exe',
    'file:///etc/passwd',
    'ms-cxh://setupmode',
    'vscode://file/etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://attacker/share',
    'https://example.com/a b',
  ])('drops %s instead of handing it to shell.openExternal', (url) => {
    expect(decideNavigation(url, prod)).toBe('deny')
  })
})
