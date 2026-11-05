/**
 * Decides which URLs belong to the app itself.
 *
 * The preload exposes `window.api` (filesystem, git, terminal, tasks, ...) to
 * whatever page is loaded in an app window, so two things must hold:
 *
 *  1. A window never navigates to a page that is not the app (will-navigate,
 *     window.open), and links leave the app only through the same protocol
 *     allowlist as the `shell:open-external` IPC channel.
 *  2. Every IPC message is accepted only from a frame showing the app, as
 *     defense in depth should (1) ever be bypassed.
 *
 * Pure module (no `electron` import) so the rules are unit-tested directly.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSafeExternalUrl } from '../../shared/url-safety'

export interface AppOrigin {
  /** Vite dev server URL in development (`VITE_DEV_SERVER_URL`). */
  devServerUrl?: string
  /** Absolute path of the built renderer directory (`dist/`) in production. */
  rendererRoot: string
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** True when `url` is a page of the app itself. */
export function isAppUrl(url: unknown, origin: AppOrigin): boolean {
  if (typeof url !== 'string' || !url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (origin.devServerUrl) {
    // Exact origin match. A prefix check would also accept
    // http://localhost:5173.attacker.example.
    try {
      return parsed.origin === new URL(origin.devServerUrl).origin
    } catch {
      return false
    }
  }

  if (parsed.protocol !== 'file:' || (parsed.host && parsed.host !== 'localhost')) return false
  try {
    return isInside(path.resolve(origin.rendererRoot), path.resolve(fileURLToPath(parsed)))
  } catch {
    return false
  }
}

export type NavigationDecision = 'allow' | 'open-external' | 'deny'

/**
 * What to do when an app window tries to navigate (or open a window) to `url`:
 * stay for app pages, hand allowlisted links (http/https/mailto/tel) to the
 * OS, and drop everything else — notably `file:` URLs and custom schemes,
 * which `shell.openExternal` would hand to arbitrary OS protocol handlers.
 */
export function decideNavigation(url: unknown, origin: AppOrigin): NavigationDecision {
  if (isAppUrl(url, origin)) return 'allow'
  if (isSafeExternalUrl(url)) return 'open-external'
  return 'deny'
}
