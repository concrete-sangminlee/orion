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

type Awaitable<T> = T | Promise<T>

export type InvokeHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => Awaitable<IpcInvokeResult<C>>

export type SendListener<C extends IpcSendChannel> = (event: IpcMainEvent, ...args: IpcSendArgs<C>) => void

const registeredInvokeChannels = new Set<string>()
const registeredSendChannels = new Set<string>()

/** Register a request/response handler declared in `IpcInvokeContract`. */
export function handle<C extends IpcInvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  registeredInvokeChannels.add(channel)
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}

/** Register a fire-and-forget listener declared in `IpcSendContract`. */
export function listen<C extends IpcSendChannel>(channel: C, listener: SendListener<C>): void {
  registeredSendChannels.add(channel)
  ipcMain.on(channel, listener as (event: IpcMainEvent, ...args: unknown[]) => void)
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
