import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { useChatStore } from '@/store/chat'
import { useChatHistoryStore, type Conversation } from '@/store/chatHistory'
import { v4 as uuid } from 'uuid'
import {
  Sparkles, Bot, User, Zap, MessageSquare,
  ArrowUp, Paperclip, AtSign, CheckCircle2, Loader2, Circle,
  ChevronDown, Copy, Check, Code, Lightbulb, Wrench, BookOpen,
  Play, Trash2, FileCode, X, Plus, PanelLeftClose, PanelLeftOpen,
  MoreHorizontal, Pencil, RotateCw, TextCursorInput, Eye, Settings2,
  Square, Search, TestTube, Pin, PinOff, GitFork, FilePlus, Timer,
  Gauge, Globe, Brain, Rocket, Cpu, Star, ExternalLink,
} from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useFileStore } from '@/store/files'
import { useSettingsStore } from '@/store/settings'
import { getCurrentContext, buildSystemPrompt, getContextSummary, type CodeContext } from '@/utils/codeContext'

/* ── Model definitions ─────────────────────────────────── */

type ModelCapability = 'fast' | 'smart' | 'code' | 'reasoning' | 'vision'

interface ModelDef {
  id: string
  label: string
  color: string
  icon?: string
  badge?: string
  capabilities?: ModelCapability[]
}

const capabilityMeta: Record<ModelCapability, { label: string; color: string; Icon: typeof Rocket }> = {
  fast: { label: 'Fast', color: '#3fb950', Icon: Rocket },
  smart: { label: 'Smart', color: '#bc8cff', Icon: Brain },
  code: { label: 'Code', color: '#58a6ff', Icon: Code },
  reasoning: { label: 'Reasoning', color: '#f78166', Icon: Lightbulb },
  vision: { label: 'Vision', color: '#e2b657', Icon: Eye },
}

const apiModels: ModelDef[] = [
  { id: 'Claude Opus', label: 'Claude', color: '#bc8cff', badge: 'Opus', capabilities: ['smart', 'code', 'reasoning'] },
  { id: 'GPT-5.3', label: 'GPT-5', color: '#3fb950', badge: '5.3', capabilities: ['smart', 'code', 'vision'] },
  { id: 'Kimi K2.5', label: 'Kimi', color: '#f78166', badge: 'K2.5', capabilities: ['fast', 'reasoning'] },
  { id: 'Gemini', label: 'Gemini', color: '#58a6ff', badge: 'Pro', capabilities: ['smart', 'vision', 'code'] },
]

const nvidiaModels: ModelDef[] = [
  { id: 'NVIDIA Llama', label: 'Llama 3.3', color: '#76b900', badge: '3.3', capabilities: ['fast', 'code'] },
  { id: 'NVIDIA Nemotron', label: 'Nemotron', color: '#76b900', badge: 'NIM', capabilities: ['smart', 'reasoning'] },
  { id: 'DeepSeek R1', label: 'DeepSeek', color: '#76b900', badge: 'R1', capabilities: ['reasoning', 'code'] },
  { id: 'Qwen 2.5', label: 'Qwen', color: '#76b900', badge: '2.5', capabilities: ['fast', 'code'] },
]

const customEndpointModel: ModelDef = {
  id: '__custom_endpoint__',
  label: 'Custom API',
  color: '#8b949e',
  badge: 'API',
  capabilities: [],
}

/* ── Simple markdown renderer ──────────────────────────── */

function renderMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let blockKey = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push(
        <CodeBlock key={blockKey++} language={lang} code={codeLines.join('\n')} />
      )
      continue
    }

    // Headers
    if (line.startsWith('### ')) {
      blocks.push(
        <h4
          key={blockKey++}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '14px 0 6px',
            lineHeight: 1.4,
          }}
        >
          {renderInline(line.slice(4))}
        </h4>
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push(
        <h3
          key={blockKey++}
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '16px 0 6px',
            lineHeight: 1.4,
          }}
        >
          {renderInline(line.slice(3))}
        </h3>
      )
      i++
      continue
    }
    if (line.startsWith('# ')) {
      blocks.push(
        <h2
          key={blockKey++}
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '18px 0 8px',
            lineHeight: 1.4,
          }}
        >
          {renderInline(line.slice(2))}
        </h2>
      )
      i++
      continue
    }

    // Bullet lists
    if (/^[\s]*[-*]\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        const content = lines[i].replace(/^[\s]*[-*]\s/, '')
        items.push(
          <li
            key={items.length}
            style={{
              fontSize: 12.5,
              lineHeight: 1.65,
              color: 'var(--text-primary)',
              paddingLeft: 4,
              position: 'relative',
            }}
          >
            {renderInline(content)}
          </li>
        )
        i++
      }
      blocks.push(
        <ul
          key={blockKey++}
          style={{
            margin: '6px 0',
            paddingLeft: 18,
            listStyleType: 'disc',
          }}
        >
          {items}
        </ul>
      )
      continue
    }

    // Numbered lists
    if (/^\d+\.\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const content = lines[i].replace(/^\d+\.\s/, '')
        items.push(
          <li
            key={items.length}
            style={{
              fontSize: 12.5,
              lineHeight: 1.65,
              color: 'var(--text-primary)',
              paddingLeft: 4,
            }}
          >
            {renderInline(content)}
          </li>
        )
        i++
      }
      blocks.push(
        <ol
          key={blockKey++}
          style={{
            margin: '6px 0',
            paddingLeft: 18,
            listStyleType: 'decimal',
          }}
        >
          {items}
        </ol>
      )
      continue
    }

    // Empty lines
    if (line.trim() === '') {
      i++
      continue
    }

    // Regular paragraph — collect consecutive non-empty lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].startsWith('#') &&
      !/^[\s]*[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p
          key={blockKey++}
          style={{
            fontSize: 12.5,
            lineHeight: 1.65,
            color: 'var(--text-primary)',
            margin: '4px 0',
            wordBreak: 'break-word',
          }}
        >
          {renderInline(paraLines.join(' '))}
        </p>
      )
    }
  }

  return blocks
}

/** Renders inline formatting: bold, italic, inline code */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Match: `code`, **bold**, *italic*
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    // Push text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const segment = match[0]
    if (segment.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          style={{
            fontSize: '0.9em',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'rgba(255,255,255,0.06)',
            color: '#e2b657',
            padding: '1px 5px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {segment.slice(1, -1)}
        </code>
      )
    } else if (segment.startsWith('**')) {
      parts.push(
        <strong key={key++} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {segment.slice(2, -2)}
        </strong>
      )
    } else if (segment.startsWith('*')) {
      parts.push(
        <em key={key++} style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}>
          {segment.slice(1, -1)}
        </em>
      )
    }
    lastIndex = match.index + segment.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

