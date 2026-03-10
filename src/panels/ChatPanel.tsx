import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { useChatStore } from '@/store/chat'
import { v4 as uuid } from 'uuid'
import {
  Sparkles, Bot, User, Zap, MessageSquare,
  ArrowUp, Paperclip, AtSign, CheckCircle2, Loader2, Circle,
  ChevronDown, Copy, Check, Code, Lightbulb, Wrench, BookOpen,
} from 'lucide-react'
import type { ChatMessage } from '@shared/types'

/* ── Model definitions ─────────────────────────────────── */

const apiModels = [
  { id: 'Claude Opus', label: 'Claude', color: '#bc8cff' },
  { id: 'GPT-5.3', label: 'GPT-5', color: '#3fb950' },
  { id: 'Kimi K2.5', label: 'Kimi', color: '#f78166' },
  { id: 'Gemini', label: 'Gemini', color: '#58a6ff' },
]

const nvidiaModels = [
  { id: 'NVIDIA Llama', label: 'Llama 3.3', color: '#76b900' },
  { id: 'NVIDIA Nemotron', label: 'Nemotron', color: '#76b900' },
  { id: 'DeepSeek R1', label: 'DeepSeek', color: '#76b900' },
  { id: 'Qwen 2.5', label: 'Qwen', color: '#76b900' },
]

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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'rgba(0,0,0,0.2)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3"
        style={{
          height: 30,
          background: 'rgba(255,255,255,0.03)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            textTransform: 'lowercase',
          }}
        >
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 transition-colors duration-100"
          style={{
            fontSize: 10,
            color: copied ? 'var(--accent-green)' : 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
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
      {/* Code */}
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
          color: '#e6edf3',
          overflowX: 'auto',
          tabSize: 2,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

/* ── Streaming indicator ───────────────────────────────── */

function StreamingDots() {
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
    </div>
  )
}

/* ── Message bubble ────────────────────────────────────── */

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const rendered = useMemo(
    () => (isUser ? null : renderMarkdown(message.content)),
    [message.content, isUser],
  )

  return (
    <div className="group" style={{ padding: '10px 0' }}>
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            flexShrink: 0,
            marginTop: 1,
            background: isUser
              ? 'rgba(88,166,255,0.1)'
              : 'linear-gradient(135deg, rgba(188,140,255,0.15), rgba(88,166,255,0.15))',
            border: `1px solid ${isUser ? 'rgba(88,166,255,0.15)' : 'rgba(188,140,255,0.15)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isUser ? (
            <User size={12} style={{ color: 'var(--accent)' }} />
          ) : (
            <Bot size={12} style={{ color: 'var(--accent-purple)' }} />
          )}
        </div>

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
            <span
              className="transition-opacity duration-150"
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                marginLeft: 'auto',
                opacity: 0,
              }}
              ref={(el) => {
                const parent = el?.closest('.group')
                parent?.addEventListener('mouseenter', () => el && (el.style.opacity = '1'))
                parent?.addEventListener('mouseleave', () => el && (el.style.opacity = '0'))
              }}
            >
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          {/* Message body */}
          {isUser ? (
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
          ) : (
            <div>{rendered}</div>
          )}

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
}: {
  models: { id: string; label: string; color: string }[]
  selectedModel: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = models.find((m) => m.id === selectedModel)

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
            minWidth: 180,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 50,
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
            .filter((m) => !nvidiaModels.some((n) => n.id === m.id))
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
  model: { id: string; label: string; color: string }
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
      <span style={{ flex: 1 }}>{model.label}</span>
      {isSelected && (
        <Check size={11} style={{ color: model.color, flexShrink: 0 }} />
      )}
    </button>
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
    ollamaAvailable,
    ollamaModels,
  } = useChatStore()

  const allModels = [
    {
      id: 'Ollama',
      label: ollamaAvailable ? `Ollama (${ollamaModels[0] || 'local'})` : 'Ollama',
      color: '#76e3ea',
    },
    ...apiModels,
    ...nvidiaModels,
  ]

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return
    addMessage({
      id: uuid(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    })
    window.api?.omoSend({
      type: 'chat',
      payload: { message: input.trim(), mode, model: selectedModel },
    })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}
    >
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
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3">
        {messages.length === 0 ? (
          <EmptyChat />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isStreaming && <StreamingDots />}
          </>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <div
          className="transition-colors duration-150"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'agent'
                ? 'Ask the agent to do something...'
                : 'Ask anything...'
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
            }}
          />
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
              style={{
                padding: 6,
                color: 'var(--text-muted)',
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              title="Mention file"
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <AtSign size={13} />
            </button>

            <div className="ml-auto flex items-center gap-2">
              <ModelDropdown
                models={allModels}
                selectedModel={selectedModel}
                onSelect={setModel}
              />
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Empty chat state ──────────────────────────────────── */

function EmptyChat() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 px-6">
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background:
            'linear-gradient(135deg, rgba(88,166,255,0.1), rgba(188,140,255,0.12))',
          border: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}
      >
        <Sparkles size={28} style={{ color: 'var(--accent)' }} />
      </div>

      <div className="text-center">
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}
        >
          How can I help?
        </h3>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          Ask questions, get code help, or let agents work autonomously
        </p>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 260,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {[
          { icon: Code, text: '"Explain this codebase"' },
          { icon: Wrench, text: '"Fix the bug in auth.ts"' },
          { icon: Lightbulb, text: '"Add dark mode support"' },
          { icon: BookOpen, text: '"Write tests for utils.ts"' },
        ].map(({ icon: ExIcon, text }) => (
          <div
            key={text}
            className="flex items-center gap-2.5 transition-colors duration-100 cursor-pointer"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.02)',
              padding: '9px 12px',
              borderRadius: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
            }}
          >
            <ExIcon
              size={13}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}
