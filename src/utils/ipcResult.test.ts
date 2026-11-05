import { describe, expect, it, vi, beforeEach } from 'vitest'
import { assertIpcSuccess, normalizeQueueKey, writeFileChecked } from './ipcResult'

describe('ipcResult helpers', () => {
  beforeEach(() => {
    ;(globalThis as { api?: { writeFile: unknown } }).api = {
      writeFile: vi.fn(),
    }
  })

  it('asserts success result', () => {
    expect(() => assertIpcSuccess({ success: true }, 'save')).not.toThrow()
  })

  it('throws when result is undefined', () => {
    expect(() => assertIpcSuccess(undefined, 'save')).toThrow('save failed')
  })

  it('throws when result indicates failure', () => {
    expect(() => assertIpcSuccess({ success: false, error: 'disk full' }, 'save')).toThrow('disk full')
  })

  it('writeFileChecked calls window.api.writeFile and resolves on success', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    apiWrite.mockResolvedValue({ success: true })

    await expect(writeFileChecked('file.ts', 'content', 'save')).resolves.toBeUndefined()
    expect(apiWrite).toHaveBeenCalledWith('file.ts', 'content')
  })

  it('writeFileChecked throws when write fails', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    apiWrite.mockResolvedValue({ success: false, error: 'denied' })

    await expect(writeFileChecked('file.ts', 'content', 'save')).rejects.toThrow('denied')
  })

  it('serializes writes for the same file path', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    const calls: string[] = []
    let resolveFirstWrite: () => void = () => {}
    const firstWriteDone = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve
    })

    apiWrite.mockImplementation((filePath: string, content: string) => {
      calls.push(`${filePath}:${content}`)
      if (calls.length === 1) {
        return firstWriteDone.then(() => ({ success: true }))
      }
      return Promise.resolve({ success: true })
    })

    const first = writeFileChecked('file.ts', 'one', 'save')
    const second = writeFileChecked('file.ts', 'two', 'save')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiWrite).toHaveBeenCalledTimes(1)
    resolveFirstWrite()
    await first
    await second

    expect(apiWrite).toHaveBeenCalledTimes(2)
    expect(apiWrite).toHaveBeenNthCalledWith(1, 'file.ts', 'one')
    expect(apiWrite).toHaveBeenNthCalledWith(2, 'file.ts', 'two')
  })

  it('normalizes queue keys for equivalent path forms', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    apiWrite.mockResolvedValue({ success: true })

    const calls: string[] = []
    let resolveFirstWrite: () => void = () => {}
    const firstWriteDone = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve
    })

    apiWrite.mockImplementation((filePath: string, content: string) => {
      calls.push(filePath)
      if (calls.length === 1) {
        return firstWriteDone.then(() => ({ success: true }))
      }
      return Promise.resolve({ success: true })
    })

    // A raw (non-normalized) spelling: path.join would already collapse it.
    const writeA = writeFileChecked('project/../file.ts', 'first', 'save')
    const writeB = writeFileChecked('file.ts', 'second', 'save')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiWrite).toHaveBeenCalledTimes(1)

    resolveFirstWrite()
    await writeA
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(apiWrite).toHaveBeenCalledTimes(2)
    await writeB
    expect(apiWrite).toHaveBeenNthCalledWith(1, 'project/../file.ts', 'first')
    expect(apiWrite).toHaveBeenNthCalledWith(2, 'file.ts', 'second')
  })

  it('continues the queue when prior write fails', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    apiWrite
      .mockResolvedValueOnce({ success: false, error: 'temporary' })
      .mockResolvedValueOnce({ success: true })

    const first = writeFileChecked('file.ts', 'one', 'save')
    const second = writeFileChecked('file.ts', 'two', 'save')

    await expect(first).rejects.toThrow('temporary')
    await expect(second).resolves.toBeUndefined()
    expect(apiWrite).toHaveBeenCalledTimes(2)
  })

  it('allows parallel writes for different file paths', async () => {
    const apiWrite = (globalThis as unknown as { api: { writeFile: unknown } }).api.writeFile as ReturnType<typeof vi.fn>
    apiWrite.mockResolvedValue({ success: true })

    const first = writeFileChecked('a.ts', 'one', 'save')
    const second = writeFileChecked('b.ts', 'two', 'save')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiWrite).toHaveBeenCalledTimes(2)

    await first
    await second
  })
})

describe('normalizeQueueKey', () => {
  it.each([
    ['/ws/src/a.ts', '/ws/src/a.ts'],
    ['/ws/./src//a.ts', '/ws/src/a.ts'],
    ['/ws/lib/../src/a.ts', '/ws/src/a.ts'],
    ['/../ws/a.ts', '/ws/a.ts'],
    ['C:\\ws\\src\\a.ts', 'c:/ws/src/a.ts'],
    ['c:/ws/src/a.ts', 'c:/ws/src/a.ts'],
    ['\\\\server\\share\\a.ts', '//server/share/a.ts'],
    ['project/../file.ts', 'file.ts'],
    ['../file.ts', '../file.ts'],
    ['./', '.'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeQueueKey(input)).toBe(expected)
  })
})

