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
  FileText,
} from 'lucide-react'

export default function EditorPanel() {
  const { openFiles, activeFilePath, updateFileContent, markSaved, closeFile, closeAllFiles } = useEditorStore()
  const addToast = useToastStore((s) => s.addToast)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Editor config state for command palette toggling
  const [editorConfig, setEditorConfig] = useState({ fontSize: 13, minimap: true, wordWrap: false })

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

      // Auto-save with 2-second debounce
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(async () => {
        if (activeFilePath) {
          await window.api.writeFile(activeFilePath, value)
          markSaved(activeFilePath) // clear modified indicator
        }
      }, 2000)
    }
  }

  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

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

    // Dispatch cursor position changes to status bar
    editor.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(new CustomEvent('orion:cursor-change', {
        detail: { line: e.position.lineNumber, column: e.position.column }
      }))
    })

    // Dispatch selection changes to status bar
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection
      const model = editor.getModel()
      if (model && !selection.isEmpty()) {
        const text = model.getValueInRange(selection)
        window.dispatchEvent(new CustomEvent('orion:selection-change', {
          detail: { chars: text.length, lines: text.split('\n').length }
        }))
      } else {
        window.dispatchEvent(new CustomEvent('orion:selection-change', { detail: null }))
      }
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

  // Command palette event handlers
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'orion:toggle-minimap': () => {
        setEditorConfig(prev => {
          const next = { ...prev, minimap: !prev.minimap }
          editorRef.current?.updateOptions({ minimap: { enabled: next.minimap } })
          return next
        })
      },
      'orion:toggle-wordwrap': () => {
        setEditorConfig(prev => {
          const next = { ...prev, wordWrap: !prev.wordWrap }
          editorRef.current?.updateOptions({ wordWrap: next.wordWrap ? 'on' : 'off' })
          return next
        })
      },
      'orion:font-increase': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: prev.fontSize + 1 }
          editorRef.current?.updateOptions({ fontSize: next.fontSize })
          return next
        })
      },
      'orion:font-decrease': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: Math.max(10, prev.fontSize - 1) }
          editorRef.current?.updateOptions({ fontSize: next.fontSize })
          return next
        })
      },
      'orion:font-reset': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: 13 }
          editorRef.current?.updateOptions({ fontSize: 13 })
          return next
        })
      },
      'orion:format-document': () => {
        editorRef.current?.getAction('editor.action.formatDocument')?.run()
      },
      'orion:editor-find': () => {
        editorRef.current?.getAction('actions.find')?.run()
      },
      'orion:editor-replace': () => {
        editorRef.current?.getAction('editor.action.startFindReplaceAction')?.run()
      },
      'orion:close-tab': () => {
        if (activeFilePath) {
          closeFile(activeFilePath)
        }
      },
      'orion:close-all-tabs': () => {
        closeAllFiles()
      },
      'orion:save-file': () => {
        if (activeFile) {
          setSaving(true)
          window.api.writeFile(activeFile.path, activeFile.content).then(() => {
            markSaved(activeFile.path)
            addToast({ type: 'success', message: `Saved ${activeFile.name}`, duration: 1500 })
            setTimeout(() => setSaving(false), 800)
          })
        }
      },
    }

    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler)
    })
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler)
      })
    }
  }, [activeFilePath, activeFile, closeFile, closeAllFiles, markSaved, addToast])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    fontSize: editorConfig.fontSize,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    fontLigatures: true,
    minimap: {
      enabled: editorConfig.minimap,
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
    wordWrap: editorConfig.wordWrap ? 'on' : 'off',
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
    contextmenu: true,
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <TabBar />

      {/* Separator between tab bar and breadcrumbs */}
      {activeFile && (
        <div style={{ height: 1, background: 'var(--border)', flexShrink: 0 }} />
      )}

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
  const normalizedPath = path.replace(/\\/g, '/')
  const segments = normalizedPath.split('/').filter(Boolean)
  const fileName = segments.pop() || ''
  const dirSegments = segments.slice(-3)
  // How many segments were truncated (for building the full directory path on click)
  const truncatedCount = Math.max(0, segments.length - 3)

  const handleDirClick = (segmentIndex: number) => {
    // Build the full directory path up to the clicked segment.
    // segmentIndex is relative to dirSegments; map it back to the full segments array.
    const fullIndex = truncatedCount + segmentIndex
    const dirPath = segments.slice(0, fullIndex + 1).join('/')
    // Prefix with / on Unix-style paths (the original path starts with /)
    const prefix = normalizedPath.startsWith('/') ? '/' : ''
    window.dispatchEvent(
      new CustomEvent('orion:show-explorer', { detail: { directory: prefix + dirPath } })
    )
  }

  return (
    <div
      className="flex-1 flex items-center overflow-x-auto"
      style={{
        height: 24,
        background: 'var(--bg-primary)',
        fontSize: 12,
        color: 'var(--text-muted)',
        padding: '0 12px',
        gap: 2,
      }}
    >
      {segments.length > 3 && (
        <>
          <span style={{ opacity: 0.5, flexShrink: 0 }}>...</span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0, margin: '0 1px' }} />
        </>
      )}
      {dirSegments.map((seg, i) => (
        <span key={i} className="flex items-center" style={{ flexShrink: 0, gap: 2 }}>
          <span
            role="button"
            tabIndex={0}
            onClick={() => handleDirClick(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDirClick(i) } }}
            style={{
              color: 'var(--text-muted)',
              padding: '1px 3px',
              borderRadius: 3,
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'color 0.15s, text-decoration 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)'
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.textDecoration = 'none'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {seg}
          </span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
        </span>
      ))}
      {/* File name segment - not clickable */}
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
  const { openFiles, setActiveFile } = useEditorStore()

  const dispatch = (event: string) => {
    window.dispatchEvent(new CustomEvent(event))
  }

  const quickActions = [
    {
      icon: FileText,
      label: 'New File',
      action: () => dispatch('orion:new-file'),
    },
    {
      icon: FolderOpen,
      label: 'Open Folder',
      action: () => window.api?.openFolder(),
    },
    {
      icon: Terminal,
      label: 'Open Terminal',
      action: () => dispatch('orion:toggle-terminal'),
    },
    {
      icon: MessageSquare,
      label: 'AI Chat',
      action: () => dispatch('orion:toggle-chat'),
    },
  ]

  const shortcuts = [
    { keys: ['Ctrl', 'P'], description: 'Quick Open' },
    { keys: ['Ctrl', 'Shift', 'P'], description: 'Command Palette' },
    { keys: ['Ctrl', 'K'], description: 'AI Inline Edit' },
    { keys: ['Ctrl', 'B'], description: 'Toggle Sidebar' },
    { keys: ['Ctrl', '`'], description: 'Toggle Terminal' },
    { keys: ['Ctrl', 'L'], description: 'AI Chat' },
  ]

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        overflow: 'auto',
        animation: 'fade-in 0.4s ease-out',
      }}
    >
      <div style={{ maxWidth: 500, width: '100%', padding: '40px 32px' }}>

        {/* Logo area */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.2,
            }}
          >
            Orion
          </h1>
          <p style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginTop: 6,
            letterSpacing: '0.02em',
          }}>
            by Bebut
          </p>
        </div>

        {/* Quick actions grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 32,
        }}>
          {quickActions.map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                textAlign: 'left',
                transition: 'transform 0.15s ease, background 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)'
                e.currentTarget.style.borderColor = 'var(--border-bright)'
                e.currentTarget.style.transform = 'translateY(-1px)'
                const iconEl = e.currentTarget.querySelector('.welcome-action-icon') as HTMLElement
                if (iconEl) iconEl.style.color = 'var(--accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)'
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.transform = 'translateY(0)'
                const iconEl = e.currentTarget.querySelector('.welcome-action-icon') as HTMLElement
                if (iconEl) iconEl.style.color = 'var(--text-muted)'
              }}
            >
              <Icon
                size={16}
                className="welcome-action-icon"
                style={{
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'color 0.15s ease',
                }}
              />
              <span style={{ fontWeight: 500 }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Keyboard shortcuts */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 10,
          }}>
            Keyboard Shortcuts
          </h2>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {shortcuts.map(({ keys, description }, i) => (
              <div
                key={description}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {description}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {keys.map((key, ki) => (
                    <span key={ki} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <kbd className="kbd">{key}</kbd>
                      {ki < keys.length - 1 && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>+</span>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent files */}
        {openFiles.length > 0 && (
          <div>
            <h2 style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 10,
            }}>
              Recent Files
            </h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              {openFiles.map((file, i) => {
                const fileName = file.path.replace(/\\/g, '/').split('/').pop() || file.name
                const dirPath = file.path.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')
                return (
                  <button
                    key={file.path}
                    onClick={() => setActiveFile(file.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontFamily: 'var(--font-sans)',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <FileText size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fileName}</span>
                    {dirPath && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {dirPath}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
