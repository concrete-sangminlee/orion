import { useState } from 'react'
import { Files, Search, GitBranch, Bot, Settings } from 'lucide-react'

type PanelView = 'explorer' | 'search' | 'git' | 'agents'

interface Props {
  activeView: PanelView
  onViewChange: (view: PanelView) => void
  onSettingsClick?: () => void
}

const items: { view: PanelView; Icon: typeof Files; label: string; badge?: number | null; showDot?: boolean }[] = [
  { view: 'explorer', Icon: Files, label: 'Explorer' },
  { view: 'search', Icon: Search, label: 'Search' },
  { view: 'git', Icon: GitBranch, label: 'Source Control' },
  { view: 'agents', Icon: Bot, label: 'AI Agents', showDot: true },
]

/* Tooltip styles injected once */
const tooltipCSS = `
  [data-tooltip] {
    position: relative;
  }
  [data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    padding: 4px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  [data-tooltip]:hover::after {
    opacity: 1;
  }
`

export default function ActivityBar({ activeView, onViewChange, onSettingsClick }: Props) {
  const [hoveredView, setHoveredView] = useState<string | null>(null)

  return (
    <>
      <style>{tooltipCSS}</style>
      <nav
        className="shrink-0 flex flex-col items-center"
        style={{
          width: 48,
          background: 'var(--bg-tertiary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 4,
          paddingBottom: 8,
        }}
      >
        {items.map(({ view, Icon, label, showDot }) => {
          const isActive = activeView === view
          const isHovered = hoveredView === view

          return (
            <button
              key={view}
              data-tooltip={label}
              onClick={() => onViewChange(view)}
              className="relative flex items-center justify-center"
              style={{
                width: 48,
                height: 48,
                color: isActive
                  ? 'var(--text-primary)'
                  : isHovered
                    ? 'var(--text-secondary)'
                    : 'var(--text-muted)',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={() => setHoveredView(view)}
              onMouseLeave={() => setHoveredView(null)}
            >
              {/* Active indicator - left border style */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 10,
                    bottom: 10,
                    width: 2,
                    background: 'var(--accent)',
                    borderRadius: '0 2px 2px 0',
                  }}
                />
              )}

              <Icon size={21} strokeWidth={isActive ? 1.8 : 1.4} />

              {/* Search results badge */}
              {view === 'search' && (
                <span
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    background: 'var(--accent)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'none', /* shown via JS when results > 0 */
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    lineHeight: 1,
                  }}
                />
              )}

              {/* Notification dot for agents */}
              {showDot && (
                <span
                  className="anim-pulse"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent-green)',
                    boxShadow: '0 0 6px rgba(63, 185, 80, 0.4)',
                    border: '1px solid var(--bg-tertiary)',
                  }}
                />
              )}
            </button>
          )
        })}

        <div className="flex-1" />

        {/* Settings button */}
        <button
          data-tooltip="Settings"
          onClick={onSettingsClick}
          className="relative flex items-center justify-center"
          style={{
            width: 48,
            height: 48,
            color: hoveredView === 'settings' ? 'var(--text-secondary)' : 'var(--text-muted)',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={() => setHoveredView('settings')}
          onMouseLeave={() => setHoveredView(null)}
        >
          <Settings size={20} strokeWidth={1.4} />
        </button>
      </nav>
    </>
  )
}

export type { PanelView }
