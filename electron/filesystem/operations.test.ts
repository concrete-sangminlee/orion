import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildFileTree,
  copyItem,
  createNewDirectory,
  createNewFile,
  DestinationExistsError,
  encodeFileContent,
  readFileContent,
  readFileForEditor,
  renameItem,
  writeFileContent,
} from './operations'
import { UnsupportedTextFileError } from './text-encoding'

let dir: string

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orion-ops-')))
})

afterEach(async () => {
  await fs.chmod(path.join(dir, 'locked'), 0o755).catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})

const at = (...parts: string[]) => path.join(dir, ...parts)

describe('creating', () => {
  it('creates a new file, including missing parent folders', async () => {
    await createNewFile(at('src', 'deep', 'new.ts'), 'export {}\n')
    expect(await fs.readFile(at('src', 'deep', 'new.ts'), 'utf8')).toBe('export {}\n')
  })

  it('never empties a file that already exists', async () => {
    await fs.writeFile(at('notes.md'), 'a week of work')
    await expect(createNewFile(at('notes.md'))).rejects.toThrow(DestinationExistsError)
    await expect(createNewFile(at('notes.md'))).rejects.toThrow('"notes.md" already exists')
    expect(await fs.readFile(at('notes.md'), 'utf8')).toBe('a week of work')
  })

  it('reports a folder that already exists instead of claiming to create it', async () => {
    await fs.mkdir(at('lib'))
    await fs.writeFile(at('file.txt'), 'x')
    await expect(createNewDirectory(at('lib'))).rejects.toThrow(DestinationExistsError)
    await expect(createNewDirectory(at('file.txt'))).rejects.toThrow(DestinationExistsError)
    await createNewDirectory(at('a', 'b'))
    expect((await fs.stat(at('a', 'b'))).isDirectory()).toBe(true)
  })
})

describe('renaming and moving', () => {
  it('renames a file', async () => {
    await fs.writeFile(at('a.ts'), 'A')
    await renameItem(at('a.ts'), at('b.ts'))
    expect(await fs.readFile(at('b.ts'), 'utf8')).toBe('A')
    await expect(fs.access(at('a.ts'))).rejects.toThrow()
  })

  it('refuses to replace an existing file and leaves both untouched', async () => {
    await fs.writeFile(at('a.ts'), 'A')
    await fs.writeFile(at('b.ts'), 'B')
    await expect(renameItem(at('a.ts'), at('b.ts'))).rejects.toThrow('"b.ts" already exists')
    expect(await fs.readFile(at('a.ts'), 'utf8')).toBe('A')
    expect(await fs.readFile(at('b.ts'), 'utf8')).toBe('B')
  })

  it('refuses to replace an existing (even empty) folder', async () => {
    await fs.mkdir(at('src'))
    await fs.mkdir(at('empty'))
    await expect(renameItem(at('src'), at('empty'))).rejects.toThrow(DestinationExistsError)
    expect((await fs.stat(at('src'))).isDirectory()).toBe(true)
  })

  it('treats a rename onto itself as nothing to do', async () => {
    await fs.writeFile(at('a.ts'), 'A')
    await renameItem(at('a.ts'), at('a.ts'))
    expect(await fs.readFile(at('a.ts'), 'utf8')).toBe('A')
  })

  it('allows a rename whose destination is the same entry (case-only rename)', async () => {
    await fs.writeFile(at('readme.md'), 'docs')
    const caseInsensitive = await fs.access(at('README.md')).then(() => true, () => false)
    if (!caseInsensitive) {
      // A hard link stands in for a case-insensitive file system (macOS,
      // Windows), where `readme.md` and `README.md` are one entry.
      await fs.link(at('readme.md'), at('README.md'))
    }
    await expect(renameItem(at('readme.md'), at('README.md'))).resolves.toBeUndefined()
    expect(await fs.readFile(at('README.md'), 'utf8')).toBe('docs')
    if (caseInsensitive) expect(await fs.readdir(dir)).toContain('README.md')
  })

  it('moves into a folder that does not exist yet', async () => {
    await fs.writeFile(at('a.ts'), 'A')
    await renameItem(at('a.ts'), at('nested', 'dir', 'a.ts'))
    expect(await fs.readFile(at('nested', 'dir', 'a.ts'), 'utf8')).toBe('A')
  })
})

describe('copying', () => {
  it('copies a folder recursively', async () => {
    await fs.mkdir(at('src', 'inner'), { recursive: true })
    await fs.writeFile(at('src', 'inner', 'x.ts'), 'X')
    await copyItem(at('src'), at('copy'))
    expect(await fs.readFile(at('copy', 'inner', 'x.ts'), 'utf8')).toBe('X')
  })

  it('refuses to copy over an existing file or folder', async () => {
    await fs.writeFile(at('a.ts'), 'A')
    await fs.writeFile(at('b.ts'), 'B')
    await fs.mkdir(at('dest'))
    await fs.writeFile(at('dest', 'keep.ts'), 'KEEP')
    await expect(copyItem(at('a.ts'), at('b.ts'))).rejects.toThrow(DestinationExistsError)
    await expect(copyItem(at('a.ts'), at('dest'))).rejects.toThrow(DestinationExistsError)
    expect(await fs.readFile(at('b.ts'), 'utf8')).toBe('B')
    expect(await fs.readFile(at('dest', 'keep.ts'), 'utf8')).toBe('KEEP')
  })
})

