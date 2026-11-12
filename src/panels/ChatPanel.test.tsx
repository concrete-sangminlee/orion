/** @vitest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmoBridgeMessage } from '@shared/ipc-contract'
import ChatPanel, { openCodeInNewTab, renderMarkdown } from './ChatPanel'
import { useChatStore } from '@/store/chat'
import { useChatHistoryStore } from '@/store/chatHistory'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

const markup = (text: string) => renderToStaticMarkup(<>{renderMarkdown(text)}</>)

describe('renderMarkdown', () => {
  it.each(['#### Notes', '#include <stdio.h>', '##', '#', '####### seven', 'text\n##\nmore'])(
    'finishes on %j (a "#" line that is not a 1-3 level heading)', (text) => {
      expect(markup(text)).not.toBe('')
    },
  )

  it('renders 1-6 "#" plus a space as headings and anything else starting with "#" as text', () => {
    expect(markup('#### Notes')).toMatch(/<h5[^>]*>Notes<\/h5>/)
    expect(markup('# Title')).toMatch(/<h2[^>]*>Title<\/h2>/)
    expect(markup('#include &lt;x&gt;')).toContain('<p')
    expect(markup('#include <stdio.h>\nint main()')).toContain('#include &lt;stdio.h&gt; int main()')
  })

  it('renders a reply cut mid-stream right after "##"', () => {
    expect(markup('Intro\n\n##')).toMatch(/>Intro<\/p><p[^>]*>##<\/p>$/)
  })
})

describe('openCodeInNewTab', () => {
  beforeEach(() => {
    useEditorStore.setState({ openFiles: [], activeFilePath: null })
  })

  it('opens the code in a new unsaved untitled tab', () => {
    openCodeInNewTab('print("hi")\n', 'py')

    const { openFiles, activeFilePath } = useEditorStore.getState()
    expect(openFiles).toHaveLength(1)
    expect(openFiles[0]).toMatchObject({ content: 'print("hi")\n', language: 'python', isModified: true })
    expect(openFiles[0].path).toMatch(/^untitled-\d+$/)
    expect(openFiles[0].name).toMatch(/^Untitled-\d+\.py$/)
    expect(activeFilePath).toBe(openFiles[0].path)
  })
})

describe('ChatPanel', () => {
  const omoSend = vi.fn<(message: OmoBridgeMessage) => void>()
  const openFileDialog = vi.fn<() => Promise<string[]>>()
  const readFile = vi.fn<(path: string) => Promise<{ content: string; language: string }>>()
  const sentChats = () => omoSend.mock.calls.map(([m]) => m).filter((m) => m.type === 'chat')
  const toastMessages = () => useToastStore.getState().notifications.map((n) => n.message).reverse()

  beforeEach(() => {
    localStorage.clear()
    omoSend.mockReset()
    openFileDialog.mockReset()
    readFile.mockReset()
    window.api = { omoSend, openFileDialog, readFile } as unknown as typeof window.api
    Element.prototype.scrollTo = vi.fn()
    useChatHistoryStore.setState({ conversations: [], activeConversationId: null })
    useChatStore.setState({ messages: [], pendingTurn: null, selectedModel: 'Claude Opus 5.5' })
    useToastStore.setState({ toasts: [], notifications: [] })
    useEditorStore.setState({
      openFiles: [{ path: '/w/src/app.ts', name: 'app.ts', content: 'export const answer = 42\n', language: 'typescript', isModified: false, aiModified: false }],
      activeFilePath: '/w/src/app.ts',
    })
  })

  afterEach(cleanup)

  const input = () => screen.getByPlaceholderText(/Ask Orion anything/) as HTMLTextAreaElement
  const type = (text: string) => fireEvent.change(input(), { target: { value: text } })
  const pressEnter = () => fireEvent.keyDown(input(), { key: 'Enter' })

  it('sends the attached active-file context and the visible history with the question', () => {
    render(<ChatPanel />)
    act(() => useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'what is this?', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'a module', timestamp: 2 },
      ],
    }))

    type('rename answer')
    pressEnter()

    const [chat] = sentChats()
    expect(chat.payload).toMatchObject({
      message: 'rename answer',
      model: 'Claude Opus 5.5',
      requestId: expect.any(String),
      history: [{ role: 'user', content: 'what is this?' }, { role: 'assistant', content: 'a module' }],
    })
    expect(chat.payload.systemPrompt).toContain('/w/src/app.ts')
    expect(chat.payload.systemPrompt).toContain('export const answer = 42')
    expect(chat.payload).not.toHaveProperty('mode')
  })

  it('keeps the draft and sends nothing when Enter is pressed while a reply is pending', () => {
    render(<ChatPanel />)
    type('first')
    pressEnter()
    type('second')
    pressEnter()

    expect(sentChats()).toHaveLength(1)
    expect(input().value).toBe('second')
  })

  it('has no simulated Agent mode and no Custom API Endpoint entry', () => {
    render(<ChatPanel />)
    expect(screen.queryByRole('button', { name: /^Agent$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Claude/ }))
    expect(screen.queryByText('Custom API Endpoint')).toBeNull()
    expect(screen.getByText('NVIDIA NIM')).toBeTruthy()
  })

  it('attaches files picked with the paperclip and sends their contents', async () => {
    openFileDialog.mockResolvedValue(['/elsewhere/notes.md', '/elsewhere/image.png', '/elsewhere/latin1.txt'])
    readFile.mockImplementation(async (path) => {
      // What fs:read-file does: an image resolves as a preview with no text; non-UTF-8 text rejects.
      if (path.endsWith('.png')) return { content: '', language: 'plaintext', binary: true }
      if (path.endsWith('latin1.txt')) throw new Error("Error invoking remote method 'fs:read-file': Error: not UTF-8 text")
      return { content: '# design notes', language: 'markdown' }
    })
    render(<ChatPanel />)

    fireEvent.click(screen.getByTitle('Attach file'))
    await waitFor(() => expect(screen.getByText('notes.md')).toBeTruthy())
    await waitFor(() => expect(toastMessages()).toEqual([
      'Cannot attach image.png: it is not a text file',
      'Cannot attach latin1.txt: not UTF-8 text',
    ]))
    expect(screen.queryByText('image.png')).toBeNull()
    expect(screen.queryByText('latin1.txt')).toBeNull()

    type('summarize')
    pressEnter()
    expect(sentChats()[0].payload.message).toBe('[File: notes.md]\n```\n# design notes\n```\n\nUser question: summarize')
  })

  it('reports a file picker that fails instead of leaving an unhandled rejection', async () => {
    openFileDialog.mockRejectedValue(new Error("Error invoking remote method 'fs:open-file-dialog': Error: no window"))
    render(<ChatPanel />)

    fireEvent.click(screen.getByTitle('Attach file'))
    await waitFor(() => expect(toastMessages()).toEqual(['Cannot open the file picker: no window']))
  })

  it('keeps an edit that is submitted while a reply is pending', () => {
    useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'q1', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'a1', timestamp: 2 },
      ],
    })
    render(<ChatPanel />)
    fireEvent.click(screen.getByTitle('Edit and resend'))
    const editor = screen.getByDisplayValue('q1')
    fireEvent.change(editor, { target: { value: 'q1, but better' } })

    // Another turn starts (e.g. Send in the main input) before the edit is submitted.
    act(() => { useChatStore.getState().sendTurn({ text: 'other question' }) })
    fireEvent.click(screen.getByText('Save & Resend'))

    expect(screen.getByDisplayValue('q1, but better')).toBeTruthy()
    expect(sentChats()).toHaveLength(1)
    expect(toastMessages()).toContain('Wait for the current reply to finish, or stop it')
  })
})