/* ── Code block component with copy ────────────────────── */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [applied, setApplied] = useState(false)
  const [showDiffPreview, setShowDiffPreview] = useState(false)
  const [createdFile, setCreatedFile] = useState(false)
  const { openFiles, activeFilePath, updateFileContent } = useEditorStore()
  const { addToast } = useToastStore()

  const handleCreateNewFile = async () => {
    // Determine a file extension from the language
    const extMap: Record<string, string> = {
      javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx',
      python: 'py', ruby: 'rb', go: 'go', rust: 'rs', java: 'java',
      css: 'css', html: 'html', json: 'json', yaml: 'yml', bash: 'sh',
      markdown: 'md', csharp: 'cs', cpp: 'cpp', c: 'c', sql: 'sql',
    }
    const langKey = language.toLowerCase()
    const ext = extMap[langKey] || extMap[langMap[langKey]] || 'txt'
    const fileName = `untitled_${Date.now()}.${ext}`
    try {
      // Dispatch event to create a new file with the code content
      window.dispatchEvent(
        new CustomEvent('orion:create-file-from-chat', {
          detail: { fileName, content: code, language: ext },
        }),
      )
      addToast({ type: 'success', message: `Creating new file: ${fileName}` })
      setCreatedFile(true)
      setTimeout(() => setCreatedFile(false), 2000)
    } catch {
      addToast({ type: 'error', message: 'Failed to create file' })
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleApplyClick = () => {
    const activeFile = openFiles.find((f) => f.path === activeFilePath)
    if (!activeFile || !activeFilePath) {
      addToast({ type: 'error', message: 'No file open to apply code' })
      return
    }
    setShowDiffPreview(true)
  }

  const handleApplyConfirm = async () => {
    if (!activeFilePath) return
    updateFileContent(activeFilePath, code)
    try {
      await window.api.writeFile(activeFilePath, code)
    } catch {
      // file was still updated in-memory
    }
    const filename = activeFilePath.split(/[\\/]/).pop() || activeFilePath
    addToast({ type: 'success', message: `Code applied to ${filename}` })
    setApplied(true)
    setShowDiffPreview(false)
    setTimeout(() => setApplied(false), 2000)
  }

  const handleInsertAtCursor = () => {
    const activeFile = openFiles.find((f) => f.path === activeFilePath)
    if (!activeFile || !activeFilePath) {
      addToast({ type: 'error', message: 'No file open to insert code' })
      return
    }
    // Dispatch event for the editor to insert at cursor position
    window.dispatchEvent(
      new CustomEvent('orion:insert-at-cursor', {
        detail: { code, filePath: activeFilePath },
      }),
    )
    addToast({ type: 'success', message: 'Code inserted at cursor position' })
  }

  // Map common language aliases to what react-syntax-highlighter expects
  const langMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    yml: 'yaml',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    md: 'markdown',
    cs: 'csharp',
    'c++': 'cpp',
    'c#': 'csharp',
  }
  const highlightLang = langMap[language.toLowerCase()] || language.toLowerCase() || 'text'

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: '#282c34',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3"
        style={{
          height: 34,
          background: 'rgba(255,255,255,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              color: '#0d1117',
              background: highlightLang === 'typescript' || highlightLang === 'tsx' ? '#3178c6'
                : highlightLang === 'javascript' || highlightLang === 'jsx' ? '#f1e05a'
                : highlightLang === 'python' ? '#3572A5'
                : highlightLang === 'rust' ? '#dea584'
                : highlightLang === 'go' ? '#00ADD8'
                : highlightLang === 'java' ? '#b07219'
                : highlightLang === 'css' ? '#563d7c'
                : highlightLang === 'html' ? '#e34c26'
                : highlightLang === 'bash' ? '#89e051'
                : highlightLang === 'json' ? '#292929'
                : 'var(--text-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              textTransform: 'lowercase',
              letterSpacing: '0.02em',
              padding: '2px 7px',
              borderRadius: 4,
              lineHeight: 1.4,
            }}
          >
            {highlightLang || 'code'}
          </span>
          <span
            style={{
              fontSize: 9.5,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {code.split('\n').length} lines
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleApplyClick}
            className="flex items-center gap-1 transition-colors duration-100"
            title="Apply code to active file (shows diff preview)"
            style={{
              fontSize: 10,
              color: applied ? 'var(--accent-green)' : 'var(--accent)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '3px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              if (!applied) e.currentTarget.style.color = 'var(--accent-purple)'
            }}
            onMouseLeave={(e) => {
              if (!applied) e.currentTarget.style.color = 'var(--accent)'
            }}
          >
            {applied ? <Check size={11} /> : <Play size={11} />}
            {applied ? 'Applied' : 'Apply'}
          </button>
          <button
            onClick={handleInsertAtCursor}
            className="flex items-center gap-1 transition-colors duration-100"
            title="Insert code at cursor position"
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '3px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent-purple)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <TextCursorInput size={11} />
            Insert
          </button>
          <button
            onClick={handleCreateNewFile}
            className="flex items-center gap-1 transition-colors duration-100"
            title="Create a new file with this code"
            style={{
              fontSize: 10,
              color: createdFile ? 'var(--accent-green)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '3px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              if (!createdFile) e.currentTarget.style.color = 'var(--accent-green)'
            }}
            onMouseLeave={(e) => {
              if (!createdFile) e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            {createdFile ? <Check size={11} /> : <FilePlus size={11} />}
            {createdFile ? 'Created' : 'New File'}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 transition-colors duration-100"
            title="Copy code to clipboard"
            style={{
              fontSize: 10,
              color: copied ? 'var(--accent-green)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '3px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              if (!copied) e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            onMouseLeave={(e) => {
              if (!copied) e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Diff preview panel */}
      {showDiffPreview && (() => {
        const activeFile = openFiles.find((f) => f.path === activeFilePath)
        const currentContent = activeFile?.content || ''
        const currentLines = currentContent.split('\n')
        const newLines = code.split('\n')
        return (
          <div style={{
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.2)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={11} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Diff Preview
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  {activeFile?.name || 'file'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={handleApplyConfirm}
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--accent-green)',
                    background: 'rgba(63,185,80,0.15)',
                    color: 'var(--accent-green)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Confirm Apply
                </button>
                <button
                  onClick={() => setShowDiffPreview(false)}
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
            <div style={{
              maxHeight: 200,
              overflow: 'auto',
              padding: '6px 0',
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
              fontSize: 11,
              lineHeight: 1.6,
            }}>
              {/* Show removed lines (current file, first few lines) */}
              {currentLines.slice(0, Math.min(currentLines.length, 8)).map((line, i) => (
                <div key={`old-${i}`} style={{
                  padding: '0 10px',
                  background: 'rgba(248,81,73,0.1)',
                  color: '#f85149',
                }}>
                  <span style={{ opacity: 0.5, marginRight: 8, userSelect: 'none' }}>-</span>
                  {line}
                </div>
              ))}
              {currentLines.length > 8 && (
                <div style={{ padding: '2px 10px', color: 'var(--text-muted)', fontSize: 10 }}>
                  ... {currentLines.length - 8} more lines removed
                </div>
              )}
              {/* Show added lines (new code) */}
              {newLines.slice(0, Math.min(newLines.length, 8)).map((line, i) => (
                <div key={`new-${i}`} style={{
                  padding: '0 10px',
                  background: 'rgba(63,185,80,0.1)',
                  color: '#3fb950',
                }}>
                  <span style={{ opacity: 0.5, marginRight: 8, userSelect: 'none' }}>+</span>
                  {line}
                </div>
              ))}
              {newLines.length > 8 && (
                <div style={{ padding: '2px 10px', color: 'var(--text-muted)', fontSize: 10 }}>
                  ... {newLines.length - 8} more lines added
                </div>
              )}
            </div>
          </div>
        )
      })()}
      {/* Syntax-highlighted code */}
      <SyntaxHighlighter
        language={highlightLang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          fontSize: 12,
          lineHeight: 1.6,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          tabSize: 2,
        }}
        codeTagProps={{
          style: {
            fontFamily:
              "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
          },
        }}
        showLineNumbers={true}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: 12,
          color: 'rgba(139,148,158,0.35)',
          fontSize: 11,
          userSelect: 'none',
          textAlign: 'right',
        }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

/* ── Timestamp formatter ──────────────────────────────── */

function formatTime(ts: number) {
  const d = new Date(ts)
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  const m = minutes.toString().padStart(2, '0')
  return `${h}:${m} ${ampm}`
}

/* ── Thinking / streaming indicator ───────────────────── */

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 0' }}>
      <span className="thinking-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '0s' }} />
      <span className="thinking-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
      <span className="thinking-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
      <style>{`
        @keyframes thinking {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

function StreamingDots({ streamStats }: { streamStats?: { tokensPerSec: number; elapsed: number; estimatedRemaining: number } | null }) {
  return (
    <div className="flex items-center gap-1" style={{ padding: '12px 0' }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          flexShrink: 0,
          marginTop: 1,
          background: 'linear-gradient(135deg, rgba(188,140,255,0.15), rgba(88,166,255,0.15))',
          border: '1px solid rgba(188,140,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Bot size={12} style={{ color: 'var(--accent-purple)' }} />
      </div>
      <div className="flex items-center gap-1 ml-2.5" style={{ height: 24 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent-purple)',
              opacity: 0.4,
              animation: `thinking-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
        <style>{`
          @keyframes thinking-dot {
            0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
      {/* Streaming speed stats */}
      {streamStats && streamStats.tokensPerSec > 0 && (
        <div className="flex items-center gap-2 ml-3" style={{ height: 24 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 9,
            color: 'var(--accent-green)',
            fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(63,185,80,0.08)',
          }}>
            <Gauge size={8} />
            {streamStats.tokensPerSec.toFixed(1)} tok/s
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 9,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <Timer size={8} />
            {streamStats.elapsed.toFixed(1)}s
          </span>
          {streamStats.estimatedRemaining > 0 && (
            <span style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.7,
            }}>
              ~{streamStats.estimatedRemaining.toFixed(0)}s
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Message bubble ────────────────────────────────────── */

function MessageBubble({
  message,
  showThinking,
  onRegenerate,
  isPinned,
  onTogglePin,
  onDelete,
  onEdit,
  onFork,
  streamStats,
}: {
  message: ChatMessage
  showThinking?: boolean
  onRegenerate?: (msgId: string) => void
  isPinned?: boolean
  onTogglePin?: (msgId: string) => void
  onDelete?: (msgId: string) => void
  onEdit?: (msgId: string, newContent: string) => void
  onFork?: (msgId: string) => void
  streamStats?: { tokensPerSec: number; elapsed: number; estimatedRemaining: number } | null
}) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [msgCopied, setMsgCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const { addToast } = useToastStore()
  const rendered = useMemo(
    () => (isUser ? null : renderMarkdown(message.content)),
    [message.content, isUser],
  )

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(message.content)
    setMsgCopied(true)
    setTimeout(() => setMsgCopied(false), 2000)
  }

  const handleInsertCodeToEditor = () => {
    const { activeFilePath, openFiles } = useEditorStore.getState()
    const activeFile = openFiles.find((f) => f.path === activeFilePath)
    if (!activeFile || !activeFilePath) {
      addToast({ type: 'error', message: 'No file open to insert code' })
      return
    }
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g
    const matches = [...message.content.matchAll(codeBlockRegex)]
    if (matches.length === 0) {
      addToast({ type: 'info', message: 'No code blocks found in message' })
      return
    }
    const allCode = matches.map((m) => m[1].trim()).join('\n\n')
    window.dispatchEvent(
      new CustomEvent('orion:insert-at-cursor', {
        detail: { code: allCode, filePath: activeFilePath },
      }),
    )
    addToast({ type: 'success', message: 'Code inserted at cursor position' })
  }

  const handleStartEdit = () => {
    setEditContent(message.content)
    setIsEditing(true)
    setTimeout(() => editRef.current?.focus(), 0)
  }

  const handleSubmitEdit = () => {
    const trimmed = editContent.trim()
    if (trimmed && trimmed !== message.content) {
      onEdit?.(message.id, trimmed)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent(message.content)
  }

  const actionBtnStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--bg-tertiary)',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }

  return (
    <div
      className="chat-message group"
      style={{
        padding: '10px 0',
        position: 'relative',
        ...(isPinned
          ? {
              background: 'rgba(188,140,255,0.04)',
              borderLeft: '2px solid var(--accent-purple)',
              paddingLeft: 10,
              marginLeft: -12,
              marginRight: -12,
              paddingRight: 12,
            }
          : isUser
            ? {
                background: 'rgba(88, 166, 255, 0.06)',
                borderLeft: '2px solid var(--accent)',
                paddingLeft: 10,
                marginLeft: -12,
                marginRight: -12,
                paddingRight: 12,
              }
            : {}),
      }}
    >
      {/* Pinned indicator */}
      {isPinned && (
        <div style={{
          position: 'absolute',
          top: 2,
          left: isPinned && isUser ? 2 : -8,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
        }}>
          <Pin size={9} style={{ color: 'var(--accent-purple)', transform: 'rotate(-45deg)' }} />
          <span style={{ fontSize: 8, color: 'var(--accent-purple)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pinned
          </span>
        </div>
      )}

      {/* Hover action toolbar */}
      {message.content.trim().length > 0 && (
        <div
          className="chat-msg-actions"
          style={{
            position: 'absolute',
            top: isPinned ? 16 : 4,
            right: 4,
            display: 'flex',
            gap: 2,
            opacity: 0,
            transition: 'opacity 0.15s',
            zIndex: 5,
          }}
        >
          {/* Copy - available for both user and assistant */}
          <button
            onClick={handleCopyMessage}
            title={msgCopied ? 'Copied!' : 'Copy message'}
            style={actionBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
          >
            {msgCopied ? <Check size={12} /> : <Copy size={12} />}
          </button>

          {/* Pin/Unpin */}
          {onTogglePin && (
            <button
              onClick={() => onTogglePin(message.id)}
              title={isPinned ? 'Unpin message' : 'Pin message'}
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          )}

          {/* Edit (user messages only) */}
          {isUser && onEdit && (
            <button
              onClick={handleStartEdit}
              title="Edit and resend"
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              <Pencil size={12} />
            </button>
          )}

          {/* Regenerate (assistant messages only) */}
          {isAssistant && onRegenerate && (
            <button
              onClick={() => onRegenerate(message.id)}
              title="Regenerate response"
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              <RotateCw size={12} />
            </button>
          )}

          {/* Insert code (assistant messages only) */}
          {isAssistant && (
            <button
              onClick={handleInsertCodeToEditor}
              title="Insert code blocks to editor"
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              <Code size={12} />
            </button>
          )}

          {/* Fork conversation from this point */}
          {onFork && (
            <button
              onClick={() => onFork(message.id)}
              title="Fork conversation from here"
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#3fb950'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              <GitFork size={12} />
            </button>
          )}

          {/* Delete message */}
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              title="Delete message"
              style={actionBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#f85149'; e.currentTarget.style.background = 'rgba(248,81,73,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-tertiary)' }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}

      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        {isUser ? (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              flexShrink: 0,
              marginTop: 1,
              background: 'rgba(88,166,255,0.1)',
              border: '1px solid rgba(88,166,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <User size={12} style={{ color: 'var(--accent)' }} />
          </div>
        ) : (
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-purple))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            {message.agentName?.[0] || 'A'}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: isUser ? 'var(--text-primary)' : 'var(--accent-purple)',
              }}
            >
              {isUser ? 'You' : message.agentName || 'AI'}
            </span>
            {message.model && (
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {message.model}
              </span>
            )}
          </div>

          {/* Message body */}
          {isUser ? (
            isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  ref={editRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitEdit() }
                    if (e.key === 'Escape') handleCancelEdit()
                  }}
                  style={{
                    width: '100%',
                    minHeight: 50,
                    maxHeight: 200,
                    padding: '8px 10px',
                    fontSize: 12.5,
                    lineHeight: 1.65,
                    color: 'var(--text-primary)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--accent)',
                    borderRadius: 6,
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleSubmitEdit}
                    style={{
                      fontSize: 10,
                      padding: '3px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--accent)',
                      background: 'rgba(88,166,255,0.15)',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Save & Resend
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      fontSize: 10,
                      padding: '3px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {message.content}
              </div>
            )
          ) : (
            <div>
              {rendered}
              {showThinking && <ThinkingIndicator />}
              {/* Streaming stats */}
              {streamStats && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 6,
                  padding: '4px 0',
                }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    color: 'var(--accent-green)',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    <Gauge size={9} />
                    {streamStats.tokensPerSec.toFixed(1)} tok/s
                  </span>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    <Timer size={9} />
                    {streamStats.elapsed.toFixed(1)}s
                  </span>
                  {streamStats.estimatedRemaining > 0 && (
                    <span style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      ~{streamStats.estimatedRemaining.toFixed(0)}s left
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Message timestamp below content */}
          <div
            style={{
              fontSize: 9.5,
              color: 'var(--text-muted)',
              marginTop: 4,
              opacity: 0.7,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(message.timestamp)}
          </div>

          {/* Task Progress */}
          {message.taskProgress && (
            <div
              style={{
                marginTop: 10,
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              {message.taskProgress.map((task, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  style={{ padding: '3px 0', fontSize: 11 }}
                >
                  {task.status === 'done' ? (
                    <CheckCircle2
                      size={13}
                      style={{ color: 'var(--accent-green)', flexShrink: 0 }}
                    />
                  ) : task.status === 'working' ? (
                    <Loader2
                      size={13}
                      className="anim-spin"
                      style={{ color: 'var(--accent)', flexShrink: 0 }}
                    />
                  ) : (
                    <Circle
                      size={13}
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />
                  )}
                  <span
                    style={{
                      color:
                        task.status === 'done'
                          ? 'var(--text-muted)'
                          : 'var(--text-primary)',
                      textDecoration:
                        task.status === 'done' ? 'line-through' : 'none',
                      opacity: task.status === 'done' ? 0.7 : 1,
                    }}
                  >
                    {task.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Model selector dropdown ───────────────────────────── */

function ModelDropdown({
  models,
  selectedModel,
  onSelect,
  customEndpoint,
  onCustomEndpointChange,
}: {
  models: ModelDef[]
  selectedModel: string
  onSelect: (id: string) => void
  customEndpoint?: string
  onCustomEndpointChange?: (url: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customUrl, setCustomUrl] = useState(customEndpoint || '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCustomInput(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = models.find((m) => m.id === selectedModel) || (selectedModel === '__custom_endpoint__' ? customEndpointModel : null)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 transition-colors duration-100"
        style={{
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 5,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          color: current?.color || 'var(--text-muted)',
          fontWeight: 500,
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-bright)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: current?.color || 'var(--text-muted)',
            flexShrink: 0,
          }}
        />
        {current?.label || selectedModel}
        {current?.badge && (
          <span style={{
            fontSize: 8,
            padding: '0 3px',
            borderRadius: 3,
            background: (current.color || 'var(--text-muted)') + '20',
            color: current.color,
            fontWeight: 700,
            lineHeight: 1.4,
          }}>
            {current.badge}
          </span>
        )}
        <ChevronDown
          size={10}
          style={{
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            minWidth: 240,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 50,
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          {/* API Models */}
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              padding: '4px 8px 2px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            API Models
          </div>
          {models
            .filter((m) => !nvidiaModels.some((n) => n.id === m.id) && m.id !== '__custom_endpoint__')
            .map((model) => (
              <DropdownItem
                key={model.id}
                model={model}
                isSelected={selectedModel === model.id}
                onSelect={() => {
                  onSelect(model.id)
                  setOpen(false)
                }}
              />
            ))}

          {/* NIM Divider */}
          <div
            style={{
              height: 1,
              background: 'var(--border)',
              margin: '4px 8px',
            }}
          />
          <div
            style={{
              fontSize: 9,
              color: '#76b900',
              padding: '4px 8px 2px',
              fontWeight: 600,
              letterSpacing: '0.06em',
            }}
          >
            NVIDIA NIM
          </div>
          {models
            .filter((m) => nvidiaModels.some((n) => n.id === m.id))
            .map((model) => (
              <DropdownItem
                key={model.id}
                model={model}
                isSelected={selectedModel === model.id}
                onSelect={() => {
                  onSelect(model.id)
                  setOpen(false)
                }}
              />
            ))}

          {/* Custom Endpoint */}
          <div
            style={{
              height: 1,
              background: 'var(--border)',
              margin: '4px 8px',
            }}
          />
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              padding: '4px 8px 2px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Custom
          </div>
          <button
            onClick={() => {
              setShowCustomInput(!showCustomInput)
              if (!showCustomInput) {
                onSelect('__custom_endpoint__')
              }
            }}
            className="flex items-center gap-2 w-full transition-colors duration-75"
            style={{
              fontSize: 11,
              padding: '5px 8px',
              borderRadius: 5,
              background: selectedModel === '__custom_endpoint__' ? 'rgba(139,148,158,0.15)' : 'transparent',
              color: selectedModel === '__custom_endpoint__' ? '#8b949e' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              if (selectedModel !== '__custom_endpoint__')
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              if (selectedModel !== '__custom_endpoint__')
                e.currentTarget.style.background = 'transparent'
            }}
          >
            <Globe size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{ flex: 1 }}>Custom API Endpoint</span>
            <ExternalLink size={10} style={{ opacity: 0.4 }} />
          </button>
          {showCustomInput && (
            <div style={{ padding: '4px 8px 6px' }}>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://api.example.com/v1/chat"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onCustomEndpointChange?.(customUrl)
                    setOpen(false)
                    setShowCustomInput(false)
                  }
                }}
                style={{
                  width: '100%',
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
              <button
                onClick={() => {
                  onCustomEndpointChange?.(customUrl)
                  setOpen(false)
                  setShowCustomInput(false)
                }}
                style={{
                  marginTop: 4,
                  fontSize: 9,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--accent)',
                  background: 'rgba(88,166,255,0.1)',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Connect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DropdownItem({
  model,
  isSelected,
  onSelect,
}: {
  model: ModelDef
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-2 w-full transition-colors duration-75"
      style={{
        fontSize: 11,
        padding: '5px 8px',
        borderRadius: 5,
        background: isSelected ? model.color + '15' : 'transparent',
        color: isSelected ? model.color : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: model.color,
          flexShrink: 0,
          opacity: isSelected ? 1 : 0.5,
        }}
      />
      <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
        {model.label}
        {model.badge && (
          <span style={{
            fontSize: 8,
            padding: '0 3px',
            borderRadius: 3,
            background: model.color + '20',
            color: model.color,
            fontWeight: 700,
            lineHeight: 1.4,
          }}>
            {model.badge}
          </span>
        )}
      </span>
      {/* Capability tags */}
      {model.capabilities && model.capabilities.length > 0 && (
        <div style={{ display: 'flex', gap: 2 }}>
          {model.capabilities.slice(0, 3).map((cap) => {
            const meta = capabilityMeta[cap]
            return (
              <span
                key={cap}
                title={meta.label}
                style={{
                  fontSize: 7,
                  padding: '0 3px',
                  borderRadius: 2,
                  background: meta.color + '15',
                  color: meta.color,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1.6,
                  textTransform: 'uppercase',
                }}
              >
                {meta.label}
              </span>
            )
          })}
        </div>
      )}
      {isSelected && (
        <Check size={11} style={{ color: model.color, flexShrink: 0 }} />
      )}
    </button>
  )
}

/* ── Relative date formatter for conversation list ─────── */

function formatRelativeDate(ts: number): string {
  const now = Date.now()
  const diff = Math.floor((now - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(ts).toLocaleDateString()
}

/* ── Conversation list sidebar ─────────────────────────── */

function ConversationSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const {
    conversations,
    activeConversationId,
    createConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
  } = useChatHistoryStore()
  const { loadMessages, clearMessages } = useChatStore()
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleNewChat = useCallback(() => {
    createConversation()
    clearMessages()
  }, [createConversation, clearMessages])

  const handleSwitch = useCallback(
    (convo: Conversation) => {
      if (convo.id === activeConversationId) return
      switchConversation(convo.id)
      loadMessages(convo.messages)
    },
    [activeConversationId, switchConversation, loadMessages],
  )

  const handleDelete = useCallback(
    (id: string) => {
      const historyStore = useChatHistoryStore.getState()
      deleteConversation(id)
      setMenuOpenId(null)
      // If we deleted the active one, load the next conversation's messages
      if (id === activeConversationId) {
        const remaining = historyStore.conversations.filter((c) => c.id !== id)
        if (remaining.length > 0) {
          loadMessages(remaining[0].messages)
        } else {
          clearMessages()
        }
      }
    },
    [activeConversationId, deleteConversation, loadMessages, clearMessages],
  )

  const handleRenameStart = useCallback(
    (convo: Conversation) => {
      setRenamingId(convo.id)
      setRenameValue(convo.title)
      setMenuOpenId(null)
    },
    [],
  )

  const handleRenameSubmit = useCallback(
    (id: string) => {
      const trimmed = renameValue.trim()
      if (trimmed) {
        renameConversation(id, trimmed)
      }
      setRenamingId(null)
    },
    [renameValue, renameConversation],
  )

  // Sorted by most recently updated
  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  )

  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 6,
          gap: 4,
        }}
      >
        <button
          onClick={onToggle}
          title="Show conversations"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <PanelLeftOpen size={14} />
        </button>
        <button
          onClick={handleNewChat}
          title="New chat"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(88,166,255,0.1)'
            e.currentTarget.style.color = 'var(--accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Sidebar header */}
      <div
        className="flex items-center px-2"
        style={{
          height: 38,
          borderBottom: '1px solid var(--border)',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggle}
          title="Hide conversations"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <PanelLeftClose size={14} />
        </button>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          History
        </span>
        <button
          onClick={handleNewChat}
          title="New chat"
          className="flex items-center gap-1"
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 5,
            background: 'rgba(88,166,255,0.1)',
            border: '1px solid rgba(88,166,255,0.2)',
            color: 'var(--accent)',
            fontWeight: 500,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(88,166,255,0.18)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(88,166,255,0.1)'
          }}
        >
          <Plus size={10} />
          New
        </button>
      </div>

      {/* Conversation list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 4,
        }}
      >
        {sortedConversations.length === 0 ? (
          <div
            style={{
              padding: '20px 12px',
              textAlign: 'center',
              fontSize: 11,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            No conversations yet.
            <br />
            Start a new chat!
          </div>
        ) : (
          sortedConversations.map((convo) => {
            const isActive = convo.id === activeConversationId
            const isRenaming = renamingId === convo.id

            return (
              <div
                key={convo.id}
                className="group"
                style={{
                  position: 'relative',
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: isActive ? 'rgba(88,166,255,0.08)' : 'transparent',
                  border: isActive
                    ? '1px solid rgba(88,166,255,0.15)'
                    : '1px solid transparent',
                  marginBottom: 2,
                  transition: 'background 0.1s, border-color 0.1s',
                }}
                onClick={() => handleSwitch(convo)}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                {/* Title row */}
                <div className="flex items-center gap-1" style={{ minHeight: 18 }}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(convo.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(convo.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--accent)',
                        borderRadius: 3,
                        padding: '1px 4px',
                        outline: 'none',
                        minWidth: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        flex: 1,
                        fontSize: 11,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {convo.title}
                    </span>
                  )}

                  {/* Hover actions */}
                  {!isRenaming && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpenId(menuOpenId === convo.id ? null : convo.id)
                      }}
                      className="transition-opacity duration-75"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        opacity: menuOpenId === convo.id ? 1 : 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                        e.currentTarget.style.color = 'var(--text-secondary)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'var(--text-muted)'
                      }}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  )}
                </div>

                {/* Meta row */}
                <div
                  className="flex items-center gap-2"
                  style={{ marginTop: 2 }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {formatRelativeDate(convo.updatedAt)}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {convo.messages.length} msg{convo.messages.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Context menu */}
                {menuOpenId === convo.id && (
                  <div
                    ref={menuRef}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 4,
                      zIndex: 60,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: 3,
                      boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                      minWidth: 120,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleRenameStart(convo)}
                      className="flex items-center gap-2 w-full"
                      style={{
                        fontSize: 11,
                        padding: '5px 8px',
                        borderRadius: 4,
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <Pencil size={11} />
                      Rename
                    </button>
                    <button
                      onClick={() => handleDelete(convo.id)}
                      className="flex items-center gap-2 w-full"
                      style={{
                        fontSize: 11,
                        padding: '5px 8px',
                        borderRadius: 4,
                        background: 'transparent',
                        color: '#f85149',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(248,81,73,0.08)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <Trash2 size={11} />
                      Delete
                    </button>
                  </div>
                )}

                {/* Make the hover "..." visible on group hover via CSS */}
                <style>{`
                  .group:hover button[class*="transition-opacity"] {
                    opacity: 1 !important;
                  }
                `}</style>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ── Main chat panel ───────────────────────────────────── */

export default function ChatPanel() {
  const {
    messages,
    mode,
    selectedModel,
    isStreaming,
    addMessage,
    setMode,
    setModel,
    clearMessages,
    loadMessages,
    ollamaAvailable,
    ollamaModels,
    removeMessagesAfter,
  } = useChatStore()

  const {
    activeConversationId,
    createConversation,
  } = useChatHistoryStore()

  const { addToast } = useToastStore()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystemPromptEditor, setShowSystemPromptEditor] = useState(false)
  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(new Set())
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null)
  const [streamTokenCount, setStreamTokenCount] = useState(0)
  const [streamStats, setStreamStats] = useState<{ tokensPerSec: number; elapsed: number; estimatedRemaining: number } | null>(null)

  // On first mount, ensure there is an active conversation
  useEffect(() => {
    if (!activeConversationId) {
      createConversation()
    } else {
      // Load messages from the persisted active conversation
      const convo = useChatHistoryStore.getState().getActiveConversation()
      if (convo && convo.messages.length > 0) {
        loadMessages(convo.messages)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track streaming stats
  useEffect(() => {
    if (isStreaming && !streamStartTime) {
      setStreamStartTime(Date.now())
      setStreamTokenCount(0)
    }
    if (!isStreaming && streamStartTime) {
      setStreamStartTime(null)
      setStreamStats(null)
      setStreamTokenCount(0)
    }
  }, [isStreaming, streamStartTime])

  // Update streaming stats periodically
  useEffect(() => {
    if (!isStreaming || !streamStartTime) return
    const interval = setInterval(() => {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.role === 'assistant') {
        const tokenEstimate = Math.ceil(lastMsg.content.length / 4)
        const elapsed = (Date.now() - streamStartTime) / 1000
        const tps = elapsed > 0 ? tokenEstimate / elapsed : 0
        // Rough estimate: average response ~500 tokens
        const estimatedTotal = 500
        const remaining = tps > 0 ? Math.max(0, (estimatedTotal - tokenEstimate) / tps) : 0
        setStreamTokenCount(tokenEstimate)
        setStreamStats({
          tokensPerSec: tps,
          elapsed,
          estimatedRemaining: tokenEstimate < estimatedTotal ? remaining : 0,
        })
      }
    }, 500)
    return () => clearInterval(interval)
  }, [isStreaming, streamStartTime, messages])

  const allModels: ModelDef[] = [
    {
      id: 'Ollama',
      label: ollamaAvailable ? `Ollama (${ollamaModels[0] || 'local'})` : 'Ollama',
      color: '#76e3ea',
      badge: 'Local',
      capabilities: ['fast'] as ModelCapability[],
    },
    ...apiModels,
    ...nvidiaModels,
  ]

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const mentionRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Read settings store for the active model name
  const settingsActiveModelId = useSettingsStore((s) => s.settings.activeModelId)
  const settingsModels = useSettingsStore((s) => s.settings.models)
  const settingsActiveModel = settingsModels.find((m) => m.modelId === settingsActiveModelId)

  // Auto-resize textarea up to 6 lines
  const autoResizeTextarea = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = 20
    const maxLines = 6
    const maxHeight = lineHeight * maxLines
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px'
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  // Approximate token count (rough: ~4 chars per token)
  const charCount = input.length
  const approxTokens = Math.ceil(charCount / 4)

  // Stop generation handler
  const handleStopGeneration = useCallback(() => {
    window.api?.omoSend({ type: 'stop' })
    useChatStore.getState().setStreaming(false)
    addToast({ type: 'info', message: 'Generation stopped' })
  }, [addToast])

  /* ── File context state ────────────────────────────────── */
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  const [includeContext, setIncludeContext] = useState(true)
  const [selectionText, setSelectionText] = useState<string | null>(null)
  const [codeContext, setCodeContext] = useState<CodeContext | null>(null)
  const [contextSummary, setContextSummary] = useState<string | null>(null)

  // Refresh code context when active file or selection changes
  useEffect(() => {
    if (!includeContext) {
      setCodeContext(null)
      setContextSummary(null)
      return
    }
    const ctx = getCurrentContext({ selectionText })
    setCodeContext(ctx)
    setContextSummary(getContextSummary(ctx))
  }, [activeFilePath, selectionText, includeContext, openFiles])
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [attachedFiles, setAttachedFiles] = useState<{ path: string; name: string; content?: string }[]>([])

  // ── Slash command system ──────────────────────────────────
  const SLASH_COMMANDS = useMemo(() => [
    { command: '/edit', label: 'Edit Code', description: 'Edit selected code with instructions', icon: '✏️' },
    { command: '/explain', label: 'Explain', description: 'Explain selected code in detail', icon: '💡' },
    { command: '/fix', label: 'Fix Bug', description: 'Find and fix bugs in code', icon: '🔧' },
    { command: '/test', label: 'Generate Tests', description: 'Generate unit tests for code', icon: '🧪' },
    { command: '/refactor', label: 'Refactor', description: 'Refactor code for better quality', icon: '♻️' },
    { command: '/doc', label: 'Document', description: 'Generate documentation/comments', icon: '📝' },
    { command: '/review', label: 'Code Review', description: 'Review code for issues and improvements', icon: '👀' },
    { command: '/optimize', label: 'Optimize', description: 'Optimize code for performance', icon: '⚡' },
    { command: '/type', label: 'Add Types', description: 'Add TypeScript types and interfaces', icon: '📐' },
    { command: '/commit', label: 'Commit Message', description: 'Generate a commit message for changes', icon: '📋' },
  ], [])

  const [showSlashDropdown, setShowSlashDropdown] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)

  const filteredSlashCommands = useMemo(() => {
    if (!slashQuery) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(c =>
      c.command.includes(slashQuery.toLowerCase()) || c.label.toLowerCase().includes(slashQuery.toLowerCase())
    )
  }, [slashQuery, SLASH_COMMANDS])

  // Listen for selection context from editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail
      if (detail?.text) {
        setSelectionText(detail.text)
      }
    }
    window.addEventListener('orion:selection-for-chat', handler)
    return () => window.removeEventListener('orion:selection-for-chat', handler)
  }, [])

  // Clear selection when active file changes
  useEffect(() => {
    setSelectionText(null)
  }, [activeFilePath])

  // Close mention dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setShowMentionDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Listen for AI context-menu actions from EditorPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      const { action, selectedText, filePath, language, fullContext } = detail as {
        action: string
        selectedText: string
        filePath: string
        language: string
        fullContext?: string
      }

      if (action === 'explain') {
        // "AI: Explain Selection" -- send to chat as a user question
        const fileName = filePath?.replace(/\\/g, '/').split('/').pop() || 'unknown'
        const userMsg = `Explain this code from ${fileName}:\n\`\`\`${language}\n${selectedText}\n\`\`\``
        addMessage({
          id: uuid(),
          role: 'user',
          content: userMsg,
          timestamp: Date.now(),
        })
        // Dispatch to AI backend
        window.api?.omoSend({
          type: 'chat',
          payload: {
            message: `Please explain the following code in detail:\n\`\`\`${language}\n${selectedText}\n\`\`\``,
            mode: 'chat',
            model: selectedModel,
          },
        })
      } else if (action === 'refactor' || action === 'add-comments' || action === 'fix-issues') {
        // Build instruction per action type
        let instruction = ''
        if (action === 'refactor') {
          instruction = 'Refactor the following code for better readability, performance, and best practices.'
        } else if (action === 'add-comments') {
          instruction = 'Add clear, helpful inline comments to the following code. Keep the code unchanged, only add comments.'
        } else if (action === 'fix-issues') {
          instruction = 'Analyze the following code for bugs, potential issues, and anti-patterns, then fix them.'
        }

        const aiMessage = `You are editing code inline. The user selected this code:\n\`\`\`\n${selectedText}\n\`\`\`\n\n${fullContext ? `From this file:\n\`\`\`${language}\n${fullContext}\n\`\`\`\n\n` : ''}Instruction: ${instruction}\n\nRespond with ONLY the replacement code, no explanation, no markdown fences. Just the raw code that should replace the selection.`

        window.api?.omoSend({
          type: 'chat',
          payload: { message: aiMessage, mode: 'chat', model: 'inline-edit' },
        })

        // Listen for the response and forward it as a context-response event
        const respHandler = (evt: any) => {
          if (evt?.detail?.type === 'inline-edit-response') {
            const suggestedCode = evt.detail.content
            if (suggestedCode) {
              window.dispatchEvent(
                new CustomEvent('orion:ai-context-response', {
                  detail: {
                    action,
                    suggestedCode,
                    originalText: selectedText,
                  },
                }),
              )
            }
            window.removeEventListener('orion:inline-edit-response', respHandler)
          }
        }
        window.addEventListener('orion:inline-edit-response', respHandler)

        // Timeout fallback
        setTimeout(() => {
          window.removeEventListener('orion:inline-edit-response', respHandler)
        }, 30000)
      }
    }
    window.addEventListener('orion:ai-context-action', handler)
    return () => window.removeEventListener('orion:ai-context-action', handler)
  }, [addMessage, selectedModel])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return

    const userText = input.trim()

    // Build context-enriched message for the AI
    let aiMessage = userText
    let contextSystemPrompt = systemPrompt.trim()

    if (includeContext) {
      // Gather fresh context at send time
      const ctx = getCurrentContext({ selectionText })

      // Build intelligent system prompt with full code context
      const builtPrompt = buildSystemPrompt(ctx)
      contextSystemPrompt = contextSystemPrompt
        ? `${builtPrompt}\n\n--- User custom instructions ---\n${contextSystemPrompt}`
        : builtPrompt

      // Gather mentioned file contents (from open files by @name)
      const mentionedFileContents = mentionedFiles
        .map((path) => openFiles.find((f) => f.path === path))
        .filter(Boolean)
        .map((f) => `[Referenced file: ${f!.name}]\n\`\`\`${f!.language}\n${f!.content}\n\`\`\``)
        .join('\n\n')

      // Gather attached file contents (from workspace @file picker)
      const attachedFileContents = attachedFiles
        .map((f) => `[File: ${f.name}]\n\`\`\`\n${f.content?.substring(0, 3000) || '(content unavailable)'}\n\`\`\``)
        .join('\n\n')

      const extraFileContext = [mentionedFileContents, attachedFileContents].filter(Boolean).join('\n\n')

      // The system prompt now carries the full file context, so the user message
      // only needs to include extra @-mentioned / attached files (if any)
      if (extraFileContext) {
        aiMessage = `${extraFileContext}\n\nUser question: ${userText}`
      }
    }

    addMessage({
      id: uuid(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    })
    window.api?.omoSend({
      type: 'chat',
      payload: {
        message: aiMessage,
        mode,
        model: selectedModel,
        ...(contextSystemPrompt ? { systemPrompt: contextSystemPrompt } : {}),
      },
    })
    setInput('')
    setMentionedFiles([])
    setAttachedFiles([])
    setSelectionText(null)
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleRegenerate = useCallback(
    (msgId: string) => {
      if (isStreaming) return
      // Find the assistant message and the user message before it
      const msgIdx = messages.findIndex((m) => m.id === msgId)
      if (msgIdx === -1) return
      // Find the last user message before this assistant message
      let userMsg: ChatMessage | null = null
      for (let i = msgIdx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userMsg = messages[i]
          break
        }
      }
      if (!userMsg) return
      // Remove the assistant message and re-send
      removeMessagesAfter(msgId)
      window.api?.omoSend({
        type: 'chat',
        payload: { message: userMsg.content, mode, model: selectedModel },
      })
      addToast({ type: 'info', message: 'Regenerating response...' })
    },
    [messages, isStreaming, mode, selectedModel, removeMessagesAfter, addToast],
  )

  const handleClearChat = useCallback(() => {
    clearMessages()
    setPinnedMessages(new Set())
    addToast({ type: 'info', message: 'Chat cleared' })
  }, [clearMessages, addToast])

  const handleTogglePin = useCallback((msgId: string) => {
    setPinnedMessages((prev) => {
      const next = new Set(prev)
      if (next.has(msgId)) {
        next.delete(msgId)
        addToast({ type: 'info', message: 'Message unpinned' })
      } else {
        next.add(msgId)
        addToast({ type: 'info', message: 'Message pinned' })
      }
      return next
    })
  }, [addToast])

  const handleDeleteMessage = useCallback((msgId: string) => {
    const msgs = useChatStore.getState().messages
    const filtered = msgs.filter((m) => m.id !== msgId)
    loadMessages(filtered)
    setPinnedMessages((prev) => {
      const next = new Set(prev)
      next.delete(msgId)
      return next
    })
    addToast({ type: 'info', message: 'Message deleted' })
  }, [loadMessages, addToast])

  const handleEditMessage = useCallback((msgId: string, newContent: string) => {
    // Find the message index, update it, remove all messages after it, then resend
    const msgs = useChatStore.getState().messages
    const idx = msgs.findIndex((m) => m.id === msgId)
    if (idx === -1) return
    const updatedMsg = { ...msgs[idx], content: newContent, timestamp: Date.now() }
    const updatedMessages = [...msgs.slice(0, idx), updatedMsg]
    loadMessages(updatedMessages)
    // Resend the edited message
    window.api?.omoSend({
      type: 'chat',
      payload: { message: newContent, mode, model: selectedModel },
    })
    addToast({ type: 'info', message: 'Message edited and resent' })
  }, [loadMessages, mode, selectedModel, addToast])

  const handleForkConversation = useCallback((msgId: string) => {
    const msgs = useChatStore.getState().messages
    const idx = msgs.findIndex((m) => m.id === msgId)
    if (idx === -1) return
    // Create a new conversation with messages up to and including this one
    const forkedMessages = msgs.slice(0, idx + 1).map((m) => ({ ...m, id: uuid() }))
    createConversation()
    loadMessages(forkedMessages)
    addToast({ type: 'success', message: 'Conversation forked from this point' })
  }, [createConversation, loadMessages, addToast])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionDropdown && allMentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((prev) => (prev + 1) % allMentionResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((prev) => (prev - 1 + allMentionResults.length) % allMentionResults.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const selected = allMentionResults[mentionIndex]
        if (selected) {
          handleMentionSelect(selected)
        }
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const selected = allMentionResults[mentionIndex]
        if (selected) {
          handleMentionSelect(selected)
        }
        return
      }
    }
    // Slash command keyboard nav
    if (showSlashDropdown && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex(i => Math.min(i + 1, filteredSlashCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const cmd = filteredSlashCommands[slashIndex]
        if (cmd) {
          setInput(cmd.command + ' ')
          setShowSlashDropdown(false)
          setTimeout(autoResizeTextarea, 0)
        }
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape' && showMentionDropdown) {
      setShowMentionDropdown(false)
    }
    if (e.key === 'Escape' && showSlashDropdown) {
      setShowSlashDropdown(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)

    // Auto-resize textarea
    setTimeout(autoResizeTextarea, 0)

    // Detect @ mentions
    const cursorPos = e.target.selectionStart ?? val.length
    const textBeforeCursor = val.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (atMatch) {
      setShowMentionDropdown(true)
      setMentionQuery(atMatch[1].toLowerCase())
      setMentionIndex(0)
      setShowSlashDropdown(false)
    } else {
      setShowMentionDropdown(false)
      setMentionQuery('')
    }

    // Detect / slash commands (only at start of input)
    const slashMatch = val.match(/^\/(\S*)$/)
    if (slashMatch && !showMentionDropdown) {
      setShowSlashDropdown(true)
      setSlashQuery(slashMatch[1])
      setSlashIndex(0)
    } else {
      setShowSlashDropdown(false)
      setSlashQuery('')
    }
  }

  const handleMentionSelect = async (file: { path: string; name: string }) => {
    // Remove the @query from the input
    const cursorPos = input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)
    if (atMatch) {
      const before = input.slice(0, atMatch.index!)
      const after = input.slice(atMatch.index! + atMatch[0].length)
      setInput(before + after)
    }

    // Check if it's an open file (use mentionedFiles path)
    const isOpenFile = openFiles.some((f) => f.path === file.path)
    if (isOpenFile) {
      if (!mentionedFiles.includes(file.path)) {
        setMentionedFiles((prev) => [...prev, file.path])
      }
    } else {
      // It's a workspace file - load content and attach
      if (!attachedFiles.some((f) => f.path === file.path)) {
        try {
          const result = await window.api?.readFile(file.path)
          setAttachedFiles((prev) => [
            ...prev,
            { path: file.path, name: file.name, content: result?.content },
          ])
        } catch {
          setAttachedFiles((prev) => [
            ...prev,
            { path: file.path, name: file.name, content: undefined },
          ])
        }
      }
    }
    setShowMentionDropdown(false)
  }

  const filteredMentionFiles = openFiles.filter(
    (f) =>
      f.name.toLowerCase().includes(mentionQuery) &&
      !mentionedFiles.includes(f.path),
  )

  // Workspace files from file tree (flattened)
  const workspaceFiles = useMemo(() => {
    const fileTree = useFileStore.getState().fileTree
    const allFiles: { path: string; name: string }[] = []
    const flattenTree = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type !== 'directory') {
          allFiles.push({ path: node.path, name: node.name })
        }
        if (node.children) flattenTree(node.children)
      }
    }
    if (fileTree) flattenTree(fileTree)
    return allFiles
    // Re-derive when mention dropdown opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMentionDropdown])

  const filteredWorkspaceFiles = useMemo(() => {
    if (!showMentionDropdown) return []
    const openPaths = new Set(openFiles.map((f) => f.path))
    const attachedPaths = new Set(attachedFiles.map((f) => f.path))
    return workspaceFiles
      .filter((f) => {
        if (openPaths.has(f.path) || attachedPaths.has(f.path)) return false
        return f.name.toLowerCase().includes(mentionQuery)
      })
      .slice(0, 10)
  }, [showMentionDropdown, mentionQuery, workspaceFiles, openFiles, attachedFiles])

  // Combined mention results: open files first, then workspace files
  const allMentionResults = useMemo(() => {
    const results: { path: string; name: string; source: 'open' | 'workspace' }[] = []
    for (const f of filteredMentionFiles) {
      results.push({ path: f.path, name: f.name, source: 'open' })
    }
    for (const f of filteredWorkspaceFiles) {
      results.push({ path: f.path, name: f.name, source: 'workspace' })
    }
    return results
  }, [filteredMentionFiles, filteredWorkspaceFiles])

  return (
    <div
      className="h-full flex"
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Conversation history sidebar */}
      <ConversationSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div
        className="shrink-0 flex items-center px-3"
        style={{
          height: 38,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-tertiary)',
        }}
      >
        <Sparkles size={13} style={{ color: 'var(--accent)', marginRight: 8 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          AI Chat
        </span>

        {/* Mode Toggle */}
        <div
          className="ml-auto flex items-center"
          style={{
            background: 'var(--bg-primary)',
            borderRadius: 6,
            padding: 2,
            border: '1px solid var(--border)',
          }}
        >
          {[
            { m: 'agent' as const, label: 'Agent', Icon: Zap, color: '#3fb950' },
            { m: 'chat' as const, label: 'Chat', Icon: MessageSquare, color: '#58a6ff' },
          ].map(({ m, label, Icon, color }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex items-center gap-1 transition-all duration-150"
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 4,
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? color + '18' : 'transparent',
                color: mode === m ? color : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <Icon size={10} />
              {label}
            </button>
          ))}
        </div>
        {/* System prompt indicator */}
        {systemPrompt.trim() && (
          <button
            onClick={() => setShowSystemPromptEditor(!showSystemPromptEditor)}
            title={`System prompt active: "${systemPrompt.slice(0, 50)}${systemPrompt.length > 50 ? '...' : ''}"`}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{
              fontSize: 9,
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid rgba(188,140,255,0.3)',
              background: 'rgba(188,140,255,0.1)',
              color: 'var(--accent-purple)',
              cursor: 'pointer',
              marginLeft: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <Settings2 size={10} />
            Custom
          </button>
        )}
        {!systemPrompt.trim() && (
          <button
            onClick={() => setShowSystemPromptEditor(!showSystemPromptEditor)}
            title="Set system prompt"
            className="flex items-center justify-center transition-colors duration-100"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              marginLeft: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Settings2 size={13} />
          </button>
        )}

        {/* Clear chat */}
        <button
          onClick={handleClearChat}
          title="Clear current chat"
          className="flex items-center justify-center transition-colors duration-100"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            marginLeft: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#f85149'
            e.currentTarget.style.background = 'rgba(248,81,73,0.08)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Trash2 size={13} />
        </button>

        {/* New chat */}
        <button
          onClick={() => {
            createConversation()
            clearMessages()
          }}
          title="New chat"
          className="flex items-center justify-center transition-colors duration-100"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            marginLeft: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* System prompt editor */}
      {showSystemPromptEditor && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(188,140,255,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-purple)' }}>
              System Prompt
            </span>
            <button
              onClick={() => setShowSystemPromptEditor(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Enter custom instructions for the AI (e.g., 'You are a React expert. Always use TypeScript.')"
            style={{
              width: '100%',
              minHeight: 60,
              maxHeight: 120,
              padding: '6px 8px',
              fontSize: 11,
              lineHeight: 1.5,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
          {systemPrompt.trim() && (
            <button
              onClick={() => { setSystemPrompt(''); setShowSystemPromptEditor(false) }}
              style={{
                fontSize: 10,
                marginTop: 4,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Clear prompt
            </button>
          )}
        </div>
      )}

      {/* Hover styles for message actions */}
      <style>{`
        .chat-message:hover .chat-msg-actions { opacity: 1 !important; }
      `}</style>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3">
        {messages.length === 0 ? (
          <EmptyChat onInsertPrompt={(text) => {
            setInput(text)
            setTimeout(() => textareaRef.current?.focus(), 0)
          }} />
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1
              const isLastAssistantEmpty =
                isLast &&
                isStreaming &&
                msg.role === 'assistant' &&
                msg.content.trim().length < 10
              const isLastAssistantStreaming =
                isLast &&
                isStreaming &&
                msg.role === 'assistant'
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  showThinking={isLastAssistantEmpty}
                  onRegenerate={handleRegenerate}
                  isPinned={pinnedMessages.has(msg.id)}
                  onTogglePin={handleTogglePin}
                  onDelete={handleDeleteMessage}
                  onEdit={msg.role === 'user' ? handleEditMessage : undefined}
                  onFork={handleForkConversation}
                  streamStats={isLastAssistantStreaming ? streamStats : null}
                />
              )
            })}
            {isStreaming &&
              (messages.length === 0 ||
                messages[messages.length - 1].role !== 'assistant') && (
                <StreamingDots streamStats={streamStats} />
              )}
          </>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        {/* Context indicators panel */}
        {activeFile && (
          <div
            style={{
              borderBottom: '1px solid var(--border)',
              marginBottom: 6,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            {/* Top row: context summary */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              <FileCode size={12} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Context: {contextSummary || activeFile.name}
              </span>

              {/* Token count estimate for context */}
              {includeContext && activeFile.content && (
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                  title="Estimated tokens in context"
                >
                  ~{Math.ceil((activeFile.content?.length || 0) / 4).toLocaleString()} ctx tokens
                </span>
              )}

              {codeContext && codeContext.relatedFiles.length > 0 && (
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(63,185,80,0.1)',
                    color: '#3fb950',
                    border: '1px solid rgba(63,185,80,0.2)',
                    whiteSpace: 'nowrap',
                  }}
                  title={codeContext.relatedFiles.map((f) => f.name).join(', ')}
                >
                  {codeContext.relatedFiles.length} import{codeContext.relatedFiles.length > 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={() => setIncludeContext(!includeContext)}
                style={{
                  fontSize: 10,
                  padding: '1px 8px',
                  borderRadius: 4,
                  border: '1px solid',
                  borderColor: includeContext ? 'var(--accent)' : 'var(--border)',
                  background: includeContext ? 'rgba(88,166,255,0.1)' : 'transparent',
                  color: includeContext ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {includeContext ? 'Attached' : 'Detached'}
              </button>
            </div>

            {/* File chips row: show files in context */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {/* Active file chip */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: 'rgba(88,166,255,0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(88,166,255,0.2)',
                }}
              >
                <FileCode size={8} />
                {activeFile.name}
                <Star size={7} style={{ opacity: 0.6 }} title="Active file" />
              </span>

              {/* Selection indicator */}
              {selectionText && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: 'rgba(188,140,255,0.1)',
                    color: 'var(--accent-purple)',
                    border: '1px solid rgba(188,140,255,0.2)',
                  }}
                >
                  <TextCursorInput size={8} />
                  Selection ({selectionText.split('\n').length} lines)
                  <button
                    onClick={() => setSelectionText(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--accent-purple)',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={8} />
                  </button>
                </span>
              )}

              {/* Related file chips from imports */}
              {codeContext?.relatedFiles.slice(0, 4).map((f) => (
                <span
                  key={f.path}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: 'rgba(63,185,80,0.06)',
                    color: '#3fb950',
                    border: '1px solid rgba(63,185,80,0.15)',
                    opacity: 0.8,
                  }}
                  title={f.path}
                >
                  <FileCode size={8} />
                  {f.name}
                </span>
              ))}

              {/* Add file to context button */}
              <button
                onClick={() => {
                  setShowMentionDropdown(true)
                  setMentionQuery('')
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px dashed var(--border)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.color = 'var(--accent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.color = 'var(--text-muted)'
                }}
                title="Add file to context"
              >
                <Plus size={8} />
                Add file
              </button>
            </div>
          </div>
        )}

        {/* Mentioned files badges (open files) */}
        {mentionedFiles.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '2px 4px 6px',
            }}
          >
            {mentionedFiles.map((path) => {
              const f = openFiles.find((of) => of.path === path)
              return (
                <span
                  key={path}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(188,140,255,0.1)',
                    color: 'var(--accent-purple)',
                    border: '1px solid rgba(188,140,255,0.2)',
                  }}
                >
                  <FileCode size={10} />
                  {f?.name || path.split(/[\\/]/).pop()}
                  <button
                    onClick={() =>
                      setMentionedFiles((prev) => prev.filter((p) => p !== path))
                    }
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Attached workspace file chips */}
        {attachedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 12px' }}>
            {attachedFiles.map((file) => (
              <span
                key={file.path}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  background: 'rgba(88,166,255,0.12)',
                  border: '1px solid rgba(88,166,255,0.2)',
                  borderRadius: 12,
                  fontSize: 11,
                  color: '#58a6ff',
                }}
              >
                <FileCode size={10} />
                {file.name}
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((f) => f.path !== file.path))}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#58a6ff',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          className="transition-colors duration-150"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            position: 'relative',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          {/* @ mention dropdown */}
          {showMentionDropdown && allMentionResults.length > 0 && (
            <div
              ref={mentionRef}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: 4,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 4,
                boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
                zIndex: 50,
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {filteredMentionFiles.length > 0 && (
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    padding: '4px 8px 2px',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Open Files
                </div>
              )}
              {allMentionResults.map((item, idx) => {
                const dir = item.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0] || ''
                // Show "Workspace Files" header before the first workspace item
                const showWorkspaceHeader =
                  item.source === 'workspace' &&
                  (idx === 0 || allMentionResults[idx - 1].source !== 'workspace')
                return (
                  <div key={item.path}>
                    {showWorkspaceHeader && (
                      <div
                        style={{
                          fontSize: 9,
                          color: 'var(--text-muted)',
                          padding: '6px 8px 2px',
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          borderTop: filteredMentionFiles.length > 0 ? '1px solid var(--border)' : 'none',
                          marginTop: filteredMentionFiles.length > 0 ? 4 : 0,
                        }}
                      >
                        Workspace Files
                      </div>
                    )}
                    <button
                      onClick={() => handleMentionSelect(item)}
                      className="mention-item flex items-center gap-2 w-full transition-colors duration-75"
                      style={{
                        fontSize: 11,
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: idx === mentionIndex ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'transparent',
                        color: 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => {
                        setMentionIndex(idx)
                        e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'
                      }}
                      onMouseLeave={(e) => {
                        if (idx !== mentionIndex) {
                          e.currentTarget.style.background = 'transparent'
                        }
                      }}
                    >
                      <FileCode
                        size={14}
                        style={{
                          color: item.source === 'open' ? 'var(--accent-purple)' : '#58a6ff',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                      {dir && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {dir}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
              <style>{`.mention-item:hover { background: var(--bg-hover, rgba(255,255,255,0.06)) !important; }`}</style>
            </div>
          )}

          {/* Slash command dropdown */}
          {showSlashDropdown && filteredSlashCommands.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: 4,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 4,
                boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
                zIndex: 50,
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '4px 8px 2px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Slash Commands
              </div>
              {filteredSlashCommands.map((cmd, idx) => (
                <div key={cmd.command}>
                  <button
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      background: idx === slashIndex ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'transparent',
                      color: 'var(--text-primary)',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={() => setSlashIndex(idx)}
                    onClick={() => {
                      setInput(cmd.command + ' ')
                      setShowSlashDropdown(false)
                      textareaRef.current?.focus()
                    }}
                  >
                    <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{cmd.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--accent)' }}>{cmd.command}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{cmd.description}</div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'agent'
                ? 'Ask the agent to do something... (type @ to mention a file)'
                : 'Ask anything... (type @ to mention a file)'
            }
            rows={1}
            style={{
              width: '100%',
              background: 'transparent',
              fontSize: 12.5,
              color: 'var(--text-primary)',
              padding: '12px 14px 6px',
              resize: 'none',
              outline: 'none',
              border: 'none',
              minHeight: 38,
              maxHeight: 120,
              overflowY: 'hidden',
              lineHeight: '20px',
            }}
          />
          {/* Shift+Enter hint */}
          {input.length > 0 && (
            <div style={{
              padding: '0 14px 2px',
              fontSize: 9.5,
              color: 'var(--text-muted)',
              opacity: 0.6,
            }}>
              <kbd style={{
                fontSize: 9,
                padding: '0px 3px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 3,
                fontFamily: 'var(--font-sans)',
              }}>Shift+Enter</kbd> for newline
            </div>
          )}
          <div className="flex items-center px-2 pb-2">
            <button
              style={{
                padding: 6,
                color: 'var(--text-muted)',
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              title="Attach file"
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Paperclip size={13} />
            </button>
            <button
              onClick={() => {
                setShowMentionDropdown(!showMentionDropdown)
                setMentionQuery('')
              }}
              style={{
                padding: 6,
                color: showMentionDropdown ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 4,
                background: showMentionDropdown ? 'rgba(88,166,255,0.1)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              title="Mention file (@)"
              onMouseEnter={(e) => {
                if (!showMentionDropdown) {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                }
              }}
              onMouseLeave={(e) => {
                if (!showMentionDropdown) {
                  e.currentTarget.style.color = 'var(--text-muted)'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <AtSign size={13} />
            </button>

            {/* Character/token count */}
            {input.length > 0 && (
              <span
                style={{
                  fontSize: 9.5,
                  color: 'var(--text-muted)',
                  marginLeft: 6,
                  fontVariantNumeric: 'tabular-nums',
                  opacity: 0.7,
                }}
              >
                {charCount} chars ~{approxTokens} tokens
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Model selector from settings store if available */}
              {settingsActiveModel && (
                <span
                  style={{
                    fontSize: 9.5,
                    color: 'var(--text-muted)',
                    padding: '2px 6px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 4,
                    fontFamily: 'var(--font-mono, monospace)',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Settings model: ${settingsActiveModel.modelId}`}
                >
                  {settingsActiveModel.modelId}
                </span>
              )}
              <ModelDropdown
                models={allModels}
                selectedModel={selectedModel}
                onSelect={setModel}
                customEndpoint={customEndpoint}
                onCustomEndpointChange={setCustomEndpoint}
              />
              {/* Stop generation button (visible while streaming) */}
              {isStreaming ? (
                <button
                  onClick={handleStopGeneration}
                  className="chat-stop-btn transition-all duration-150"
                  title="Stop generation"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(248,81,73,0.15)',
                    color: '#f85149',
                    cursor: 'pointer',
                    border: '1px solid rgba(248,81,73,0.3)',
                  }}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="transition-all duration-150"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: input.trim()
                      ? 'var(--accent)'
                      : 'var(--bg-hover)',
                    color: input.trim() ? '#fff' : 'var(--text-muted)',
                    cursor: input.trim() ? 'pointer' : 'default',
                    border: 'none',
                    boxShadow: input.trim()
                      ? '0 2px 8px rgba(88,166,255,0.2)'
                      : 'none',
                  }}
                >
                  <ArrowUp size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>{/* end main chat area */}
    </div>
  )
}

/* ── Empty chat state ──────────────────────────────────── */

function EmptyChat({ onInsertPrompt }: { onInsertPrompt?: (text: string) => void }) {
  const suggestions = [
    { icon: Search, text: 'Explain this file', color: 'var(--accent)' },
    { icon: Lightbulb, text: 'Find bugs', color: '#f78166' },
    { icon: TestTube, text: 'Write tests', color: 'var(--accent-green)' },
    { icon: Wrench, text: 'Refactor', color: 'var(--accent-purple)' },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-6">
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background:
            'linear-gradient(135deg, rgba(88,166,255,0.12), rgba(188,140,255,0.14))',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        }}
      >
        <Sparkles size={30} style={{ color: 'var(--accent)' }} />
      </div>

      <div className="text-center">
        <h3
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 6,
            letterSpacing: '-0.01em',
          }}
        >
          Ask anything about your code
        </h3>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            maxWidth: 240,
            margin: '0 auto',
          }}
        >
          Get explanations, find issues, generate tests, or refactor with AI assistance
        </p>
      </div>

      {/* Suggestion chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'center',
          maxWidth: 300,
        }}
      >
        {suggestions.map(({ icon: ChipIcon, text, color }) => (
          <button
            key={text}
            onClick={() => onInsertPrompt?.(text)}
            className="flex items-center gap-2 transition-all duration-150 chat-suggestion-chip"
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.03)',
              padding: '8px 14px',
              borderRadius: 20,
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              e.currentTarget.style.borderColor = 'var(--border-bright)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <ChipIcon
              size={13}
              style={{ color, flexShrink: 0 }}
            />
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
