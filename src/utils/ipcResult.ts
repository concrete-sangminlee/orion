export interface IpcResult {
  success: boolean
  error?: string
}

type WriteQueueEntry = Promise<void>
const writeQueues = new Map<string, WriteQueueEntry>()

/**
 * Normalize a file path into a write-queue key so equivalent spellings
 * (`a/./b`, `a//b`, `a/x/../b`, `C:\\a\\b`) share one queue.
 *
 * This runs in the renderer, which has no Node built-ins: importing
 * `node:path` here crashed the whole renderer at startup in the packaged app
 * ("require is not defined"), while the Node-based unit tests still passed.
 */
export function normalizeQueueKey(filePath: string): string {
  let rest = filePath.replace(/\\/g, '/')
  let prefix = ''
  const drive = /^([A-Za-z]):/.exec(rest)
  if (drive) {
    prefix = `${drive[1].toLowerCase()}:`
    rest = rest.slice(2)
  }
  if (rest.startsWith('//') && !drive) {
    prefix += '//'
    rest = rest.slice(2)
  } else if (rest.startsWith('/')) {
    prefix += '/'
  }
  const absolute = prefix.endsWith('/')

  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else if (!absolute) segments.push('..')
      continue
    }
    segments.push(segment)
  }
  return prefix + segments.join('/') || '.'
}

export class IpcOperationError extends Error {
  public readonly operation: string

  constructor(operation: string, message: string) {
    super(message)
    this.operation = operation
    this.name = 'IpcOperationError'
  }
}

function formatIpcError(operation: string, error?: string): string {
  return error || `${operation} failed`
}

export function assertIpcSuccess(result: IpcResult | null | undefined, operation: string): void {
  if (!result || result.success !== true) {
    throw new IpcOperationError(operation, formatIpcError(operation, result?.error))
  }
}

export async function writeFileChecked(
  filePath: string,
  content: string,
  operation = 'Save file',
): Promise<void> {
  const queueKey = normalizeQueueKey(filePath)

  const runWrite = async () => {
    const api = (globalThis as { api?: { writeFile?: (filePath: string, content: string) => Promise<IpcResult> } }).api
    if (!api?.writeFile) {
      throw new IpcOperationError(operation, 'IPC API is unavailable')
    }

    const result = await api.writeFile(filePath, content)
    assertIpcSuccess(result, operation)
  }

  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(() => runWrite())
  const queued = current.catch(() => {}).finally(() => {
    if (writeQueues.get(queueKey) === queued) {
      writeQueues.delete(queueKey)
    }
  })
  writeQueues.set(queueKey, queued)
  await current
}
