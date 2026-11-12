import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useSnippetStore, type Snippet, type VSCodeSnippetFormat } from '@/store/snippets'
import { useToastStore } from '@/store/toast'
import {
  X, Plus, Trash2, Edit3, Download, Upload,
  Code, ChevronDown, ChevronRight, Save, Search,
  Eye, Lock, Copy, FileJson, Info, Zap,
  Tag, AlertTriangle, BarChart3,
  GripVertical, ArrowUpDown, Star, Clock,
  Hash, FolderOpen, Check,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  open: boolean
  onClose: () => void
}

type SideTab = 'snippets' | 'variables' | 'stats'
type ImportFormat = 'orion' | 'vscode'

interface SnippetFormData {
  name: string
  prefix: string
  body: string
  description: string
  language: string
  category: string
}

interface SnippetMeta {
  category: string
  usageCount: number
  lastUsed: number | null
  tags: string[]
}

interface DragState {
  snippetId: string | null
  overSnippetId: string | null
  overLang: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const LANGUAGE_OPTIONS = [
  { value: 'global', label: 'Global (all languages)' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'cpp', label: 'C++' },
  { value: 'shell', label: 'Shell/Bash' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
]

const CATEGORY_OPTIONS = [
  'Uncategorized',
  'Control Flow',
  'Functions',
  'Classes',
  'Imports',
  'Testing',
  'Logging',
  'Error Handling',
  'DOM / UI',
  'Data Structures',
  'Async / Promises',
  'Comments / Docs',
  'Boilerplate',
  'Custom',
]

const TAB_STOP_HELP = [
  { syntax: '$1, $2, ...', desc: 'Tab stops (cursor positions in order)' },
  { syntax: '$0', desc: 'Final cursor position after all tab stops' },
  { syntax: '${1:placeholder}', desc: 'Tab stop with default placeholder text' },
  { syntax: '${1|one,two,three|}', desc: 'Tab stop with choice dropdown' },
  { syntax: '${1:nested ${2:inner}}', desc: 'Nested placeholders' },
  { syntax: '${1/regex/replace/flags}', desc: 'Tab stop with regex transform' },
]

const VARIABLE_HELP = [
  { syntax: '$TM_SELECTED_TEXT', desc: 'Currently selected text' },
  { syntax: '$TM_CURRENT_LINE', desc: 'Contents of the current line' },
  { syntax: '$TM_CURRENT_WORD', desc: 'Word under cursor' },
  { syntax: '$TM_FILENAME', desc: 'Filename of the current document' },
  { syntax: '$TM_FILENAME_BASE', desc: 'Filename without extension' },
  { syntax: '$TM_DIRECTORY', desc: 'Directory of the current document' },
  { syntax: '$TM_FILEPATH', desc: 'Full file path of the current document' },
  { syntax: '$RELATIVE_FILEPATH', desc: 'Relative file path' },
  { syntax: '$CLIPBOARD', desc: 'Contents of the clipboard' },
  { syntax: '$WORKSPACE_NAME', desc: 'Name of the opened workspace' },
  { syntax: '$WORKSPACE_FOLDER', desc: 'Path of the opened workspace' },
  { syntax: '$CURRENT_YEAR', desc: 'Current year (e.g. 2026)' },
  { syntax: '$CURRENT_YEAR_SHORT', desc: 'Current year, last two digits' },
  { syntax: '$CURRENT_MONTH', desc: 'Month as two digits (01-12)' },
  { syntax: '$CURRENT_MONTH_NAME', desc: 'Full month name (e.g. January)' },
  { syntax: '$CURRENT_MONTH_NAME_SHORT', desc: 'Short month name (e.g. Jan)' },
  { syntax: '$CURRENT_DATE', desc: 'Day of month as two digits' },
  { syntax: '$CURRENT_DAY_NAME', desc: 'Day name (e.g. Monday)' },
  { syntax: '$CURRENT_DAY_NAME_SHORT', desc: 'Short day name (e.g. Mon)' },
  { syntax: '$CURRENT_HOUR', desc: 'Current hour (24h format)' },
  { syntax: '$CURRENT_MINUTE', desc: 'Current minute' },
  { syntax: '$CURRENT_SECOND', desc: 'Current second' },
  { syntax: '$RANDOM', desc: 'Six random decimal digits' },
  { syntax: '$RANDOM_HEX', desc: 'Six random hex digits' },
  { syntax: '$UUID', desc: 'UUID v4' },
  { syntax: '$LINE_COMMENT', desc: 'Line comment for current language' },
  { syntax: '$BLOCK_COMMENT_START', desc: 'Block comment start for language' },
  { syntax: '$BLOCK_COMMENT_END', desc: 'Block comment end for language' },
]

const TRANSFORM_HELP = [
  { syntax: '${TM_FILENAME/(.*)/${1:/upcase}/}', desc: 'Transform variable with upcase' },
  { syntax: '${TM_FILENAME/(.*)/${1:/downcase}/}', desc: 'Transform variable with downcase' },
  { syntax: '${TM_FILENAME/(.*)/${1:/capitalize}/}', desc: 'Capitalize first letter' },
  { syntax: '${TM_FILENAME/(.*)/${1:/camelcase}/}', desc: 'Convert to camelCase' },
  { syntax: '${TM_FILENAME/(.*)/${1:/pascalcase}/}', desc: 'Convert to PascalCase' },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Shared Styles
   ═══════════════════════════════════════════════════════════════════════════ */

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '5px 8px',
  fontSize: 12,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color, var(--border))',
  borderRadius: 4,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const monoInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "'Cascadia Code', 'Fira Code', monospace",
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const smallBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 22,
  color: 'var(--text-muted)',
  background: 'transparent',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
}

const pillBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color, var(--border))',
  borderRadius: 5,
  cursor: 'pointer',
}

/* ═══════════════════════════════════════════════════════════════════════════
   Metadata Persistence (localStorage)
   ═══════════════════════════════════════════════════════════════════════════ */

const META_STORAGE_KEY = 'orion-snippet-meta'

function loadMeta(): Record<string, SnippetMeta> {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveMeta(meta: Record<string, SnippetMeta>) {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta))
  } catch { /* ignore */ }
}

function getMetaForSnippet(meta: Record<string, SnippetMeta>, id: string): SnippetMeta {
  return meta[id] || { category: 'Uncategorized', usageCount: 0, lastUsed: null, tags: [] }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Snippet Body Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/** Render snippet body as a preview, replacing tab-stop syntax with visual hints */
function renderPreview(body: string): string {
  let out = body
  out = out.replace(/\$\{(\d+):([^}]+)\}/g, (_m, _n, placeholder) => placeholder)
  out = out.replace(/\$\{(\d+)\|([^}]+)\|\}/g, (_m, _n, choices) => choices.split(',')[0] || '')
  out = out.replace(/\$\{(\d+)\/[^}]+\}/g, '')
  out = out.replace(/\$(\d+)/g, (_m, n) => (n === '0' ? '|' : ''))
  out = out.replace(/\$TM_FILENAME/g, 'example.ts')
  out = out.replace(/\$TM_FILENAME_BASE/g, 'example')
  out = out.replace(/\$CLIPBOARD/g, '<clipboard>')
  out = out.replace(/\$CURRENT_YEAR/g, new Date().getFullYear().toString())
  out = out.replace(/\$CURRENT_MONTH/g, String(new Date().getMonth() + 1).padStart(2, '0'))
  out = out.replace(/\$CURRENT_DATE/g, String(new Date().getDate()).padStart(2, '0'))
  out = out.replace(/\$UUID/g, 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx')
  out = out.replace(/\$RANDOM_HEX/g, 'a1b2c3')
  out = out.replace(/\$RANDOM/g, '123456')
  out = out.replace(/\$WORKSPACE_NAME/g, 'my-project')
  out = out.replace(/\$LINE_COMMENT/g, '//')
  out = out.replace(/\$BLOCK_COMMENT_START/g, '/*')
  out = out.replace(/\$BLOCK_COMMENT_END/g, '*/')
  out = out.replace(/\$\w+/g, '')
  out = out.replace(/\t/g, '  ')
  return out
}

