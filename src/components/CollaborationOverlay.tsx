/**
 * Collaboration overlay component.
 * Shows collaborator cursors, selections, avatars, and presence indicators.
 */

import { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react'
import {
  Users, Share2, Link2, Copy, Check, X, MessageSquare,
  Send, UserPlus, Shield, Eye, EyeOff, Wifi, WifiOff,
  Globe, Lock, Unlock,
} from 'lucide-react'

/* ── Types ─────────────────────────────────────────────── */

interface Participant {
  id: string
  name: string
  color: string
  avatar?: string
  file?: string
  line?: number
  isTyping: boolean
  isOnline: boolean
  role: 'host' | 'editor' | 'viewer'
}

interface ChatMsg {
  id: string
  userId: string
  name: string
  text: string
  time: number
  type: 'message' | 'system'
}

/* ── Styles ───────────────────────────────────────────── */

const overlayStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--bg-primary)',
  borderLeft: '1px solid var(--border-primary)',
  width: 280,
}

const headerStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-primary)',
}

const sectionStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-primary)',
}

const participantStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  fontSize: 12,
}

const avatarStyle = (color: string): React.CSSProperties => ({
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: color,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontWeight: 700,
  color: '#fff',
  flexShrink: 0,
  position: 'relative',
})

const statusDotStyle = (online: boolean): React.CSSProperties => ({
  position: 'absolute',
  bottom: -1,
  right: -1,
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: online ? '#3fb950' : '#8b949e',
  border: '2px solid var(--bg-primary)',
})

const chatContainerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const inputContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderTop: '1px solid var(--border-primary)',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
}

/* ── Demo Data ────────────────────────────────────────── */

const DEMO_PARTICIPANTS: Participant[] = [
  { id: 'self', name: 'You', color: '#388bfd', isTyping: false, isOnline: true, role: 'host', file: 'App.tsx', line: 42 },
  { id: 'user2', name: 'Alice Kim', color: '#3fb950', isTyping: true, isOnline: true, role: 'editor', file: 'EditorPanel.tsx', line: 128 },
  { id: 'user3', name: 'Bob Chen', color: '#d29922', isTyping: false, isOnline: true, role: 'editor', file: 'StatusBar.tsx', line: 55 },
  { id: 'user4', name: 'Carol Wu', color: '#f85149', isTyping: false, isOnline: false, role: 'viewer' },
]

const DEMO_MESSAGES: ChatMsg[] = [
  { id: '1', userId: 'system', name: 'System', text: 'Session started', time: Date.now() - 300000, type: 'system' },
  { id: '2', userId: 'user2', name: 'Alice', text: 'Working on the editor panel refactor', time: Date.now() - 120000, type: 'message' },
  { id: '3', userId: 'self', name: 'You', text: 'Sounds good, I\'ll handle the status bar', time: Date.now() - 60000, type: 'message' },
  { id: '4', userId: 'user3', name: 'Bob', text: 'PR #42 is ready for review', time: Date.now() - 30000, type: 'message' },
]

/* ── Sub-components ───────────────────────────────────── */

const ParticipantRow = memo(function ParticipantRow({ p }: { p: Participant }) {
  return (
    <div style={participantStyle}>
      <div style={avatarStyle(p.color)}>
        {p.name[0].toUpperCase()}
        <div style={statusDotStyle(p.isOnline) as any} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          {p.id === 'self' && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>(you)</span>}
          {p.isTyping && (
            <span style={{ fontSize: 10, color: 'var(--accent-primary)', fontStyle: 'italic' }}>typing...</span>
          )}
        </div>
        {p.file && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.file}{p.line ? `:${p.line}` : ''}
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
        {p.role === 'host' && <Shield size={12} />}
        {p.role === 'viewer' && <Eye size={12} />}
      </div>
    </div>
  )
})

const ChatMessage = memo(function ChatMessage({ msg, color }: { msg: ChatMsg; color: string }) {
  if (msg.type === 'system') {
    return (
      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-tertiary)', padding: '2px 0' }}>
        {msg.text}
      </div>
    )
  }

  const time = new Date(msg.time)
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`
  const isSelf = msg.userId === 'self'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isSelf ? 'flex-end' : 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 2 }}>
        {!isSelf && <span style={{ fontSize: 10, fontWeight: 600, color }}>{msg.name}</span>}
        <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{timeStr}</span>
      </div>
      <div
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          background: isSelf ? 'var(--accent-primary)' : 'var(--bg-secondary)',
          color: isSelf ? '#fff' : 'var(--text-primary)',
          fontSize: 12,
          maxWidth: '85%',
          wordWrap: 'break-word',
        }}
      >
        {msg.text}
      </div>
    </div>
  )
})

/* ── Main Component ───────────────────────────────────── */

function CollaborationOverlay() {
  const [participants] = useState<Participant[]>(DEMO_PARTICIPANTS)
  const [messages, setMessages] = useState<ChatMsg[]>(DEMO_MESSAGES)
  const [inputText, setInputText] = useState('')
  const [copied, setCopied] = useState(false)
  const [sessionAccess, setSessionAccess] = useState<'private' | 'link' | 'public'>('link')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {}
    participants.forEach(p => { map[p.id] = p.color })
    return map
  }, [participants])

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      userId: 'self',
      name: 'You',
      text: inputText.trim(),
      time: Date.now(),
      type: 'message',
    }])
    setInputText('')
  }, [inputText])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText('orion://collab/session-abc123')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  const onlineCount = participants.filter(p => p.isOnline).length

  return (
    <div style={overlayStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <Users size={14} />
        <span>Live Share</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {onlineCount}/{participants.length} online
        </span>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3fb950' }} />
      </div>

      {/* Share Link */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Share2 size={12} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Session Link</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div
            style={{
              flex: 1,
              padding: '4px 8px',
              background: 'var(--bg-secondary)',
              borderRadius: 4,
              fontSize: 10,
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              border: '1px solid var(--border-primary)',
            }}
          >
            orion://collab/session-abc123
          </div>
          <button onClick={handleCopyLink} style={{ ...btnStyle, background: 'var(--bg-secondary)', borderRadius: 4, padding: '4px 8px' }}>
            {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {(['private', 'link', 'public'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setSessionAccess(mode)}
              style={{
                ...btnStyle,
                flex: 1,
                fontSize: 10,
                padding: '3px 0',
                background: sessionAccess === mode ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: sessionAccess === mode ? '#fff' : 'var(--text-secondary)',
                borderRadius: 4,
                justifyContent: 'center',
                gap: 3,
              }}
            >
              {mode === 'private' && <Lock size={10} />}
              {mode === 'link' && <Link2 size={10} />}
              {mode === 'public' && <Globe size={10} />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Participants */}
      <div style={{ ...sectionStyle, maxHeight: 160, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <UserPlus size={12} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Participants ({participants.length})</span>
        </div>
        {participants.map(p => (
          <ParticipantRow key={p.id} p={p} />
        ))}
      </div>

      {/* Chat */}
      <div style={chatContainerStyle}>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={12} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Chat</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {messages.filter(m => m.type === 'message').length} messages
          </span>
        </div>

        <div style={messagesStyle}>
          {messages.map(msg => (
            <ChatMessage key={msg.id} msg={msg} color={colorMap[msg.userId] || 'var(--text-secondary)'} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div style={inputContainerStyle}>
          <input
            style={inputStyle}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
          />
          <button onClick={handleSend} style={{ ...btnStyle, color: inputText.trim() ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default CollaborationOverlay
