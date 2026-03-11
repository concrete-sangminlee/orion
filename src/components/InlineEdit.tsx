import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'

interface Props {
  visible: boolean
  onClose: () => void
  onSubmit: (instruction: string) => void
  isProcessing: boolean
  selectedText: string
  position: { top: number; left: number }
}

export default function InlineEdit({ visible, onClose, onSubmit, isProcessing, selectedText, position }: Props) {
  const [instruction, setInstruction] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setInstruction('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [visible])

  if (!visible) return null

  const handleSubmit = () => {
    if (!instruction.trim() || isProcessing) return
    onSubmit(instruction.trim())
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 50,
        minWidth: 400,
        maxWidth: 560,
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--accent)',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(88,166,255,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(88,166,255,0.05)',
        }}>
          <Sparkles size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
            Edit with AI
          </span>
          {selectedText && (
            <span style={{
              fontSize: 10, color: 'var(--text-muted)',
              background: 'var(--bg-hover)',
              padding: '1px 6px', borderRadius: 3,
              marginLeft: 'auto',
            }}>
              {selectedText.split('\n').length} lines selected
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', padding: 2,
              color: 'var(--text-muted)', cursor: 'pointer',
              marginLeft: selectedText ? 0 : 'auto',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 8 }}>
          <input
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Describe how to edit this code..."
            disabled={isProcessing}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              outline: 'none',
              fontSize: 12,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!instruction.trim() || isProcessing}
            style={{
              padding: '6px 14px',
              background: instruction.trim() && !isProcessing ? 'var(--accent)' : 'var(--bg-hover)',
              color: instruction.trim() && !isProcessing ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: instruction.trim() && !isProcessing ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {isProcessing ? (
              <>
                <Loader2 size={12} className="spin" />
                Editing...
              </>
            ) : (
              'Generate'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
