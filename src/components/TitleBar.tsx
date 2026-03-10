export default function TitleBar() {
  return (
    <div className="h-8 bg-bg-tertiary flex items-center px-3 select-none"
         style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <span className="text-accent-blue font-bold text-sm mr-2">⚡</span>
      <span className="text-text-secondary text-xs">CursorPlus</span>
      <div className="ml-auto flex gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button onClick={() => window.api.minimize()}
                className="w-8 h-6 flex items-center justify-center text-text-secondary hover:bg-bg-hover rounded text-xs">
          ─
        </button>
        <button onClick={() => window.api.maximize()}
                className="w-8 h-6 flex items-center justify-center text-text-secondary hover:bg-bg-hover rounded text-xs">
          □
        </button>
        <button onClick={() => window.api.close()}
                className="w-8 h-6 flex items-center justify-center text-text-secondary hover:bg-red-600 rounded text-xs">
          ✕
        </button>
      </div>
    </div>
  )
}
