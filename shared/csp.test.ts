import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, CONTENT_SECURITY_POLICY_DIRECTIVES as directives } from './csp'

describe('renderer Content-Security-Policy', () => {
  it('only runs scripts shipped in the app bundle', () => {
    expect(directives['script-src']).toEqual(["'self'"])
  })

  it.each(["'unsafe-eval'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https:', 'http:', '*'])(
    'never allows %s for scripts',
    (source) => {
      expect(directives['script-src']).not.toContain(source)
      expect(directives['default-src']).not.toContain(source)
    },
  )

  it('blocks plugins, <base> hijacking and form posts', () => {
    expect(directives['object-src']).toEqual(["'none'"])
    expect(directives['base-uri']).toEqual(["'none'"])
    expect(directives['form-action']).toEqual(["'none'"])
  })

  it('serialises to a single meta-safe header value', () => {
    const policy = buildContentSecurityPolicy()
    expect(policy).toContain("script-src 'self';")
    expect(policy).not.toMatch(/["<>\n]/)
  })
})
