import { useState } from 'react'
import { Minus, Square, X, Zap } from 'lucide-react'

const menuItems = ['File', 'Edit', 'Selection', 'View', 'Go', 'Terminal', 'Help']

export default function TitleBar() {
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null)

  return (
    <header
      className="shrink-0 flex items-center select-none"
      style={{
        height: 38,
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Logo + Brand */}
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: 14, paddingRight: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Zap size={10} color="#fff" fill="#fff" />
        </div>
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.3px',
          }}
        >
          Orion
        </span>
      </div>

      {/* Menu Items */}
      <nav
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag', height: '100%' } as React.CSSProperties}
      >
        {menuItems.map((item) => {
          const isHovered = hoveredMenu === item
          return (
            <button
              key={item}
              className="flex items-center justify-center"
              style={{
                height: '100%',
                padding: '0 8px',
                fontSize: 12,
                color: isHovered ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isHovered ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                borderRadius: 4,
                margin: '0 1px',
                transition: 'color 0.1s, background 0.1s',
                cursor: 'default',
              }}
              onMouseEnter={() => setHoveredMenu(item)}
              onMouseLeave={() => setHoveredMenu(null)}
            >
              {item}
            </button>
          )
        })}
      </nav>

      {/* Center drag region */}
      <div className="flex-1" />

      {/* Window title (subtle, centered) */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 11,
          color: 'var(--text-muted)',
          pointerEvents: 'none',
          opacity: 0.6,
        }}
      >
        Orion
      </div>

      {/* Window controls */}
      <div
        className="flex items-center"
        style={{ height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {[
          {
            Icon: Minus,
            onClick: () => window.api?.minimize(),
            hoverBg: 'rgba(255, 255, 255, 0.06)',
            hoverColor: 'var(--text-primary)',
          },
          {
            Icon: Square,
            onClick: () => window.api?.maximize(),
            hoverBg: 'rgba(255, 255, 255, 0.06)',
            hoverColor: 'var(--text-primary)',
            size: 10,
          },
          {
            Icon: X,
            onClick: () => window.api?.close(),
            hoverBg: '#c42b1c',
            hoverColor: '#ffffff',
          },
        ].map(({ Icon, onClick, hoverBg, hoverColor, size }, i) => (
          <button
            key={i}
            onClick={onClick}
            className="flex items-center justify-center"
            style={{
              width: 46,
              height: '100%',
              color: 'var(--text-muted)',
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg
              e.currentTarget.style.color = hoverColor
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <Icon size={(size as number) || 13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </header>
  )
}
