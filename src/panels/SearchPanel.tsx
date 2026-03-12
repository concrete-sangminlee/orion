import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, ChevronRight, ChevronDown, FileText, Loader2, Replace, X, ChevronsUpDown, ChevronsDownUp } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'

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
  const [wholeWord, setWholeWord] = useState(false)
  const [replaceQuery, setReplaceQuery] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { openFile } = useEditorStore()
  const rootPath = useFileStore((s) => s.rootPath)
  const addToast = useToastStore((s) => s.addToast)

  // Focus input on Ctrl+Shift+F
  useEffect(() => {
    const handler = () => inputRef.current?.focus()
    window.addEventListener('orion:show-search', handler)
    return () => window.removeEventListener('orion:show-search', handler)
  }, [])

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

  const collapseAll = () => setExpanded(new Set())
  const expandAll = () => setExpanded(new Set(results.map(r => r.filePath)))
  const clearResults = () => { setResults([]); setQuery('') }

  // Highlight matching text in search results
  const highlightMatch = (text: string) => {
    if (!query.trim()) return text
    try {
      let pattern: string
      if (useRegex) {
        pattern = query
      } else {
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      if (wholeWord) pattern = `\\b${pattern}\\b`
      const regex = new RegExp(`(${pattern})`, caseSensitive ? 'g' : 'gi')
      const parts = text.split(regex)
      return parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} style={{ background: 'rgba(88,166,255,0.25)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>{part}</span>
        ) : part
      )
    } catch {
      return text
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <Search size={12} style={{ marginRight: 6 }} />
        SEARCH
      </div>

      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Toggle replace */}
          <button
            onClick={() => setShowReplace(!showReplace)}
            title={showReplace ? 'Hide Replace' : 'Show Replace'}
            style={{
              width: 20, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 3, color: showReplace ? 'var(--accent)' : 'var(--text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0,
              transition: 'color 0.1s',
            }}
          >
            <ChevronRight size={12} style={{ transform: showReplace ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Search input */}
            <div
              style={{
                display: 'flex', alignItems: 'center',
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', overflow: 'hidden',
              }}
            >
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search in files..."
                style={{ flex: 1, padding: '6px 10px', background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: 'var(--text-primary)' }}
              />
              <div style={{ display: 'flex', gap: 1, padding: '0 4px' }}>
                <button onClick={() => setCaseSensitive(!caseSensitive)} title="Match Case (Alt+C)"
                  style={{ padding: '2px 4px', borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: caseSensitive ? 'var(--accent)' : 'var(--text-muted)', background: caseSensitive ? 'rgba(88,166,255,0.1)' : 'transparent', border: 'none', cursor: 'pointer' }}>Aa</button>
                <button onClick={() => setWholeWord(!wholeWord)} title="Match Whole Word (Alt+W)"
                  style={{ padding: '2px 4px', borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: wholeWord ? 'var(--accent)' : 'var(--text-muted)', background: wholeWord ? 'rgba(88,166,255,0.1)' : 'transparent', border: 'none', cursor: 'pointer' }}>ab</button>
                <button onClick={() => setUseRegex(!useRegex)} title="Use Regular Expression (Alt+R)"
                  style={{ padding: '2px 4px', borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: useRegex ? 'var(--accent)' : 'var(--text-muted)', background: useRegex ? 'rgba(88,166,255,0.1)' : 'transparent', border: 'none', cursor: 'pointer' }}>.*</button>
              </div>
            </div>
            {/* Replace input */}
            {showReplace && (
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <input
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder="Replace..."
                  style={{ flex: 1, padding: '6px 10px', background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: 'var(--text-primary)' }}
                />
                <div style={{ display: 'flex', gap: 2, padding: '0 4px' }}>
                  <button title="Replace All" onClick={() => addToast({ type: 'info', message: 'Replace All coming soon' })}
                    style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <Replace size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {!rootPath && (
          <p style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 6 }}>Open a folder first to search</p>
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
          <div style={{ padding: '4px 12px', color: 'var(--text-muted)', fontSize: 11, display: 'flex', alignItems: 'center' }}>
            <span>{totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <button onClick={expandAll} title="Expand All" style={{ padding: 2, borderRadius: 3, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}>
                <ChevronsUpDown size={12} />
              </button>
              <button onClick={collapseAll} title="Collapse All" style={{ padding: 2, borderRadius: 3, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}>
                <ChevronsDownUp size={12} />
              </button>
              <button onClick={clearResults} title="Clear Results" style={{ padding: 2, borderRadius: 3, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}>
                <X size={12} />
              </button>
            </div>
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
                  {highlightMatch(match.text)}
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
