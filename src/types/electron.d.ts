// `window.api` is typed from the object the preload script actually exposes
// (electron/preload-api.ts), which is itself typed against the shared IPC
// contract (shared/ipc-contract.ts). Do not hand-maintain method signatures
// here — change the contract and the preload factory instead.

import type { ElectronAPI } from '../../electron/preload-api'

export type { ElectronAPI }
export type * from '../../shared/ipc-contract'

/**
 * Bridges that the preload script has never exposed. Kept only so legacy,
 * currently-unreachable modules still compile; `window.electron` and
 * `window.electronAPI` are always `undefined` at runtime, so calls through
 * them silently do nothing. `src/__tests__/ipc-contract.test.ts` fails if any
 * module reachable from the app entry point uses them.
 *
 * @deprecated Use `window.api`.
 */
interface UnexposedLegacyBridge {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  on?: (channel: string, callback: (...args: any[]) => void) => void
  send?: (channel: string, ...args: any[]) => void
}

declare global {
  interface Window {
    api: ElectronAPI
    /** @deprecated Never exposed by the preload script — always undefined. Use `window.api`. */
    electron?: UnexposedLegacyBridge
    /** @deprecated Never exposed by the preload script — always undefined. Use `window.api`. */
    electronAPI?: Record<string, ((...args: any[]) => any) | undefined>
  }
}
