import { useState, useCallback } from 'react'
import { Search, ChevronRight, ChevronDown, FileText, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'

interface SearchMatch {
  file: string
  line: number
  content: string
}

interface GroupedResult {
  filePath: string
  fileName: string
  matches: { line: number; text: string }[]
}

export default function SearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GroupedResult[]>([])
  const [searching, setSearching] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const { openFile } = useEditorStore()
  const rootPath = useFileStore((s) => s.rootPath)

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !rootPath) return
    setSearching(true)
    try {
      const raw: SearchMatch[] = await window.api.searchFiles(rootPath, query, { caseSensitive, regex: useRegex })
      // Group by file
      const grouped = new Map<string, GroupedResult>()
      for (const match of raw) {
        const fileName = match.file.replace(/\\/g, '/').split('/').pop() || match.file
        if (!grouped.has(match.file)) {
          grouped.set(match.file, { filePath: match.file, fileName, matches: [] })
        }
        grouped.get(match.file)!.matches.push({ line: match.line, text: match.content })
      }
      const list = Array.from(grouped.values())
      setResults(list)
      setExpanded(new Set(list.map((r) => r.filePath)))
    } catch {
      setResults([])
    }
    setSearching(false)
  }, [query, caseSensitive, useRegex, rootPath])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const openResult = async (filePath: string, fileName: string) => {
    try {
      const result = await window.api?.readFile(filePath)
      if (result) {
        openFile({
          path: filePath,
          name: fileName,
          content: result.content,
          language: result.language || 'plaintext',
          isModified: false,
          aiModified: false,
        })
      }
    } catch {}
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <Search size={12} style={{ marginRight: 6 }} />
        SEARCH
      </div>

      <div style={{ padding: '8px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in files..."
            style={{
              flex: 1,
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
          />
          <div style={{ display: 'flex', gap: 2, padding: '0 4px' }}>
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Match Case"
              style={{
                padding: '2px 4px',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: caseSensitive ? 'var(--accent)' : 'var(--text-muted)',
                background: caseSensitive ? 'rgba(88,166,255,0.1)' : 'transparent',
              }}
            >
              Aa
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              title="Use Regex"
              style={{
                padding: '2px 4px',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: useRegex ? 'var(--accent)' : 'var(--text-muted)',
                background: useRegex ? 'rgba(88,166,255,0.1)' : 'transparent',
              }}
            >
              .*
            </button>
          </div>
        </div>
        {!rootPath && (
          <p style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 6 }}>
            Open a folder first to search
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
        {searching && (
          <div
            style={{
              padding: 16,
              color: 'var(--text-muted)',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Loader2 size={14} className="anim-spin" />
            Searching...
          </div>
        )}

        {!searching && results.length === 0 && query && (
          <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
            No results found
          </div>
        )}

        {!searching && results.length > 0 && (
          <div style={{ padding: '4px 12px 4px', color: 'var(--text-muted)', fontSize: 11 }}>
            {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file
            {results.length !== 1 ? 's' : ''}
          </div>
        )}

        {results.map((result) => (
          <div key={result.filePath}>
            <div
              onClick={() => toggleExpand(result.filePath)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 12px',
                cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {expanded.has(result.filePath) ? (
                <ChevronDown size={12} style={{ flexShrink: 0 }} />
              ) : (
                <ChevronRight size={12} style={{ flexShrink: 0 }} />
              )}
              <FileText size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span className="truncate" style={{ flex: 1 }}>
                {result.fileName}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-active)',
                  padding: '0 5px',
                  borderRadius: 8,
                }}
              >
                {result.matches.length}
              </span>
            </div>

            {expanded.has(result.filePath) &&
              result.matches.map((match, i) => (
                <div
                  key={i}
                  onClick={() => openResult(result.filePath, result.fileName)}
                  style={{
                    padding: '3px 12px 3px 40px',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', marginRight: 8, fontSize: 10 }}>
                    {match.line}
                  </span>
                  {match.text}
                </div>
              ))}
          </div>
        ))}

        {!searching && !query && (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Type to search across all files in the workspace
          </div>
        )}
      </div>
    </div>
  )
}
