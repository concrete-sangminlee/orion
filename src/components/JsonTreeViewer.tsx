import { useState, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, ChevronDown, Copy, Search } from 'lucide-react'

type PathSegment = string | number

// ── Styles ──────────────────────────────────────────────
const colors = {
  string: '#98c379',
  number: '#61afef',
  boolean: '#d19a66',
  null: '#636d83',
  key: '#e5c07b',
  bracket: '#abb2bf',
  count: '#636d83',
}

function getType(val: unknown): string {
  if (val === null) return 'null'
  if (Array.isArray(val)) return 'array'
  return typeof val
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

// ── Targeted text edits ─────────────────────────────────
// An edit replaces only the source text of one value. Re-serialising the
// parsed document would reformat the file and round integers above 2^53.

const JSON_WS = new Set([' ', '\t', '\n', '\r'])

function skipWs(text: string, i: number): number {
  while (i < text.length && JSON_WS.has(text[i])) i++
  return i
}

/** Offset just past the string literal that starts at `i`. */
function stringEnd(text: string, i: number): number {
  i++
  while (i < text.length) {
    if (text[i] === '\\') i += 2
    else if (text[i] === '"') return i + 1
    else i++
  }
  return i
}

/** Offset just past the JSON value that starts at `i`. */
function valueEnd(text: string, i: number): number {
  const c = text[i]
  if (c === '"') return stringEnd(text, i)
  if (c === '{' || c === '[') {
    let depth = 0
    while (i < text.length) {
      const ch = text[i]
      if (ch === '"') { i = stringEnd(text, i); continue }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return i
  }
  while (i < text.length && !JSON_WS.has(text[i]) && text[i] !== ',' && text[i] !== '}' && text[i] !== ']') i++
  return i
}

/** Offset of the child `key` of the object/array starting at `start`; the last duplicate key wins, as in JSON.parse. */
function childStart(text: string, start: number, key: PathSegment): number | null {
  let i = skipWs(text, start + 1)
  if (text[start] === '{' && typeof key === 'string') {
    let found: number | null = null
    while (text[i] === '"') {
      const keyEnd = stringEnd(text, i)
      const name: unknown = JSON.parse(text.slice(i, keyEnd))
      i = skipWs(text, skipWs(text, keyEnd) + 1) // past ':'
      if (name === key) found = i
      const end = valueEnd(text, i)
      if (end <= i) return null
      i = skipWs(text, end)
      if (text[i] === ',') i = skipWs(text, i + 1)
    }
    return found
  }
  if (text[start] === '[' && typeof key === 'number') {
    for (let index = 0; i < text.length && text[i] !== ']'; index++) {
      if (index === key) return i
      const end = valueEnd(text, i)
      if (end <= i) return null
      i = skipWs(text, end)
      if (text[i] === ',') i = skipWs(text, i + 1)
    }
  }
  return null
}

/**
 * Replace the value at `segments` in the JSON `text` with the JSON `literal`,
 * leaving every other byte as it was. Returns null when the path is not found.
 */
export function replaceJsonValue(text: string, segments: PathSegment[], literal: string): string | null {
  let start = skipWs(text, 0)
  for (const key of segments) {
    const next = childStart(text, start, key)
    if (next === null) return null
    start = next
  }
  return text.slice(0, start) + literal + text.slice(valueEnd(text, start))
}

/**
 * JSON text for an edited primitive, or null when nothing changed. Strings
 * stay strings ("3000" stays "3000"); other values take a typed JSON literal,
 * and text that is not one becomes a string.
 */
export function editedLiteral(previous: unknown, text: string): string | null {
  if (typeof previous === 'string') return text === previous ? null : JSON.stringify(text)
  if (text === JSON.stringify(previous)) return null
  const trimmed = text.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || typeof parsed === 'number' || typeof parsed === 'boolean') return trimmed
  } catch { /* not a JSON literal */ }
  return JSON.stringify(text)
}

