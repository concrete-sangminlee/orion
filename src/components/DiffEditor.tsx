import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import '@/monaco/setup' // bundled Monaco + workers; must run before an Editor mounts
import { DiffEditor as MonacoDiffEditor, type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useThemeStore } from '@/store/theme'
import {
  X,
  ArrowUp,
  ArrowDown,
  Columns,
  Rows2,
} from 'lucide-react'

/* ── Props ──────────────────────────────────────────────── */

export interface DiffEditorProps {
  originalContent: string
  modifiedContent: string
  originalPath: string
  modifiedPath: string
  language?: string
  onClose?: () => void
}

/* ── Helpers ────────────────────────────────────────────── */

/** Extract the file name from a full path. */
function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

/* ── Component ──────────────────────────────────────────── */

export default function DiffEditor({
  originalContent,
  modifiedContent,
  originalPath,
  modifiedPath,
  language,
  onClose,
}: DiffEditorProps) {
  const currentMonacoTheme = useThemeStore((s) => s.activeTheme().monacoTheme)

  const [renderSideBySide, setRenderSideBySide] = useState(true)
  const [changeCount, setChangeCount] = useState(0)
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const diffEditorRef = useRef<MonacoEditor.IDiffEditor | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  /* ── Diff editor mount handler ────────────────────────── */

  const handleEditorDidMount = useCallback(
    (editor: MonacoEditor.IDiffEditor, monaco: Monaco) => {
      diffEditorRef.current = editor

      // Count changes once the diff is computed
      const updateChanges = () => {
        const lineChanges = editor.getLineChanges()
        if (lineChanges) {
          setChangeCount(lineChanges.length)
          if (lineChanges.length > 0) {
            setCurrentChangeIndex(0)
          }
        }
      }

      // The diff computation may not be ready immediately. Listen for updates.
      const modifiedEditor = editor.getModifiedEditor()
      modifiedEditor.onDidChangeModelContent(() => updateChanges())

      // Also check on a short delay for the initial computation
      const timer = setTimeout(updateChanges, 300)

      // Set up ResizeObserver for responsive layout
      if (containerRef.current) {
        resizeObserverRef.current = new ResizeObserver(() => {
          editor.layout()
        })
        resizeObserverRef.current.observe(containerRef.current)
      }

      return () => clearTimeout(timer)
    },
    [],
  )

  /* ── Toggle inline / side-by-side ─────────────────────── */

  const toggleViewMode = useCallback(() => {
    setRenderSideBySide((prev) => {
      const next = !prev
      if (diffEditorRef.current) {
        diffEditorRef.current.updateOptions({ renderSideBySide: next })
      }
      return next
    })
  }, [])

  /* ── Change navigation ────────────────────────────────── */

  const navigateToChange = useCallback(
    (direction: 'prev' | 'next') => {
      const editor = diffEditorRef.current
      if (!editor) return

      const lineChanges = editor.getLineChanges()
      if (!lineChanges || lineChanges.length === 0) return

      let nextIndex = currentChangeIndex
      if (direction === 'next') {
        nextIndex = Math.min(currentChangeIndex + 1, lineChanges.length - 1)
      } else {
        nextIndex = Math.max(currentChangeIndex - 1, 0)
      }

      setCurrentChangeIndex(nextIndex)

      // Scroll to the change in the modified editor
      const change = lineChanges[nextIndex]
      const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber
      if (targetLine > 0) {
        const modifiedEditor = editor.getModifiedEditor()
        modifiedEditor.revealLineInCenter(targetLine)
        modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 })
      }
    },
    [currentChangeIndex],
  )

  const goToPrev = useCallback(() => navigateToChange('prev'), [navigateToChange])
  const goToNext = useCallback(() => navigateToChange('next'), [navigateToChange])

  /* ── Keyboard shortcuts ───────────────────────────────── */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+Up / Alt+Down for change navigation
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        goToPrev()
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        goToNext()
      }
      // Escape to close
      if (e.key === 'Escape' && onClose) {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [goToPrev, goToNext, onClose])

  /* ── Cleanup ResizeObserver on unmount ─────────────────── */

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
    }
  }, [])

  /* ── Re-count changes when content changes ────────────── */

  useEffect(() => {
    const timer = setTimeout(() => {
      const editor = diffEditorRef.current
      if (!editor) return
      const lineChanges = editor.getLineChanges()
      if (lineChanges) {
        setChangeCount(lineChanges.length)
        setCurrentChangeIndex(0)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [originalContent, modifiedContent])

  /* ── Editor options ───────────────────────────────────── */

  const editorOptions = useMemo<MonacoEditor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: true,
      originalEditable: false,
      renderSideBySide,
      enableSplitViewResizing: true,
      renderOverviewRuler: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      lineNumbers: 'on',
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 4,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
      },
      renderIndicators: true,
      renderMarginRevertIcon: false,
      ignoreTrimWhitespace: false,
      automaticLayout: false, // We handle layout via ResizeObserver
    }),
    [renderSideBySide],
  )

  /* ── Change count label ───────────────────────────────── */

  const changeLabel = useMemo(() => {
    if (changeCount === 0) return 'No changes'
    if (changeCount === 1) return '1 change'
    return `${changeCount} changes`
  }, [changeCount])

  /* ── Styles ───────────────────────────────────────────── */

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: 36,
    padding: '0 12px',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    flexShrink: 0,
    gap: 8,
    fontSize: 12,
    userSelect: 'none',
  }

  const fileNameStyle: React.CSSProperties = {
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 200,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--text-primary)',
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  }

  const separatorStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 8,
  }

  const pillStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 10,
    background: 'rgba(88, 166, 255, 0.1)',
    color: 'var(--accent-blue)',
    whiteSpace: 'nowrap',
  }

  const iconBtnStyle: React.CSSProperties = {
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    background: 'transparent',
    opacity: 0.7,
    transition: 'all 0.15s',
    flexShrink: 0,
  }

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    ...iconBtnStyle,
    opacity: disabled ? 0.3 : 0.7,
    cursor: disabled ? 'default' : 'pointer',
  })

  const toggleBtnStyle: React.CSSProperties = {
    ...iconBtnStyle,
    padding: '0 6px',
    width: 'auto',
    gap: 4,
    fontSize: 10,
    fontWeight: 500,
  }

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header bar ──────────────────────────────────── */}
      <div style={headerStyle}>
        {/* Original file name */}
        <span style={labelStyle}>Original</span>
        <span style={fileNameStyle} title={originalPath}>
          {fileName(originalPath)}
        </span>

        <span
          style={{
            color: 'var(--text-primary)',
            opacity: 0.3,
            fontSize: 14,
            margin: '0 4px',
          }}
        >
          {'\u2194'}
        </span>

        {/* Modified file name */}
        <span style={labelStyle}>Modified</span>
        <span style={fileNameStyle} title={modifiedPath}>
          {fileName(modifiedPath)}
        </span>

        {/* Spacer */}
        <div style={separatorStyle} />

        {/* Change count */}
        <span style={pillStyle}>{changeLabel}</span>

        {/* Change navigation */}
        <button
          onClick={goToPrev}
          disabled={currentChangeIndex <= 0 || changeCount === 0}
          style={navBtnStyle(currentChangeIndex <= 0 || changeCount === 0)}
          title="Previous change (Alt+Up)"
          onMouseEnter={(e) => {
            if (currentChangeIndex > 0 && changeCount > 0) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.opacity = '1'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.opacity = currentChangeIndex <= 0 || changeCount === 0 ? '0.3' : '0.7'
          }}
        >
          <ArrowUp size={14} />
        </button>

        {changeCount > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-primary)', opacity: 0.5, minWidth: 28, textAlign: 'center' }}>
            {currentChangeIndex + 1}/{changeCount}
          </span>
        )}

        <button
          onClick={goToNext}
          disabled={currentChangeIndex >= changeCount - 1 || changeCount === 0}
          style={navBtnStyle(currentChangeIndex >= changeCount - 1 || changeCount === 0)}
          title="Next change (Alt+Down)"
          onMouseEnter={(e) => {
            if (currentChangeIndex < changeCount - 1 && changeCount > 0) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.opacity = '1'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.opacity = currentChangeIndex >= changeCount - 1 || changeCount === 0 ? '0.3' : '0.7'
          }}
        >
          <ArrowDown size={14} />
        </button>

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 18,
            background: 'var(--border-color)',
            margin: '0 4px',
            flexShrink: 0,
          }}
        />

        {/* Inline / side-by-side toggle */}
        <button
          onClick={toggleViewMode}
          style={toggleBtnStyle}
          title={renderSideBySide ? 'Switch to inline diff' : 'Switch to side-by-side diff'}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.opacity = '0.7'
          }}
        >
          {renderSideBySide ? <Rows2 size={14} /> : <Columns size={14} />}
          <span>{renderSideBySide ? 'Inline' : 'Side by Side'}</span>
        </button>

        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={iconBtnStyle}
            title="Close diff view (Esc)"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.color = '#f85149'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.opacity = '0.7'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Monaco diff editor ──────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <MonacoDiffEditor
          theme={currentMonacoTheme}
          language={language}
          original={originalContent}
          modified={modifiedContent}
          onMount={handleEditorDidMount}
          options={editorOptions}
          loading={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-primary)',
                opacity: 0.5,
                fontSize: 13,
              }}
            >
              Loading diff editor...
            </div>
          }
        />
      </div>
    </div>
  )
}