/** Highlight tab-stop syntax in the body for the code view */
function highlightBody(body: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\$\{\d+\/[^}]+\}|\$\{\d+\|[^}]+\|\}|\$\{\d+:[^}]+\}|\$\d+|\$[A-Z_]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{body.slice(lastIndex, match.index)}</span>)
    }
    const isVariable = /^\$[A-Z_]+$/.test(match[0])
    const isTransform = /^\$\{\d+\//.test(match[0])
    parts.push(
      <span
        key={key++}
        style={{
          color: isVariable
            ? 'var(--text-warning, #e5a84b)'
            : isTransform
            ? '#c084fc'
            : 'var(--accent)',
          background: isVariable
            ? 'rgba(229, 168, 75, 0.1)'
            : isTransform
            ? 'rgba(192, 132, 252, 0.1)'
            : 'rgba(var(--accent-rgb, 59,130,246), 0.12)',
          borderRadius: 2,
          padding: '0 2px',
        }}
      >
        {match[0]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) {
    parts.push(<span key={key++}>{body.slice(lastIndex)}</span>)
  }
  return parts
}

/* ═══════════════════════════════════════════════════════════════════════════
   Duplicate / Conflict Detection
   ═══════════════════════════════════════════════════════════════════════════ */

interface PrefixConflict {
  snippetId: string
  conflictsWith: Array<{ id: string; name: string; language: string }>
}

function detectPrefixConflicts(snippets: Snippet[]): Map<string, PrefixConflict> {
  const map = new Map<string, PrefixConflict>()
  const byPrefixLang = new Map<string, Snippet[]>()

  for (const s of snippets) {
    const key = `${s.prefix.toLowerCase()}::${s.language}`
    const globalKey = `${s.prefix.toLowerCase()}::global`

    if (!byPrefixLang.has(key)) byPrefixLang.set(key, [])
    byPrefixLang.get(key)!.push(s)

    // Also check global scope overlap
    if (s.language !== 'global') {
      if (!byPrefixLang.has(globalKey)) byPrefixLang.set(globalKey, [])
      // Only track as conflict if a global snippet with same prefix exists
    }
  }

  for (const [, group] of byPrefixLang) {
    if (group.length > 1) {
      for (const s of group) {
        const others = group.filter((o) => o.id !== s.id)
        if (others.length > 0) {
          map.set(s.id, {
            snippetId: s.id,
            conflictsWith: others.map((o) => ({ id: o.id, name: o.name, language: o.language })),
          })
        }
      }
    }
  }

  // Cross-check: global snippets conflict with language-specific ones with same prefix
  const globalSnippets = snippets.filter((s) => s.language === 'global')
  const langSnippets = snippets.filter((s) => s.language !== 'global')

  for (const gs of globalSnippets) {
    const clashes = langSnippets.filter(
      (ls) => ls.prefix.toLowerCase() === gs.prefix.toLowerCase()
    )
    if (clashes.length > 0) {
      const existing = map.get(gs.id)
      const newConflicts = clashes.map((c) => ({ id: c.id, name: c.name, language: c.language }))
      if (existing) {
        const existingIds = new Set(existing.conflictsWith.map((c) => c.id))
        for (const nc of newConflicts) {
          if (!existingIds.has(nc.id)) existing.conflictsWith.push(nc)
        }
      } else {
        map.set(gs.id, { snippetId: gs.id, conflictsWith: newConflicts })
      }
      for (const cl of clashes) {
        const ex = map.get(cl.id)
        if (ex) {
          if (!ex.conflictsWith.find((c) => c.id === gs.id)) {
            ex.conflictsWith.push({ id: gs.id, name: gs.name, language: gs.language })
          }
        } else {
          map.set(cl.id, {
            snippetId: cl.id,
            conflictsWith: [{ id: gs.id, name: gs.name, language: gs.language }],
          })
        }
      }
    }
  }

  return map
}

/* ═══════════════════════════════════════════════════════════════════════════
   Snippet Form (Create / Edit)
   ═══════════════════════════════════════════════════════════════════════════ */

function SnippetForm({
  initial,
  onSave,
  onCancel,
  saveLabel,
  existingPrefixes,
}: {
  initial: SnippetFormData
  onSave: (data: SnippetFormData) => void
  onCancel: () => void
  saveLabel: string
  existingPrefixes?: Array<{ prefix: string; language: string; name: string }>
}) {
  const [data, setData] = useState<SnippetFormData>(initial)
  const [showPreview, setShowPreview] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [helpTab, setHelpTab] = useState<'tabstops' | 'variables' | 'transforms'>('tabstops')
  const [newTag, setNewTag] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const update = (key: keyof SnippetFormData, value: string) =>
    setData((prev) => ({ ...prev, [key]: value }))

  const valid = data.name.trim() && data.prefix.trim() && data.body.trim()

  // Detect prefix conflicts with existing snippets
  const prefixConflicts = useMemo(() => {
    if (!existingPrefixes || !data.prefix.trim()) return []
    return existingPrefixes.filter(
      (ep) =>
        ep.prefix.toLowerCase() === data.prefix.trim().toLowerCase() &&
        (ep.language === data.language || ep.language === 'global' || data.language === 'global')
    )
  }, [existingPrefixes, data.prefix, data.language])

  /** Insert text at the current cursor position in the body textarea */
  const insertAtCursor = useCallback(
    (text: string) => {
      const ta = bodyRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newBody = data.body.slice(0, start) + text + data.body.slice(end)
      setData((prev) => ({ ...prev, body: newBody }))
      requestAnimationFrame(() => {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = start + text.length
      })
    },
    [data.body]
  )

  const helpItems =
    helpTab === 'tabstops'
      ? TAB_STOP_HELP
      : helpTab === 'variables'
      ? VARIABLE_HELP
      : TRANSFORM_HELP

  return (
    <div
      style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border-color, var(--border))',
        background: 'var(--bg-tertiary)',
      }}
    >
      {/* Row 1: name, prefix, language */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Name</label>
          <input
            value={data.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Arrow Function"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Prefix (trigger text)</label>
          <input
            value={data.prefix}
            onChange={(e) => update('prefix', e.target.value)}
            placeholder="e.g. arrow"
            style={{
              ...monoInputStyle,
              borderColor: prefixConflicts.length > 0 ? 'var(--text-warning, #e5a84b)' : undefined,
            }}
          />
          {prefixConflicts.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 3,
                fontSize: 10,
                color: 'var(--text-warning, #e5a84b)',
              }}
            >
              <AlertTriangle size={10} />
              Conflicts with: {prefixConflicts.map((c) => c.name).join(', ')}
            </div>
          )}
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Language Scope</label>
          <select
            value={data.language}
            onChange={(e) => update('language', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: description + category */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Description</label>
          <input
            value={data.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="Brief description of what this snippet does"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Category</label>
          <select
            value={data.category}
            onChange={(e) => update('category', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 3: body with preview toggle + help toggle */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={labelStyle}>
            Body (use $1, $2 for tab stops, {'${1:placeholder}'} for defaults, $0 for final cursor)
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => {
                setShowHelp(!showHelp)
                if (showHelp) setShowPreview(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: 10,
                color: showHelp ? 'var(--accent)' : 'var(--text-muted)',
                background: showHelp ? 'var(--bg-active)' : 'transparent',
                border: '1px solid var(--border-color, var(--border))',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <Info size={10} /> Reference
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: 10,
                color: showPreview ? 'var(--accent)' : 'var(--text-muted)',
                background: showPreview ? 'var(--bg-active)' : 'transparent',
                border: '1px solid var(--border-color, var(--border))',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <Eye size={10} /> Preview
            </button>
          </div>
        </div>

        {/* Reference helper panel */}
        {showHelp && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 6,
              border: '1px solid var(--border-color, var(--border))',
              borderRadius: 4,
              background: 'var(--bg-primary)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color, var(--border))' }}>
              {(['tabstops', 'variables', 'transforms'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHelpTab(tab)}
                  style={{
                    flex: 1,
                    padding: '5px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: helpTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                    background: helpTab === tab ? 'var(--bg-active)' : 'transparent',
                    border: 'none',
                    borderRight: tab !== 'transforms' ? '1px solid var(--border-color, var(--border))' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {tab === 'tabstops' ? 'Tab Stops' : tab === 'variables' ? 'Variables' : 'Transforms'}
                </button>
              ))}
            </div>
            <div style={{ maxHeight: 140, overflowY: 'auto', padding: '6px 10px' }}>
              {helpItems.map((item, i) => (
                <div
                  key={i}
                  onClick={() => insertAtCursor(item.syntax)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '3px 4px',
                    cursor: 'pointer',
                    borderRadius: 3,
                    fontSize: 11,
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <code
                    style={{
                      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                      fontSize: 10,
                      color:
                        helpTab === 'variables'
                          ? 'var(--text-warning, #e5a84b)'
                          : helpTab === 'transforms'
                          ? '#c084fc'
                          : 'var(--accent)',
                      background: 'var(--bg-tertiary)',
                      padding: '1px 6px',
                      borderRadius: 3,
                      flexShrink: 0,
                      minWidth: helpTab === 'transforms' ? 260 : helpTab === 'variables' ? 180 : 140,
                    }}
                  >
                    {item.syntax}
                  </code>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              ref={bodyRef}
              value={data.body}
              onChange={(e) => update('body', e.target.value)}
              placeholder={"e.g. const ${1:name} = (${2:params}) => {\n\t$0\n};"}
              rows={6}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 12,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color, var(--border))',
                borderRadius: 4,
                color: 'var(--text-primary)',
                outline: 'none',
                fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                resize: 'vertical',
                lineHeight: 1.5,
                tabSize: 2,
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const target = e.target as HTMLTextAreaElement
                  const start = target.selectionStart
                  const end = target.selectionEnd
                  const newVal = data.body.slice(0, start) + '\t' + data.body.slice(end)
                  update('body', newVal)
                  requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = start + 1
                  })
                }
              }}
            />
            {/* Syntax-highlighted overlay (read-only) */}
            {data.body && !showPreview && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  pointerEvents: 'none',
                  color: 'transparent',
                  tabSize: 2,
                  overflow: 'hidden',
                }}
              >
                {highlightBody(data.body)}
              </div>
            )}
          </div>
          {showPreview && (
            <div
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 12,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color, var(--border))',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                lineHeight: 1.5,
                whiteSpace: 'pre',
                overflow: 'auto',
                maxHeight: 200,
                tabSize: 2,
              }}
            >
              {renderPreview(data.body)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '5px 14px',
            fontSize: 11,
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color, var(--border))',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => valid && onSave(data)}
          disabled={!valid}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 14px',
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: valid ? 'var(--accent)' : 'var(--bg-active)',
            border: 'none',
            borderRadius: 4,
            cursor: valid ? 'pointer' : 'not-allowed',
            opacity: valid ? 1 : 0.5,
          }}
        >
          <Save size={11} /> {saveLabel}
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Import / Export Format Dialogs
   ═══════════════════════════════════════════════════════════════════════════ */