// ── JsonNode (recursive) ────────────────────────────────
function JsonNode({
  name,
  value,
  path,
  segments,
  depth,
  defaultExpanded,
  filter,
  onEdit,
}: {
  name: string | number | null
  value: unknown
  path: string
  segments: PathSegment[]
  depth: number
  defaultExpanded: boolean
  filter: string
  onEdit: (segments: PathSegment[], literal: string) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded && depth < 2)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  // Enter/Escape unmount the input, which may still fire blur: end each edit once.
  const editEndedRef = useRef(false)
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)

  const type = getType(value)
  const isExpandable = type === 'object' || type === 'array'

  const entries = useMemo(() => {
    if (!isExpandable) return []
    if (type === 'array') return (value as unknown[]).map((v, i) => ({ key: i, val: v }))
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, val: v }))
  }, [value, type, isExpandable])

  const filteredEntries = useMemo(() => {
    if (!filter) return entries
    return entries.filter(({ key, val }) => {
      const keyStr = String(key).toLowerCase()
      const valStr = JSON.stringify(val).toLowerCase()
      return keyStr.includes(filter) || valStr.includes(filter)
    })
  }, [entries, filter])

  const matchesFilter = !filter ||
    (name !== null && String(name).toLowerCase().includes(filter)) ||
    (!isExpandable && JSON.stringify(value).toLowerCase().includes(filter))

  if (!isExpandable && filter && !matchesFilter) return null

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation()
    copyToClipboard(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleStartEdit = () => {
    if (isExpandable) return
    editEndedRef.current = false
    setEditing(true)
    setEditValue(type === 'string' ? (value as string) : JSON.stringify(value))
  }

  const handleFinishEdit = () => {
    if (editEndedRef.current) return
    editEndedRef.current = true
    setEditing(false)
    const literal = editedLiteral(value, editValue)
    if (literal !== null) onEdit(segments, literal)
  }

  const handleCancelEdit = () => {
    editEndedRef.current = true
    setEditing(false)
  }

  const renderValue = () => {
    if (editing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFinishEdit(); if (e.key === 'Escape') handleCancelEdit() }}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--accent-blue, #58a6ff)',
            borderRadius: 3,
            color: 'var(--text-primary)',
            padding: '1px 4px',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            outline: 'none',
            minWidth: 60,
          }}
        />
      )
    }
    switch (type) {
      case 'string': return <span style={{ color: colors.string, cursor: 'pointer' }} onClick={handleStartEdit}>"{String(value)}"</span>
      case 'number': return <span style={{ color: colors.number, cursor: 'pointer' }} onClick={handleStartEdit}>{String(value)}</span>
      case 'boolean': return <span style={{ color: colors.boolean, cursor: 'pointer' }} onClick={handleStartEdit}>{String(value)}</span>
      case 'null': return <span style={{ color: colors.null, cursor: 'pointer', fontStyle: 'italic' }} onClick={handleStartEdit}>null</span>
      default: return <span>{String(value)}</span>
    }
  }

  const label = isExpandable
    ? type === 'array'
      ? `[] ${entries.length} item${entries.length !== 1 ? 's' : ''}`
      : `{} ${entries.length} propert${entries.length !== 1 ? 'ies' : 'y'}`
    : null

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          height: 22,
          fontSize: 12,
          fontFamily: 'var(--font-mono, monospace)',
          cursor: isExpandable ? 'pointer' : 'default',
          background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
          borderRadius: 3,
          paddingRight: 4,
        }}
        onClick={() => isExpandable && setExpanded(!expanded)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isExpandable ? (
          expanded
            ? <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {name !== null && (
          <>
            <span style={{ color: colors.key }}>{typeof name === 'number' ? name : `"${name}"`}</span>
            <span style={{ color: colors.bracket, margin: '0 4px' }}>:</span>
          </>
        )}

        {isExpandable ? (
          <span style={{ color: colors.count, fontSize: 11 }}>{label}</span>
        ) : (
          renderValue()
        )}

        {hovered && (
          <button
            onClick={handleCopyPath}
            title={copied ? 'Copied!' : `Copy path: ${path}`}
            style={{
              marginLeft: 8,
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              padding: '1px 4px',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              color: copied ? 'var(--accent-blue, #58a6ff)' : 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            <Copy size={10} />
            {copied ? 'Copied' : 'Path'}
          </button>
        )}
      </div>

      {isExpandable && expanded && (
        <div>
          {filteredEntries.map(({ key, val }) => {
            const childPath = typeof key === 'number'
              ? `${path}[${key}]`
              : path ? `${path}.${key}` : String(key)
            return (
              <JsonNode
                key={String(key)}
                name={key}
                value={val}
                path={childPath}
                segments={[...segments, key]}
                depth={depth + 1}
                defaultExpanded={depth < 1}
                filter={filter}
                onEdit={onEdit}
              />
            )
          })}
          {filter && filteredEntries.length === 0 && (
            <div style={{ marginLeft: 16, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '2px 0' }}>
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────
export default function JsonTreeViewer({
  content,
  onChange,
}: {
  content: string
  onChange?: (newContent: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  const parsed = useMemo(() => {
    try {
      const result = JSON.parse(content)
      setParseError(null)
      return result
    } catch (e: unknown) {
      setParseError((e as Error).message)
      return null
    }
  }, [content])

  const handleEdit = useCallback((segments: PathSegment[], literal: string) => {
    if (!onChange) return
    const next = replaceJsonValue(content, segments, literal)
    if (next !== null && next !== content) onChange(next)
  }, [content, onChange])

  if (parseError) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        <div style={{ color: '#f85149', marginBottom: 8 }}>Invalid JSON</div>
        <div style={{ fontSize: 11, opacity: 0.7, maxWidth: 400, textAlign: 'center' }}>{parseError}</div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Search bar */}
      <div style={{
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value.toLowerCase())}
          placeholder="Filter properties..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            outline: 'none',
          }}
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        <JsonNode
          name={null}
          value={parsed}
          path=""
          segments={[]}
          depth={0}
          defaultExpanded={true}
          filter={filter}
          onEdit={handleEdit}
        />
      </div>
    </div>
  )
}
