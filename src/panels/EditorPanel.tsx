import { useEffect, useState, useRef, useCallback } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import TabBar from '@/components/TabBar'
import InlineEdit from '@/components/InlineEdit'
import {
  Zap, FolderOpen, MessageSquare, Terminal, Command,
  ChevronRight, FilePlus, Loader2, Keyboard, Clock,
  Search, Settings, GitBranch, Columns, Sparkles,
} from 'lucide-react'

export default function EditorPanel() {
  const { openFiles, activeFilePath, updateFileContent } = useEditorStore()
  const addToast = useToastStore((s) => s.addToast)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  // Inline edit (Ctrl+K) state
  const [inlineEditVisible, setInlineEditVisible] = useState(false)
  const [inlineEditPos, setInlineEditPos] = useState({ top: 60, left: 100 })
  const [inlineEditText, setInlineEditText] = useState('')
  const [inlineProcessing, setInlineProcessing] = useState(false)

  // Split editor state
  const [splitMode, setSplitMode] = useState<'single' | 'split'>('single')
  const [splitFilePath, setSplitFilePath] = useState<string | null>(null)
  const splitFile = splitFilePath ? openFiles.find((f) => f.path === splitFilePath) : null

  const handleChange = (value: string | undefined) => {
    if (activeFilePath && value !== undefined) {
      updateFileContent(activeFilePath, value)
    }
  }

  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Register Ctrl+K for inline edit
    editor.addAction({
      id: 'orion-inline-edit',
      label: 'Edit with AI (Ctrl+K)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!selection || !model) return

        const selectedText = model.getValueInRange(selection)
        setInlineEditText(selectedText)

        // Position the inline edit near the selection
        const pos = ed.getScrolledVisiblePosition(selection.getStartPosition())
        const domNode = ed.getDomNode()
        if (pos && domNode) {
          const rect = domNode.getBoundingClientRect()
          setInlineEditPos({
            top: pos.top + rect.top - 10,
            left: Math.max(pos.left + rect.left, rect.left + 40),
          })
        } else {
          setInlineEditPos({ top: 100, left: 100 })
        }

        setInlineEditVisible(true)
      },
    })

    // Register Ctrl+H for find and replace (Monaco built-in)
    editor.addAction({
      id: 'orion-find-replace',
      label: 'Find and Replace',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
      run: (ed) => {
        ed.getAction('editor.action.startFindReplaceAction')?.run()
      },
    })
  }

  const handleInlineEditSubmit = async (instruction: string) => {
    if (!activeFile || !editorRef.current) return
    setInlineProcessing(true)

    try {
      const selection = editorRef.current.getSelection()
      const model = editorRef.current.getModel()
      if (!selection || !model) return

      const selectedCode = model.getValueInRange(selection) || ''
      const fullContext = model.getValue()

      // Send to AI for inline editing
      const message = `You are editing code inline. The user selected this code:\n\`\`\`\n${selectedCode}\n\`\`\`\n\nFrom this file:\n\`\`\`${activeFile.language}\n${fullContext.substring(0, 2000)}\n\`\`\`\n\nInstruction: ${instruction}\n\nRespond with ONLY the replacement code, no explanation, no markdown fences. Just the raw code that should replace the selection.`

      window.api?.omoSend({
        type: 'chat',
        payload: { message, mode: 'chat', model: 'inline-edit' },
      })

      // Listen for the response
      const handler = (event: any) => {
        if (event?.detail?.type === 'inline-edit-response') {
          const newCode = event.detail.content
          if (newCode && selection) {
            editorRef.current?.executeEdits('orion-inline-edit', [{
              range: selection,
              text: newCode,
            }])
            addToast({ type: 'success', message: 'Code updated by AI' })
          }
          setInlineProcessing(false)
          setInlineEditVisible(false)
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }
      window.addEventListener('orion:inline-edit-response', handler)

      // Fallback timeout
      setTimeout(() => {
        if (inlineProcessing) {
          setInlineProcessing(false)
          setInlineEditVisible(false)
          addToast({ type: 'info', message: 'AI edit timed out - try from chat instead' })
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }, 30000)
    } catch (err) {
      setInlineProcessing(false)
      addToast({ type: 'error', message: 'Failed to process inline edit' })
    }
  }

  // Ctrl+S save handler
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeFile) {
          setSaving(true)
          await window.api.writeFile(activeFile.path, activeFile.content)
          addToast({ type: 'success', message: `Saved ${activeFile.name}`, duration: 1500 })
          setTimeout(() => setSaving(false), 800)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFile])

  // Handle split editor
  const handleSplitToggle = useCallback(() => {
    if (splitMode === 'single' && activeFile) {
      setSplitMode('split')
      // Use the second open file, or the same file
      const other = openFiles.find((f) => f.path !== activeFilePath)
      setSplitFilePath(other?.path || activeFilePath || null)
    } else {
      setSplitMode('single')
      setSplitFilePath(null)
    }
  }, [splitMode, activeFile, openFiles, activeFilePath])

  // Listen for split toggle events
  useEffect(() => {
    const handler = () => handleSplitToggle()
    window.addEventListener('orion:split-editor', handler)
    return () => window.removeEventListener('orion:split-editor', handler)
  }, [handleSplitToggle])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    fontLigatures: true,
    minimap: {
      enabled: true,
      scale: 1,
      showSlider: 'mouseover',
      maxColumn: 60,
      renderCharacters: false,
      side: 'right',
    },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorWidth: 2,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    padding: { top: 16, bottom: 16 },
    lineNumbers: 'on',
    renderLineHighlight: 'line',
    lineHeight: 20,
    letterSpacing: 0.3,
    guides: {
      bracketPairs: true,
      bracketPairsHorizontal: true,
      indentation: true,
      highlightActiveBracketPair: true,
      highlightActiveIndentation: true,
    },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
      verticalSliderSize: 8,
      horizontalSliderSize: 8,
    },
    stickyScroll: { enabled: true },
    wordWrap: 'off',
    links: true,
    colorDecorators: true,
    matchBrackets: 'always',
    occurrencesHighlight: 'singleFile',
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    suggest: {
      showIcons: true,
      showStatusBar: true,
      preview: true,
    },
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <TabBar />

      {/* Breadcrumbs */}
      {activeFile && (
        <div className="shrink-0 flex items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <Breadcrumbs path={activeFile.path} saving={saving} />
          {/* Split editor toggle */}
          <button
            onClick={handleSplitToggle}
            title="Split Editor"
            style={{
              padding: '0 8px',
              height: 26,
              color: splitMode === 'split' ? 'var(--accent)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (splitMode !== 'split') e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { if (splitMode !== 'split') e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <Columns size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden" style={{ display: 'flex' }}>
        {activeFile ? (
          <>
            {/* Primary editor */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Editor
                theme="vs-dark"
                language={activeFile.language}
                value={activeFile.content}
                onChange={handleChange}
                onMount={handleEditorMount}
                loading={<EditorLoading />}
                options={editorOptions}
              />
              {/* Inline Edit Overlay */}
              {inlineEditVisible && (
                <InlineEdit
                  visible={inlineEditVisible}
                  onClose={() => setInlineEditVisible(false)}
                  onSubmit={handleInlineEditSubmit}
                  isProcessing={inlineProcessing}
                  selectedText={inlineEditText}
                  position={inlineEditPos}
                />
              )}
            </div>

            {/* Split editor */}
            {splitMode === 'split' && splitFile && (
              <>
                <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  {/* Split file tab */}
                  <div style={{
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-tertiary)',
                    gap: 6,
                  }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {splitFile.name}
                    </span>
                    {/* Switch split file dropdown */}
                    <select
                      value={splitFilePath || ''}
                      onChange={(e) => setSplitFilePath(e.target.value)}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                        padding: '1px 4px',
                        outline: 'none',
                      }}
                    >
                      {openFiles.map((f) => (
                        <option key={f.path} value={f.path}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <Editor
                    theme="vs-dark"
                    language={splitFile.language}
                    value={splitFile.content}
                    onChange={(val) => {
                      if (splitFilePath && val !== undefined) {
                        updateFileContent(splitFilePath, val)
                      }
                    }}
                    options={{
                      ...editorOptions,
                      minimap: { enabled: false },
                    }}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </div>
  )
}

function Breadcrumbs({ path, saving }: { path: string; saving: boolean }) {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const fileName = segments.pop() || ''
  const dirSegments = segments.slice(-3)

  return (
    <div
      className="flex-1 flex items-center gap-0.5 px-3 overflow-x-auto"
      style={{
        height: 26,
        background: 'var(--bg-primary)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      {segments.length > 3 && (
        <>
          <span style={{ opacity: 0.5 }}>...</span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
        </>
      )}
      {dirSegments.map((seg, i) => (
        <span key={i} className="flex items-center gap-0.5" style={{ flexShrink: 0 }}>
          <span
            className="cursor-pointer"
            style={{ color: 'var(--text-muted)', padding: '1px 2px', borderRadius: 3 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {seg}
          </span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
        </span>
      ))}
      <span style={{ color: 'var(--text-primary)', fontWeight: 500, flexShrink: 0 }}>
        {fileName}
      </span>

      {saving && (
        <span
          className="ml-auto flex items-center gap-1"
          style={{ fontSize: 10, color: 'var(--accent-green)', flexShrink: 0 }}
        >
          <Loader2 size={10} className="anim-spin" />
          Saved
        </span>
      )}
    </div>
  )
}

function EditorLoading() {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-3"
      style={{ background: 'var(--bg-primary)' }}
    >
      <Loader2
        size={24}
        className="anim-spin"
        style={{ color: 'var(--accent)', opacity: 0.6 }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading editor...</span>
    </div>
  )
}

function WelcomeScreen() {
  return (
    <div
      className="h-full flex flex-col items-center justify-center"
      style={{ background: 'var(--bg-primary)', flex: 1 }}
    >
      <div className="flex flex-col items-center gap-10" style={{ marginTop: -60, maxWidth: 480 }}>
        {/* Logo */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: 'linear-gradient(135deg, rgba(88,166,255,0.1) 0%, rgba(188,140,255,0.12) 50%, rgba(63,185,80,0.08) 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            <Zap size={36} style={{ color: 'var(--accent)' }} />
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              width: 24,
              height: 24,
              borderRadius: 8,
              background: 'rgba(63,185,80,0.1)',
              border: '1px solid rgba(63,185,80,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              className="anim-pulse"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--accent-green)',
                boxShadow: '0 0 8px rgba(63,185,80,0.4)',
              }}
            />
          </div>
        </div>

        <div className="text-center">
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
            Orion
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.02em', opacity: 0.7 }}>
            by Bebut
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, letterSpacing: '0.01em' }}>
            AI-Powered Code Editor
          </p>
        </div>

        <div style={{ width: '100%', maxWidth: 340 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, paddingLeft: 2 }}>
            Start
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { Icon: FilePlus, label: 'New File', key: 'Ctrl+N' },
              { Icon: FolderOpen, label: 'Open Folder', key: 'Ctrl+O' },
            ].map(({ Icon, label, key }) => (
              <WelcomeRow key={label} Icon={Icon} label={label} shortcut={key} />
            ))}
          </div>
        </div>

        <div style={{ width: '100%', maxWidth: 340 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, paddingLeft: 2 }}>
            <Keyboard size={11} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle', opacity: 0.6 }} />
            Shortcuts
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            {[
              { Icon: Sparkles, label: 'Inline Edit', key: 'Ctrl+K' },
              { Icon: MessageSquare, label: 'AI Chat', key: 'Ctrl+L' },
              { Icon: Terminal, label: 'Terminal', key: 'Ctrl+`' },
              { Icon: Search, label: 'Search Files', key: 'Ctrl+P' },
              { Icon: Command, label: 'Commands', key: 'Ctrl+Shift+P' },
              { Icon: Settings, label: 'Settings', key: 'Ctrl+,' },
              { Icon: GitBranch, label: 'Source Control', key: 'Ctrl+Shift+G' },
              { Icon: Columns, label: 'Split Editor', key: 'Click icon' },
            ].map(({ Icon, label, key }) => (
              <WelcomeRow key={label} Icon={Icon} label={label} shortcut={key} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WelcomeRow({ Icon, label, shortcut, compact }: { Icon: typeof Zap; label: string; shortcut: string; compact?: boolean }) {
  return (
    <div
      className="flex items-center gap-3 cursor-pointer transition-colors duration-100"
      style={{ padding: compact ? '6px 10px' : '8px 14px', borderRadius: 8 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <Icon size={compact ? 12 : 14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{ fontSize: compact ? 11 : 12, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      <kbd style={{
        fontSize: compact ? 9 : 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)',
        border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px',
        fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.4,
      }}>
        {shortcut}
      </kbd>
    </div>
  )
}
