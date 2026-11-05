/**
 * Typed wrappers around `ipcMain` / `webContents.send`, bound to
 * `shared/ipc-contract.ts`.
 *
 * Registering a handler through `handle()` makes the compiler check the
 * channel name, the parameter list, and the returned payload against the
 * contract the preload exposes. Handlers may declare *wider* parameter types
 * (e.g. `unknown`) than the contract — that is encouraged for values that are
 * validated at runtime — but never narrower ones.
 */

import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type {
  IpcEventArgs,
  IpcEventChannel,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcSendArgs,
  IpcSendChannel,
} from '../../shared/ipc-contract'
import { isAppUrl, type AppOrigin } from '../security/app-origin'

type Awaitable<T> = T | Promise<T>

export type InvokeHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => Awaitable<IpcInvokeResult<C>>

export type SendListener<C extends IpcSendChannel> = (event: IpcMainEvent, ...args: IpcSendArgs<C>) => void

const registeredInvokeChannels = new Set<string>()
const registeredSendChannels = new Set<string>()

// ---------------------------------------------------------------------------
// Sender trust
//
// Every channel is registered through handle()/listen(), so this is the one
// place that decides who may talk to the main process. Messages are accepted
// only from a frame that is showing the app itself; until the origin is
// configured, nothing is trusted (fail closed).
// ---------------------------------------------------------------------------

let appOrigin: AppOrigin | null = null

/** Set where the app's own pages live. Call once, before creating windows. */
export function configureIpcTrust(origin: AppOrigin): void {
  appOrigin = origin
}

type SenderEvent = Pick<IpcMainInvokeEvent | IpcMainEvent, 'senderFrame'>

export function isTrustedSender(event: SenderEvent): boolean {
  if (!appOrigin) return false
  let url: string | undefined
  try {
    // senderFrame is null once the frame navigated away or was destroyed.
    url = event.senderFrame?.url
  } catch {
    return false
  }
  return isAppUrl(url, appOrigin)
}

function describeSender(event: SenderEvent): string {
  try {
    return event.senderFrame?.url || '<destroyed frame>'
  } catch {
    return '<unavailable frame>'
  }
}

/** Register a request/response handler declared in `IpcInvokeContract`. */
export function handle<C extends IpcInvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  registeredInvokeChannels.add(channel)
  const invoke = handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[IPC] Refused ${channel} from untrusted sender ${describeSender(event)}`)
      throw new Error(`Refused ${channel}: untrusted sender`)
    }
    return invoke(event, ...args)
  })
}

/** Register a fire-and-forget listener declared in `IpcSendContract`. */
export function listen<C extends IpcSendChannel>(channel: C, listener: SendListener<C>): void {
  registeredSendChannels.add(channel)
  const receive = listener as (event: IpcMainEvent, ...args: unknown[]) => void
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[IPC] Ignored ${channel} from untrusted sender ${describeSender(event)}`)
      return
    }
    receive(event, ...args)
  })
}

type EventTarget = BrowserWindow | WebContents | null | undefined

function resolveWebContents(target: EventTarget): WebContents | null {
  if (!target) return null
  const webContents = 'webContents' in target ? target.webContents : target
  if (!webContents || webContents.isDestroyed()) return null
  return webContents
}

/**
 * Push an event declared in `IpcEventContract` to a renderer.
 *
 * Silently drops the event when the window is gone, instead of throwing
 * "Object has been destroyed" from inside watcher/pty/child-process callbacks.
 */
export function emit<C extends IpcEventChannel>(target: EventTarget, channel: C, ...args: IpcEventArgs<C>): void {
  const webContents = resolveWebContents(target)
  if (!webContents) return
  webContents.send(channel, ...args)
}

/** Channels registered so far — exposed for diagnostics and tests. */
export function getRegisteredChannels(): { invoke: string[]; send: string[] } {
  return { invoke: [...registeredInvokeChannels], send: [...registeredSendChannels] }
}
