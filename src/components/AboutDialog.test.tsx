/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AboutDialog from './AboutDialog'
import { repositoryWebUrl } from '@/utils/projectLinks'
import pkg from '../../package.json'

const REPO = 'https://github.com/concrete-sangminlee/orion'

describe('repositoryWebUrl', () => {
  it('turns the package.json git url into the repository page', () => {
    expect(repositoryWebUrl('git+https://github.com/o/r.git')).toBe('https://github.com/o/r')
    expect(repositoryWebUrl(pkg.repository.url)).toBe(REPO)
  })
})

describe('AboutDialog links', () => {
  afterEach(() => cleanup())

  it('open the repository declared in package.json', async () => {
    const shellOpenExternal = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      shellOpenExternal,
      appGetInfo: vi.fn().mockResolvedValue({ version: '1', electron: '', chrome: '', node: '', v8: '', platform: 'linux', arch: 'x64' }),
    }
    await act(async () => {
      render(<AboutDialog open onClose={() => {}} />)
    })

    for (const label of ['GitHub', 'License', 'Release Notes', 'Report Issue']) {
      fireEvent.click(screen.getByText(label))
    }
    expect(shellOpenExternal.mock.calls.map(([url]) => url)).toEqual([
      REPO,
      `${REPO}/blob/main/LICENSE`,
      `${REPO}/releases`,
      pkg.bugs.url,
    ])
    expect(screen.queryByText('Website')).toBeNull()
  })
})
