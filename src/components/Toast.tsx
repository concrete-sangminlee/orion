import { useToastStore } from '../store/toast'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'

const icons = {
  success: <CheckCircle size={14} />,
  error: <AlertCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
}

const colors = {
  success: { bg: 'rgba(63, 185, 80, 0.15)', border: 'var(--accent-green)', icon: 'var(--accent-green)' },
  error: { bg: 'rgba(248, 81, 73, 0.15)', border: 'var(--accent-red)', icon: 'var(--accent-red)' },
  warning: { bg: 'rgba(210, 153, 34, 0.15)', border: 'var(--accent-orange)', icon: 'var(--accent-orange)' },
  info: { bg: 'rgba(88, 166, 255, 0.15)', border: 'var(--accent)', icon: 'var(--accent)' },
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore()
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 36, right: 16, zIndex: 200,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map((t) => {
        const c = colors[t.type]
        return (
          <div
            key={t.id}
            className="anim-slide-up"
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              backdropFilter: 'blur(12px)',
              minWidth: 280, maxWidth: 420,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <span style={{ color: c.icon, flexShrink: 0 }}>{icons[t.type]}</span>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, lineHeight: 1.4 }}>
              {t.message}
            </span>
            <button
              onClick={() => removeToast(t.id)}
              style={{
                background: 'transparent', border: 'none', padding: 2,
                color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