describe('reading and saving', () => {
  it('saves a file in the encoding it was opened in', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo\r\n', 'utf16le')])
    await fs.writeFile(at('legacy.txt'), utf16)
    expect(await readFileContent(at('legacy.txt'))).toBe('héllo\r\n')

    await writeFileContent(at('legacy.txt'), 'héllo wörld\r\n')
    const saved = await fs.readFile(at('legacy.txt'))
    expect(saved.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]))
    expect(saved.subarray(2).toString('utf16le')).toBe('héllo wörld\r\n')
  })

  it('keeps a UTF-8 byte-order mark across open and save', async () => {
    await fs.writeFile(at('script.ps1'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Write-Host 1')]))
    const text = await readFileContent(at('script.ps1'))
    expect(text).toBe('Write-Host 1')
    await writeFileContent(at('script.ps1'), text + '\n')
    expect([...(await fs.readFile(at('script.ps1'))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('writes plain UTF-8 to a file it never opened', async () => {
    expect([...encodeFileContent(at('new.txt'), 'é')]).toEqual([0xc3, 0xa9])
  })

  it('carries the encoding over a rename, also of a parent folder', async () => {
    await fs.mkdir(at('docs'))
    await fs.writeFile(at('docs', 'a.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')]))
    await readFileContent(at('docs', 'a.txt'))
    await renameItem(at('docs'), at('manual'))
    expect([...encodeFileContent(at('manual', 'a.txt'), 'x')].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect([...encodeFileContent(at('docs', 'a.txt'), 'x')]).toEqual([0x78])
  })

  it('refuses a file that is not text and says why', async () => {
    await fs.writeFile(at('legacy-latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    await fs.writeFile(at('app.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]))
    await expect(readFileContent(at('app.wasm'))).rejects.toThrow('it is a binary file and cannot be edited as text')
    await expect(readFileContent(at('legacy-latin1.txt'))).rejects.toThrow(/encoding is not UTF-8 or UTF-16/)
    await expect(readFileContent(at('app.wasm'))).rejects.toBeInstanceOf(UnsupportedTextFileError)
    // Nothing was remembered for a file that could not be opened.
    expect([...encodeFileContent(at('app.wasm'), 'x')]).toEqual([0x78])
  })

  it('opens an image as a preview without text, and never lets it be overwritten', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    await fs.writeFile(at('logo.PNG'), png)
    expect(await readFileForEditor(at('logo.PNG'))).toEqual({ content: '', binary: true })
    // The tab holds an empty buffer; a save of it must not reach the disk.
    expect(() => encodeFileContent(at('logo.PNG'), '')).toThrow('Refusing to overwrite "logo.PNG": it is not a text file')
    await expect(writeFileContent(at('logo.PNG'), '')).rejects.toThrow(/Refusing to overwrite/)
    expect((await fs.readFile(at('logo.PNG'))).equals(png)).toBe(true)
  })

  it('reads text files for the editor as text', async () => {
    await fs.writeFile(at('icon.svg'), '<svg/>')
    expect(await readFileForEditor(at('icon.svg'))).toEqual({ content: '<svg/>', binary: false, bytes: Buffer.from('<svg/>') })
  })

  it('refuses a folder', async () => {
    await fs.mkdir(at('folder'))
    await expect(readFileContent(at('folder'))).rejects.toThrow('it is not a regular file')
  })
})

describe('buildFileTree', () => {
  it('lists folders first, skips ignored names, and sorts by name', async () => {
    await fs.mkdir(at('src'))
    await fs.mkdir(at('node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(at('src', 'index.ts'), '')
    await fs.writeFile(at('b.txt'), '')
    await fs.writeFile(at('a.txt'), '')
    const tree = await buildFileTree(dir)
    expect(tree.map((node) => node.name)).toEqual(['src', 'a.txt', 'b.txt'])
    expect(tree[0].children?.map((node) => node.name)).toEqual(['index.ts'])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'shows an unreadable folder as empty instead of failing the whole workspace',
    async () => {
      await fs.mkdir(at('locked'))
      await fs.writeFile(at('locked', 'secret'), '')
      await fs.writeFile(at('visible.txt'), '')
      await fs.chmod(at('locked'), 0o000)
      const tree = await buildFileTree(dir)
      expect(tree.map((node) => node.name)).toEqual(['locked', 'visible.txt'])
      expect(tree[0].children).toEqual([])
    },
  )

  it('still fails when the root itself cannot be listed', async () => {
    await expect(buildFileTree(at('missing'))).rejects.toThrow()
  })
})