function ImportFormatDialog({
  onImport,
  onCancel,
}: {
  onImport: (format: ImportFormat) => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 50,
        right: 80,
        zIndex: 220,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-bright, var(--border-color, var(--border)))',
        borderRadius: 6,
        boxShadow: 'var(--shadow-xl)',
        padding: 12,
        width: 260,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
        Import Snippets
      </div>
      <button
        onClick={() => onImport('orion')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-primary)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 4,
          cursor: 'pointer',
          marginBottom: 6,
          textAlign: 'left',
        }}
      >
        <FileJson size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>Orion Format</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            Array of snippet objects (Orion export)
          </div>
        </div>
      </button>
      <button
        onClick={() => onImport('vscode')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-primary)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 4,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Code size={14} style={{ color: 'var(--text-warning, #e5a84b)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>VS Code Format</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            VS Code snippet JSON (e.g. javascript.json)
          </div>
        </div>
      </button>
      <button
        onClick={onCancel}
        style={{
          width: '100%',
          marginTop: 8,
          padding: '4px 8px',
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  )
}

function ExportFormatDialog({
  onExport,
  onCancel,
}: {
  onExport: (format: 'orion' | 'vscode') => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 50,
        right: 120,
        zIndex: 220,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-bright, var(--border-color, var(--border)))',
        borderRadius: 6,
        boxShadow: 'var(--shadow-xl)',
        padding: 12,
        width: 260,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
        Export Snippets
      </div>
      <button
        onClick={() => onExport('orion')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-primary)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 4,
          cursor: 'pointer',
          marginBottom: 6,
          textAlign: 'left',
        }}
      >
        <FileJson size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>Orion Format</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            Array of snippet objects
          </div>
        </div>
      </button>
      <button
        onClick={() => onExport('vscode')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-primary)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 4,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Code size={14} style={{ color: 'var(--text-warning, #e5a84b)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>VS Code Format</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            Compatible with VS Code snippet files
          </div>
        </div>
      </button>
      <button
        onClick={onCancel}
        style={{
          width: '100%',
          marginTop: 8,
          padding: '4px 8px',
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Usage Stats Panel
   ═══════════════════════════════════════════════════════════════════════════ */

function UsageStatsPanel({
  snippets,
  meta,
}: {
  snippets: Snippet[]
  meta: Record<string, SnippetMeta>
}) {
  const sorted = useMemo(() => {
    return [...snippets]
      .map((s) => ({ ...s, meta: getMetaForSnippet(meta, s.id) }))
      .sort((a, b) => b.meta.usageCount - a.meta.usageCount)
      .slice(0, 25)
  }, [snippets, meta])

  const totalUsage = useMemo(
    () => sorted.reduce((sum, s) => sum + s.meta.usageCount, 0),
    [sorted]
  )

  const maxUsage = sorted.length > 0 ? sorted[0].meta.usageCount : 1

  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border-color, var(--border))',
        }}
      >
        <BarChart3 size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Usage Statistics
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {totalUsage} total insertions
        </span>
      </div>

      {sorted.length === 0 || totalUsage === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: 12 }}>
          No usage data yet. Start using snippets to see statistics here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sorted
            .filter((s) => s.meta.usageCount > 0)
            .map((s, idx) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  style={{
                    width: 20,
                    textAlign: 'right',
                    color: idx < 3 ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: idx < 3 ? 700 : 400,
                    fontSize: 10,
                    flexShrink: 0,
                  }}
                >
                  #{idx + 1}
                </span>
                <code
                  style={{
                    padding: '1px 6px',
                    fontSize: 10,
                    background: 'var(--bg-active)',
                    borderRadius: 3,
                    color: 'var(--accent)',
                    fontWeight: 600,
                    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                    flexShrink: 0,
                    minWidth: 50,
                    textAlign: 'center',
                  }}
                >
                  {s.prefix}
                </code>
                <span
                  style={{
                    flex: 1,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </span>
                {/* Bar */}
                <div
                  style={{
                    width: 80,
                    height: 6,
                    background: 'var(--bg-primary)',
                    borderRadius: 3,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: `${(s.meta.usageCount / maxUsage) * 100}%`,
                      height: '100%',
                      background: idx < 3 ? 'var(--accent)' : 'var(--text-muted)',
                      borderRadius: 3,
                      opacity: idx < 3 ? 1 : 0.5,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 30,
                    textAlign: 'right',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                    flexShrink: 0,
                  }}
                >
                  {s.meta.usageCount}
                </span>
                {s.meta.lastUsed && (
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      width: 60,
                    }}
                  >
                    {new Date(s.meta.lastUsed).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Category breakdown */}
      <div
        style={{
          marginTop: 20,
          paddingTop: 14,
          borderTop: '1px solid var(--border-color, var(--border))',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}
        >
          Usage by Category
        </div>
        {(() => {
          const catMap = new Map<string, number>()
          for (const s of sorted) {
            const cat = s.meta.category || 'Uncategorized'
            catMap.set(cat, (catMap.get(cat) || 0) + s.meta.usageCount)
          }
          const catEntries = [...catMap.entries()].sort((a, b) => b[1] - a[1])
          const catMax = catEntries.length > 0 ? catEntries[0][1] : 1

          return catEntries.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
              No category data available.
            </div>
          ) : (
            catEntries.map(([cat, count]) => (
              <div
                key={cat}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  fontSize: 11,
                }}
              >
                <Tag size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ width: 120, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {cat}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: 'var(--bg-primary)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(count / catMax) * 100}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 3,
                      opacity: 0.6,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 30,
                    textAlign: 'right',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                  }}
                >
                  {count}
                </span>
              </div>
            ))
          )
        })()}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Variables Reference Panel
   ═══════════════════════════════════════════════════════════════════════════ */

function VariablesPanel() {
  const [searchVar, setSearchVar] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['text', 'file', 'datetime', 'random', 'comment'])
  )

  const sections = useMemo(
    () => [
      {
        id: 'text',
        label: 'Text & Selection',
        items: VARIABLE_HELP.filter((v) =>
          ['$TM_SELECTED_TEXT', '$TM_CURRENT_LINE', '$TM_CURRENT_WORD', '$CLIPBOARD'].includes(
            v.syntax
          )
        ),
      },
      {
        id: 'file',
        label: 'File & Workspace',
        items: VARIABLE_HELP.filter((v) =>
          [
            '$TM_FILENAME',
            '$TM_FILENAME_BASE',
            '$TM_DIRECTORY',
            '$TM_FILEPATH',
            '$RELATIVE_FILEPATH',
            '$WORKSPACE_NAME',
            '$WORKSPACE_FOLDER',
          ].includes(v.syntax)
        ),
      },
      {
        id: 'datetime',
        label: 'Date & Time',
        items: VARIABLE_HELP.filter((v) => v.syntax.startsWith('$CURRENT_')),
      },
      {
        id: 'random',
        label: 'Random',
        items: VARIABLE_HELP.filter((v) =>
          ['$RANDOM', '$RANDOM_HEX', '$UUID'].includes(v.syntax)
        ),
      },
      {
        id: 'comment',
        label: 'Comments',
        items: VARIABLE_HELP.filter((v) =>
          ['$LINE_COMMENT', '$BLOCK_COMMENT_START', '$BLOCK_COMMENT_END'].includes(v.syntax)
        ),
      },
    ],
    []
  )

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!searchVar.trim()) return sections
    const q = searchVar.toLowerCase()
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (item) =>
            item.syntax.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.items.length > 0)
  }, [sections, searchVar])

  const handleCopy = (syntax: string) => {
    navigator.clipboard.writeText(syntax).catch(() => {})
  }

  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border-color, var(--border))',
        }}
      >
        <Hash size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Snippet Variables Reference
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-primary)',
          borderRadius: 5,
          border: '1px solid var(--border-color, var(--border))',
          padding: '0 8px',
          marginBottom: 10,
        }}
      >
        <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={searchVar}
          onChange={(e) => setSearchVar(e.target.value)}
          placeholder="Search variables..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 11,
            color: 'var(--text-primary)',
            padding: '5px 0',
          }}
        />
      </div>

      {filtered.map((section) => (
        <div key={section.id} style={{ marginBottom: 6 }}>
          <div
            onClick={() => toggleSection(section.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 4px',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              userSelect: 'none',
            }}
          >
            {expandedSections.has(section.id) ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            {section.label}
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>
              ({section.items.length})
            </span>
          </div>
          {expandedSections.has(section.id) && (
            <div style={{ paddingLeft: 10 }}>
              {section.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => handleCopy(item.syntax)}
                  title="Click to copy"
                >
                  <code
                    style={{
                      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                      fontSize: 10,
                      color: 'var(--text-warning, #e5a84b)',
                      background: 'var(--bg-tertiary)',
                      padding: '2px 6px',
                      borderRadius: 3,
                      flexShrink: 0,
                      minWidth: 170,
                    }}
                  >
                    {item.syntax}
                  </code>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, flex: 1 }}>
                    {item.desc}
                  </span>
                  <Copy
                    size={10}
                    style={{ color: 'var(--text-muted)', opacity: 0.5, flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Transforms section */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-color, var(--border))' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
          }}
        >
          Variable Transforms
        </div>
        {TRANSFORM_HELP.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 6px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleCopy(item.syntax)}
            title="Click to copy"
          >
            <code
              style={{
                fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                fontSize: 9,
                color: '#c084fc',
                background: 'var(--bg-tertiary)',
                padding: '2px 6px',
                borderRadius: 3,
                flexShrink: 0,
              }}
            >
              {item.syntax}
            </code>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, flex: 1 }}>{item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SnippetManager({ open, onClose }: Props) {
  const {
    snippets,
    userSnippets,
    createSnippet,
    updateSnippet,
    deleteSnippet,
    importSnippets,
    importVSCodeSnippets,
    exportSnippets,
    exportVSCodeFormat,
    insertSnippetAtCursor,
  } = useSnippetStore()

  // ── State ──────────────────────────────────────────────────────────────
  const [sideTab, setSideTab] = useState<SideTab>('snippets')
  const [filterLang, setFilterLang] = useState<string>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterSource, setFilterSource] = useState<'all' | 'builtin' | 'user'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [collapsedLangs, setCollapsedLangs] = useState<Set<string>>(new Set())
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<'language' | 'category'>('language')
  const [sortBy, setSortBy] = useState<'name' | 'prefix' | 'usage'>('name')
  const [snippetMeta, setSnippetMeta] = useState<Record<string, SnippetMeta>>(loadMeta)
  const [dragState, setDragState] = useState<DragState>({
    snippetId: null,
    overSnippetId: null,
    overLang: null,
  })
  const [showConflictsOnly, setShowConflictsOnly] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const importFormatRef = useRef<ImportFormat>('orion')
  const listRef = useRef<HTMLDivElement>(null)

  // ── Derived Data ───────────────────────────────────────────────────────
  const prefixConflicts = useMemo(() => detectPrefixConflicts(snippets), [snippets])
  const conflictCount = prefixConflicts.size

  const existingPrefixes = useMemo(
    () =>
      snippets.map((s) => ({
        prefix: s.prefix,
        language: s.language,
        name: s.name,
      })),
    [snippets]
  )

  const filteredSnippets = useMemo(() => {
    let result = snippets

    // Source filter
    if (filterSource === 'builtin') result = result.filter((s) => s.isBuiltin)
    else if (filterSource === 'user') result = result.filter((s) => !s.isBuiltin)

    // Language filter
    if (filterLang !== 'all') result = result.filter((s) => s.language === filterLang)

    // Category filter
    if (filterCategory !== 'all') {
      result = result.filter((s) => {
        const m = getMetaForSnippet(snippetMeta, s.id)
        return m.category === filterCategory
      })
    }

    // Conflicts only
    if (showConflictsOnly) {
      result = result.filter((s) => prefixConflicts.has(s.id))
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.prefix.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.language.toLowerCase().includes(q) ||
          getMetaForSnippet(snippetMeta, s.id).tags.some((t) => t.toLowerCase().includes(q))
      )
    }

    // Sort
    if (sortBy === 'prefix') {
      result = [...result].sort((a, b) => a.prefix.localeCompare(b.prefix))
    } else if (sortBy === 'usage') {
      result = [...result].sort((a, b) => {
        const ua = getMetaForSnippet(snippetMeta, a.id).usageCount
        const ub = getMetaForSnippet(snippetMeta, b.id).usageCount
        return ub - ua
      })
    } else {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name))
    }

    return result
  }, [snippets, filterLang, filterCategory, filterSource, searchQuery, sortBy, showConflictsOnly, snippetMeta, prefixConflicts])

  // Group snippets
  const grouped = useMemo(() => {
    const map = new Map<string, Snippet[]>()
    for (const s of filteredSnippets) {
      const groupKey =
        groupBy === 'language' ? s.language : getMetaForSnippet(snippetMeta, s.id).category
      if (!map.has(groupKey)) map.set(groupKey, [])
      map.get(groupKey)!.push(s)
    }
    const sorted = new Map(
      [...map.entries()].sort(([a], [b]) => {
        if (a === 'global' || a === 'Uncategorized') return -1
        if (b === 'global' || b === 'Uncategorized') return 1
        return a.localeCompare(b)
      })
    )
    return sorted
  }, [filteredSnippets, groupBy, snippetMeta])

  const selectedSnippet = useMemo(
    () => (selectedSnippetId ? snippets.find((s) => s.id === selectedSnippetId) : null),
    [selectedSnippetId, snippets]
  )

  // ── Callbacks ──────────────────────────────────────────────────────────
  const updateMeta = useCallback(
    (id: string, changes: Partial<SnippetMeta>) => {
      setSnippetMeta((prev) => {
        const current = getMetaForSnippet(prev, id)
        const next = { ...prev, [id]: { ...current, ...changes } }
        saveMeta(next)
        return next
      })
    },
    []
  )

  const recordUsage = useCallback(
    (id: string) => {
      setSnippetMeta((prev) => {
        const current = getMetaForSnippet(prev, id)
        const next = {
          ...prev,
          [id]: { ...current, usageCount: current.usageCount + 1, lastUsed: Date.now() },
        }
        saveMeta(next)
        return next
      })
    },
    []
  )

  const toggleLangCollapse = useCallback((lang: string) => {
    setCollapsedLangs((prev) => {
      const next = new Set(prev)
      if (next.has(lang)) next.delete(lang)
      else next.add(lang)
      return next
    })
  }, [])

  const handleAdd = useCallback(
    (data: SnippetFormData) => {
      const id = createSnippet({
        name: data.name.trim(),
        prefix: data.prefix.trim(),
        body: data.body,
        description: data.description.trim() || data.name.trim(),
        language: data.language,
      })
      // Save meta for the new snippet
      if (data.category !== 'Uncategorized') {
        // We need the ID; for now use a heuristic since createSnippet may not return id
        // The newest snippet will be the last user snippet
        const newest = useSnippetStore.getState().userSnippets
        if (newest.length > 0) {
          const newId = newest[newest.length - 1].id
          updateMeta(newId, { category: data.category })
        }
      }
      setShowAddForm(false)
    },
    [createSnippet, updateMeta]
  )

  const handleSaveEdit = useCallback(
    (data: SnippetFormData) => {
      if (!editingId) return
      updateSnippet(editingId, {
        name: data.name.trim(),
        prefix: data.prefix.trim(),
        body: data.body,
        description: data.description.trim() || data.name.trim(),
        language: data.language,
      })
      updateMeta(editingId, { category: data.category })
      setEditingId(null)
    },
    [editingId, updateSnippet, updateMeta]
  )

  const handleExport = useCallback(
    (format: 'orion' | 'vscode') => {
      let json: string
      let filename: string
      if (format === 'vscode') {
        const data = exportVSCodeFormat()
        json = JSON.stringify(data, null, 2)
        filename = 'snippets.code-snippets'
      } else {
        const data = exportSnippets()
        json = JSON.stringify(data, null, 2)
        filename = 'orion-snippets.json'
      }
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setShowExportDialog(false)
    },
    [exportSnippets, exportVSCodeFormat]
  )

  const handleImportClick = useCallback((format: ImportFormat) => {
    importFormatRef.current = format
    setShowImportDialog(false)
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const raw = ev.target?.result as string
          const data = JSON.parse(raw)

          if (importFormatRef.current === 'vscode') {
            if (data && typeof data === 'object' && !Array.isArray(data)) {
              const count = importVSCodeSnippets(data as VSCodeSnippetFormat)
              setImportMsg(`Imported ${count} snippet${count !== 1 ? 's' : ''} from VS Code format`)
              setTimeout(() => setImportMsg(null), 3000)
            } else {
              setImportMsg('Invalid VS Code snippet format (expected JSON object)')
              setTimeout(() => setImportMsg(null), 3000)
            }
          } else {
            if (Array.isArray(data)) {
              const { imported, skipped } = importSnippets(data)
              setImportMsg(
                `Imported ${imported} snippet${imported !== 1 ? 's' : ''}` +
                  (skipped > 0 ? `, skipped ${skipped} without a text prefix and body` : ''),
              )
              setTimeout(() => setImportMsg(null), 3000)
            } else {
              setImportMsg('Invalid Orion format (expected JSON array)')
              setTimeout(() => setImportMsg(null), 3000)
            }
          }
        } catch {
          setImportMsg('Failed to parse JSON file')
          setTimeout(() => setImportMsg(null), 3000)
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [importSnippets, importVSCodeSnippets]
  )

  const handleInsertSnippet = useCallback(
    (snippet: Snippet) => {
      if (!insertSnippetAtCursor(snippet)) {
        useToastStore.getState().addToast({ type: 'warning', message: 'Open a file in the editor to insert a snippet.' })
        return
      }
      // Usage counts real insertions only; close so the user lands in the expanded snippet.
      recordUsage(snippet.id)
      onClose()
    },
    [insertSnippetAtCursor, recordUsage, onClose]
  )

  const handleCopyBody = useCallback((body: string) => {
    navigator.clipboard.writeText(body).catch(() => {})
  }, [])

  const langLabel = (lang: string) => {
    const opt = LANGUAGE_OPTIONS.find((o) => o.value === lang)
    return opt ? opt.label : lang.charAt(0).toUpperCase() + lang.slice(1)
  }

  // ── Drag-and-drop handlers for reordering ──────────────────────────────
  const handleDragStart = useCallback((snippetId: string) => {
    setDragState({ snippetId, overSnippetId: null, overLang: null })
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, snippetId?: string, lang?: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragState((prev) => ({
        ...prev,
        overSnippetId: snippetId || null,
        overLang: lang || null,
      }))
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    setDragState({ snippetId: null, overSnippetId: null, overLang: null })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetCategory?: string) => {
      e.preventDefault()
      const { snippetId } = dragState
      if (snippetId && targetCategory && groupBy === 'category') {
        updateMeta(snippetId, { category: targetCategory })
      }
      setDragState({ snippetId: null, overSnippetId: null, overLang: null })
    },
    [dragState, groupBy, updateMeta]
  )

  // ── Keyboard shortcuts listener ────────────────────────────────────────
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        if (showAddForm) setShowAddForm(false)
        else if (editingId) setEditingId(null)
        else onClose()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, showAddForm, editingId, onClose])

  if (!open) return null

  const builtinCount = snippets.filter((s) => s.isBuiltin).length

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 210,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="anim-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1060,
          maxHeight: '90vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-bright, var(--border-color, var(--border)))',
          borderRadius: 'var(--radius-lg, 8px)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-color, var(--border))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Code size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Snippet Manager
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {snippets.length} total ({builtinCount} built-in, {userSnippets.length} user)
            </span>
            {conflictCount > 0 && (
              <button
                onClick={() => setShowConflictsOnly(!showConflictsOnly)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: showConflictsOnly ? '#fff' : 'var(--text-warning, #e5a84b)',
                  background: showConflictsOnly
                    ? 'var(--text-warning, #e5a84b)'
                    : 'rgba(229, 168, 75, 0.1)',
                  border: '1px solid var(--text-warning, #e5a84b)',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                <AlertTriangle size={10} />
                {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => {
                setShowImportDialog(!showImportDialog)
                setShowExportDialog(false)
              }}
              title="Import snippets from JSON"
              style={pillBtnStyle}
            >
              <Upload size={12} /> Import
            </button>
            <button
              onClick={() => {
                setShowExportDialog(!showExportDialog)
                setShowImportDialog(false)
              }}
              title="Export user snippets as JSON"
              style={pillBtnStyle}
            >
              <Download size={12} /> Export
            </button>
            <button
              onClick={onClose}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                color: 'var(--text-muted)',
                background: 'transparent',
                border: 'none',
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.code-snippets"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>

        {/* Import/Export format dialogs */}
        {showImportDialog && (
          <ImportFormatDialog
            onImport={handleImportClick}
            onCancel={() => setShowImportDialog(false)}
          />
        )}
        {showExportDialog && (
          <ExportFormatDialog
            onExport={handleExport}
            onCancel={() => setShowExportDialog(false)}
          />
        )}

        {/* Import status message */}
        {importMsg && (
          <div
            style={{
              padding: '6px 18px',
              fontSize: 11,
              fontWeight: 500,
              color:
                importMsg.startsWith('Failed') || importMsg.startsWith('Invalid')
                  ? 'var(--text-error, #f87171)'
                  : 'var(--text-success, #4ade80)',
              background:
                importMsg.startsWith('Failed') || importMsg.startsWith('Invalid')
                  ? 'rgba(248,113,113,0.08)'
                  : 'rgba(74,222,128,0.08)',
              borderBottom: '1px solid var(--border-color, var(--border))',
            }}
          >
            {importMsg}
          </div>
        )}

        {/* ── Side Tab Bar + Toolbar ─────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            borderBottom: '1px solid var(--border-color, var(--border))',
          }}
        >
          {/* Side tabs */}
          <div style={{ display: 'flex', borderRight: '1px solid var(--border-color, var(--border))' }}>
            {([
              { id: 'snippets' as SideTab, icon: <Code size={13} />, label: 'Snippets' },
              { id: 'variables' as SideTab, icon: <Hash size={13} />, label: 'Variables' },
              { id: 'stats' as SideTab, icon: <BarChart3 size={13} />, label: 'Stats' },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSideTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '8px 14px',
                  fontSize: 11,
                  fontWeight: sideTab === tab.id ? 600 : 400,
                  color: sideTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                  background: sideTab === tab.id ? 'var(--bg-active)' : 'transparent',
                  border: 'none',
                  borderBottom: sideTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Toolbar (only for snippets tab) */}
          {sideTab === 'snippets' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--bg-primary)',
                  borderRadius: 5,
                  border: '1px solid var(--border-color, var(--border))',
                  padding: '0 8px',
                }}
              >
                <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, prefix, language, or tag..."
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    padding: '6px 0',
                    fontFamily: 'var(--font-sans)',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{ ...smallBtnStyle, width: 16, height: 16 }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Filter: language */}
              <select
                value={filterLang}
                onChange={(e) => setFilterLang(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: '5px 6px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color, var(--border))',
                  borderRadius: 5,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All Langs</option>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Filter: source */}
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as 'all' | 'builtin' | 'user')}
                style={{
                  fontSize: 11,
                  padding: '5px 6px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color, var(--border))',
                  borderRadius: 5,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All Sources</option>
                <option value="builtin">Built-in</option>
                <option value="user">User</option>
              </select>

              {/* Group by */}
              <button
                onClick={() => setGroupBy(groupBy === 'language' ? 'category' : 'language')}
                title={`Group by: ${groupBy}`}
                style={{
                  ...smallBtnStyle,
                  width: 'auto',
                  padding: '4px 8px',
                  gap: 4,
                  fontSize: 10,
                  border: '1px solid var(--border-color, var(--border))',
                  borderRadius: 4,
                  color: 'var(--text-muted)',
                }}
              >
                <FolderOpen size={11} />
                {groupBy === 'language' ? 'Lang' : 'Cat'}
              </button>

              {/* Sort */}
              <button
                onClick={() =>
                  setSortBy(sortBy === 'name' ? 'prefix' : sortBy === 'prefix' ? 'usage' : 'name')
                }
                title={`Sort by: ${sortBy}`}
                style={{
                  ...smallBtnStyle,
                  width: 'auto',
                  padding: '4px 8px',
                  gap: 4,
                  fontSize: 10,
                  border: '1px solid var(--border-color, var(--border))',
                  borderRadius: 4,
                  color: 'var(--text-muted)',
                }}
              >
                <ArrowUpDown size={11} />
                {sortBy === 'name' ? 'A-Z' : sortBy === 'prefix' ? 'Pfx' : 'Use'}
              </button>

              <button
                onClick={() => {
                  setShowAddForm(!showAddForm)
                  setEditingId(null)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: showAddForm ? 'var(--text-primary)' : '#fff',
                  background: showAddForm ? 'var(--bg-tertiary)' : 'var(--accent)',
                  border: 'none',
                  borderRadius: 5,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Plus size={13} /> New
              </button>
            </div>
          )}
        </div>

        {/* Add snippet form */}
        {sideTab === 'snippets' && showAddForm && (
          <SnippetForm
            initial={{
              name: '',
              prefix: '',
              body: '',
              description: '',
              language: 'javascript',
              category: 'Uncategorized',
            }}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saveLabel="Create Snippet"
            existingPrefixes={existingPrefixes}
          />
        )}

        {/* ── Main Content ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Variables panel */}
          {sideTab === 'variables' && <VariablesPanel />}

          {/* Stats panel */}
          {sideTab === 'stats' && (
            <UsageStatsPanel snippets={snippets} meta={snippetMeta} />
          )}

          {/* Snippets panel */}
          {sideTab === 'snippets' && (
            <>
              {/* Snippet list */}
              <div
                ref={listRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  borderRight: selectedSnippet
                    ? '1px solid var(--border-color, var(--border))'
                    : 'none',
                }}
              >
                {grouped.size === 0 ? (
                  <div
                    style={{
                      padding: '40px 16px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                    }}
                  >
                    {searchQuery
                      ? `No snippets matching "${searchQuery}"`
                      : showConflictsOnly
                      ? 'No prefix conflicts detected.'
                      : 'No snippets found'}
                  </div>
                ) : (
                  Array.from(grouped.entries()).map(([groupKey, groupSnippets]) => (
                    <div
                      key={groupKey}
                      onDragOver={(e) => handleDragOver(e, undefined, groupKey)}
                      onDrop={(e) => handleDrop(e, groupKey)}
                    >
                      {/* Group header */}
                      <div
                        onClick={() => toggleLangCollapse(groupKey)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 18px',
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          borderBottom: '1px solid var(--border-color, var(--border))',
                          background:
                            dragState.overLang === groupKey
                              ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)'
                              : 'var(--bg-primary)',
                          userSelect: 'none',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        {collapsedLangs.has(groupKey) ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                        {groupBy === 'language' ? langLabel(groupKey) : groupKey}
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 10,
                            fontWeight: 400,
                            color: 'var(--text-muted)',
                            opacity: 0.7,
                          }}
                        >
                          {groupSnippets.length} snippet{groupSnippets.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Snippets in this group */}
                      {!collapsedLangs.has(groupKey) &&
                        groupSnippets.map((snippet) => {
                          const sMeta = getMetaForSnippet(snippetMeta, snippet.id)
                          const conflict = prefixConflicts.get(snippet.id)
                          const isDragging = dragState.snippetId === snippet.id
                          const isDragOver = dragState.overSnippetId === snippet.id

                          return (
                            <div key={snippet.id}>
                              {editingId === snippet.id ? (
                                <SnippetForm
                                  initial={{
                                    name: snippet.name,
                                    prefix: snippet.prefix,
                                    body: snippet.body,
                                    description: snippet.description,
                                    language: snippet.language,
                                    category: sMeta.category,
                                  }}
                                  onSave={handleSaveEdit}
                                  onCancel={() => setEditingId(null)}
                                  saveLabel="Save Changes"
                                  existingPrefixes={existingPrefixes.filter(
                                    (ep) =>
                                      !(
                                        ep.prefix === snippet.prefix &&
                                        ep.language === snippet.language &&
                                        ep.name === snippet.name
                                      )
                                  )}
                                />
                              ) : (
                                /* Snippet row */
                                <div
                                  draggable={!snippet.isBuiltin && groupBy === 'category'}
                                  onDragStart={() => handleDragStart(snippet.id)}
                                  onDragEnd={handleDragEnd}
                                  onDragOver={(e) => handleDragOver(e, snippet.id)}
                                  onClick={() =>
                                    setSelectedSnippetId(
                                      selectedSnippetId === snippet.id ? null : snippet.id
                                    )
                                  }
                                  onDoubleClick={() => handleInsertSnippet(snippet)}
                                  title="Click to preview, double-click to insert at cursor"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '7px 18px',
                                    borderBottom: '1px solid var(--border-color, var(--border))',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    background:
                                      selectedSnippetId === snippet.id
                                        ? 'var(--bg-active)'
                                        : isDragOver
                                        ? 'rgba(var(--accent-rgb, 59,130,246), 0.06)'
                                        : 'transparent',
                                    opacity: isDragging ? 0.5 : 1,
                                    transition: 'background 0.1s ease',
                                  }}
                                >
                                  {/* Drag handle (category mode only) */}
                                  {!snippet.isBuiltin && groupBy === 'category' && (
                                    <GripVertical
                                      size={12}
                                      style={{
                                        color: 'var(--text-muted)',
                                        opacity: 0.4,
                                        flexShrink: 0,
                                        cursor: 'grab',
                                      }}
                                    />
                                  )}

                                  {/* Prefix badge */}
                                  <code
                                    style={{
                                      padding: '2px 8px',
                                      fontSize: 11,
                                      background: conflict
                                        ? 'rgba(229, 168, 75, 0.15)'
                                        : 'var(--bg-active)',
                                      borderRadius: 4,
                                      color: conflict ? 'var(--text-warning, #e5a84b)' : 'var(--accent)',
                                      fontWeight: 600,
                                      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                                      flexShrink: 0,
                                      minWidth: 60,
                                      textAlign: 'center',
                                      border: conflict
                                        ? '1px solid rgba(229, 168, 75, 0.3)'
                                        : '1px solid transparent',
                                    }}
                                    title={
                                      conflict
                                        ? `Prefix conflict with: ${conflict.conflictsWith.map((c) => c.name).join(', ')}`
                                        : undefined
                                    }
                                  >
                                    {snippet.prefix}
                                  </code>

                                  {/* Info */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 12,
                                          color: 'var(--text-primary)',
                                          fontWeight: 500,
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {snippet.name}
                                      </span>
                                      {conflict && (
                                        <AlertTriangle
                                          size={10}
                                          style={{
                                            color: 'var(--text-warning, #e5a84b)',
                                            flexShrink: 0,
                                          }}
                                        />
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        fontSize: 10,
                                        color: 'var(--text-muted)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {snippet.description}
                                      </span>
                                      {sMeta.category !== 'Uncategorized' && (
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 2,
                                            padding: '0 4px',
                                            background: 'var(--bg-active)',
                                            borderRadius: 3,
                                            fontSize: 9,
                                            flexShrink: 0,
                                          }}
                                        >
                                          <Tag size={7} /> {sMeta.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Usage count */}
                                  {sMeta.usageCount > 0 && (
                                    <span
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        fontSize: 9,
                                        color: 'var(--text-muted)',
                                        opacity: 0.7,
                                        flexShrink: 0,
                                      }}
                                    >
                                      <Zap size={8} /> {sMeta.usageCount}
                                    </span>
                                  )}

                                  {/* Actions */}
                                  {snippet.isBuiltin ? (
                                    <span
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        fontSize: 9,
                                        color: 'var(--text-muted)',
                                        opacity: 0.6,
                                        padding: '1px 6px',
                                        borderRadius: 3,
                                        border: '1px solid var(--border-color, var(--border))',
                                        flexShrink: 0,
                                      }}
                                    >
                                      <Lock size={8} /> built-in
                                    </span>
                                  ) : (
                                    <div
                                      style={{ display: 'flex', gap: 2, flexShrink: 0 }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        onClick={() => {
                                          setEditingId(snippet.id)
                                          setShowAddForm(false)
                                        }}
                                        title="Edit snippet"
                                        style={smallBtnStyle}
                                      >
                                        <Edit3 size={12} />
                                      </button>
                                      <button
                                        onClick={() => {
                                          deleteSnippet(snippet.id)
                                          if (selectedSnippetId === snippet.id)
                                            setSelectedSnippetId(null)
                                        }}
                                        title="Delete snippet"
                                        style={smallBtnStyle}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  ))
                )}
              </div>

              {/* ── Preview panel ──────────────────────────────────────────── */}
              {selectedSnippet && (
                <div
                  style={{
                    width: 380,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  {/* Preview header */}
                  <div
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border-color, var(--border))',
                      background: 'var(--bg-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Preview
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => handleInsertSnippet(selectedSnippet)}
                        title="Insert snippet at editor cursor"
                        style={{
                          ...smallBtnStyle,
                          gap: 4,
                          width: 'auto',
                          padding: '2px 8px',
                          fontSize: 10,
                          color: 'var(--accent)',
                          border: '1px solid var(--accent)',
                          borderRadius: 3,
                        }}
                      >
                        <Zap size={10} /> Insert
                      </button>
                      <button
                        onClick={() => handleCopyBody(selectedSnippet.body)}
                        title="Copy snippet body"
                        style={{
                          ...smallBtnStyle,
                          gap: 4,
                          width: 'auto',
                          padding: '2px 8px',
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-color, var(--border))',
                          borderRadius: 3,
                        }}
                      >
                        <Copy size={10} /> Copy
                      </button>
                    </div>
                  </div>

                  {/* Snippet details */}
                  <div style={{ padding: '12px 14px', overflowY: 'auto', flex: 1 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: 2,
                        }}
                      >
                        {selectedSnippet.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {selectedSnippet.description}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          fontSize: 10,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span>
                          Prefix:{' '}
                          <code
                            style={{
                              color: 'var(--accent)',
                              fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                            }}
                          >
                            {selectedSnippet.prefix}
                          </code>
                        </span>
                        <span>Language: {langLabel(selectedSnippet.language)}</span>
                        {selectedSnippet.isBuiltin && <span>(built-in)</span>}
                        {(() => {
                          const m = getMetaForSnippet(snippetMeta, selectedSnippet.id)
                          return (
                            <>
                              {m.category !== 'Uncategorized' && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <Tag size={9} /> {m.category}
                                </span>
                              )}
                              {m.usageCount > 0 && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <BarChart3 size={9} /> Used {m.usageCount} time
                                  {m.usageCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </>
                          )
                        })()}
                      </div>

                      {/* Conflict warning */}
                      {prefixConflicts.has(selectedSnippet.id) && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                            marginTop: 8,
                            padding: '6px 8px',
                            background: 'rgba(229, 168, 75, 0.08)',
                            border: '1px solid rgba(229, 168, 75, 0.2)',
                            borderRadius: 4,
                            fontSize: 10,
                            color: 'var(--text-warning, #e5a84b)',
                          }}
                        >
                          <AlertTriangle
                            size={11}
                            style={{ marginTop: 1, flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>
                              Prefix Conflict Detected
                            </div>
                            <div style={{ color: 'var(--text-muted)' }}>
                              The prefix "
                              <code
                                style={{
                                  fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                                  color: 'var(--text-warning, #e5a84b)',
                                }}
                              >
                                {selectedSnippet.prefix}
                              </code>
                              " is also used by:{' '}
                              {prefixConflicts
                                .get(selectedSnippet.id)!
                                .conflictsWith.map((c) => `${c.name} (${langLabel(c.language)})`)
                                .join(', ')}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Body source with syntax highlighting */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ ...labelStyle, marginBottom: 4 }}>Template</div>
                      <pre
                        style={{
                          padding: '8px 10px',
                          fontSize: 11,
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color, var(--border))',
                          borderRadius: 4,
                          color: 'var(--text-secondary)',
                          fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                          lineHeight: 1.6,
                          overflow: 'auto',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          tabSize: 2,
                        }}
                      >
                        {highlightBody(selectedSnippet.body)}
                      </pre>
                    </div>

                    {/* Expanded preview */}
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4 }}>Expanded Output</div>
                      <pre
                        style={{
                          padding: '8px 10px',
                          fontSize: 11,
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color, var(--border))',
                          borderRadius: 4,
                          color: 'var(--text-primary)',
                          fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                          lineHeight: 1.6,
                          overflow: 'auto',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          tabSize: 2,
                        }}
                      >
                        {renderPreview(selectedSnippet.body)}
                      </pre>
                    </div>

                    {/* Quick insert hint */}
                    <div
                      style={{
                        marginTop: 12,
                        padding: '8px 10px',
                        background: 'rgba(var(--accent-rgb, 59,130,246), 0.06)',
                        borderRadius: 4,
                        border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.15)',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Zap
                        size={10}
                        style={{ color: 'var(--accent)', flexShrink: 0 }}
                      />
                      <span>
                        <strong style={{ color: 'var(--text-secondary)' }}>Double-click</strong>{' '}
                        any snippet to insert at the current editor cursor position, or type{' '}
                        <code
                          style={{
                            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                            color: 'var(--accent)',
                            background: 'var(--bg-active)',
                            padding: '0 3px',
                            borderRadius: 2,
                          }}
                        >
                          {selectedSnippet.prefix}
                        </code>{' '}
                        in the editor.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border-color, var(--border))',
            fontSize: 11,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 16,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <span>
              <code style={{ color: 'var(--text-secondary)' }}>$1</code>,{' '}
              <code style={{ color: 'var(--text-secondary)' }}>$2</code> tab stops
            </span>
            <span>
              <code style={{ color: 'var(--text-secondary)' }}>{'${1:text}'}</code> placeholder
            </span>
            <span>
              <code style={{ color: 'var(--text-secondary)' }}>$0</code> final cursor
            </span>
            <span>
              <code style={{ color: 'var(--text-warning, #e5a84b)' }}>$TM_FILENAME</code>{' '}
              variable
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>VS Code snippet syntax compatible</span>
            {filteredSnippets.length !== snippets.length && (
              <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
                Showing {filteredSnippets.length} of {snippets.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
