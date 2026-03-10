import { useState } from 'react'

type PanelView = 'explorer' | 'search' | 'git' | 'agents'

interface Props {
  activeView: PanelView
  onViewChange: (view: PanelView) => void
}

const icons: { view: PanelView; icon: string; label: string }[] = [
  { view: 'explorer', icon: '📁', label: 'Explorer' },
  { view: 'search', icon: '🔍', label: 'Search' },
  { view: 'git', icon: '🔀', label: 'Git' },
  { view: 'agents', icon: '🤖', label: 'Agents' },
]

export default function ActivityBar({ activeView, onViewChange }: Props) {
  return (
    <div className="w-12 bg-bg-tertiary border-r border-border-primary flex flex-col items-center py-2 gap-1">
      {icons.map(({ view, icon, label }) => (
        <button
          key={view}
          title={label}
          onClick={() => onViewChange(view)}
          className={`w-9 h-9 flex items-center justify-center rounded-md text-base transition-colors relative
            ${activeView === view ? 'bg-bg-hover border border-accent-blue' : 'hover:bg-bg-hover'}`}
        >
          {icon}
          {view === 'agents' && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-accent-green rounded-full" />
          )}
        </button>
      ))}
      <div className="flex-1" />
      <button
        title="Settings"
        className="w-9 h-9 flex items-center justify-center rounded-md text-base hover:bg-bg-hover"
      >
        ⚙️
      </button>
    </div>
  )
}

export type { PanelView }
