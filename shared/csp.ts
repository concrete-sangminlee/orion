/**
 * Content-Security-Policy for the packaged renderer.
 *
 * The renderer holds window.api (filesystem, git, terminal), so the policy's
 * main job is `script-src 'self'`: no remote scripts, no inline scripts, no
 * eval. Everything the app runs ships in its own bundle (Monaco included).
 * Network directives stay compatible with the features that need them:
 * workspace images via file:, the local Ollama endpoint, https for remote
 * images and the extension marketplace.
 *
 * Injected into dist/index.html at build time only; the Vite dev server needs
 * inline scripts for HMR.
 */
export const CONTENT_SECURITY_POLICY_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'file:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'file:'],
  'font-src': ["'self'", 'data:'],
  'worker-src': ["'self'", 'blob:'],
  'connect-src': ["'self'", 'file:', 'data:', 'blob:', 'http://localhost:*', 'http://127.0.0.1:*', 'https:'],
  'frame-src': ["'self'", 'blob:', 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
}

export function buildContentSecurityPolicy(directives = CONTENT_SECURITY_POLICY_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}
