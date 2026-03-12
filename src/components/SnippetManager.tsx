import { useState, useMemo, useRef } from 'react'
import { useSnippetStore, type Snippet } from '@/store/snippets'
import {
  X, Plus, Trash2, Edit3, Download, Upload,
  Code, ChevronDown, ChevronRight, Save, Search,
} from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
]

export default function SnippetManager({ open, onClose }: Props) {
  const { snippets, addSnippet, removeSnippet, updateSnippet, importSnippets, exportSnippets } = useSnippetStore()

  const [filterLang, setFilterLang] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [collapsedLangs, setCollapsedLangs] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [formPrefix, setFormPrefix] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formLang, setFormLang] = useState('javascript')

  // Edit form state
  const [editPrefix, setEditPrefix] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editLang, setEditLang] = useState('javascript')

  const filteredSnippets = useMemo(() => {
    let result = snippets
    if (filterLang !== 'all') {
      result = result.filter((s) => s.language === filterLang)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.prefix.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.body.toLowerCase().includes(q)
      )
    }
    return result
  }, [snippets, filterLang, searchQuery])

  // Group snippets by language
  const grouped = useMemo(() => {
    const map = new Map<string, Snippet[]>()
    for (const s of filteredSnippets) {
      const lang = s.language
      if (!map.has(lang)) map.set(lang, [])
      map.get(lang)!.push(s)
    }
    return map
  }, [filteredSnippets])

  const toggleLangCollapse = (lang: string) => {
    setCollapsedLangs((prev) => {
      const next = new Set(prev)
      if (next.has(lang)) next.delete(lang)
      else next.add(lang)
      return next
    })
  }

  const resetAddForm = () => {
    setFormPrefix('')
    setFormBody('')
    setFormDesc('')
    setFormLang('javascript')
    setShowAddForm(false)
  }

  const handleAdd = () => {
    if (!formPrefix.trim() || !formBody.trim()) return
    addSnippet({
      prefix: formPrefix.trim(),
      body: formBody,
      description: formDesc.trim() || formPrefix.trim(),
      language: formLang,
    })
    resetAddForm()
  }

  const startEditing = (snippet: Snippet) => {
    setEditingId(snippet.id)
    setEditPrefix(snippet.prefix)
    setEditBody(snippet.body)
    setEditDesc(snippet.description)
    setEditLang(snippet.language)
  }

  const handleSaveEdit = () => {
    if (!editingId || !editPrefix.trim() || !editBody.trim()) return
    updateSnippet(editingId, {
      prefix: editPrefix.trim(),
      body: editBody,
      description: editDesc.trim() || editPrefix.trim(),
      language: editLang,
    })
    setEditingId(null)
  }

  const handleExport = () => {
    const data = exportSnippets()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'orion-snippets.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (Array.isArray(data)) {
          importSnippets(data)
        }
      } catch {
        /* ignore invalid JSON */
      }
    }
    reader.readAsText(file)
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = ''
  }

  const langLabel = (lang: string) => {
    const opt = LANGUAGE_OPTIONS.find((o) => o.value === lang)
    return opt ? opt.label : lang.charAt(0).toUpperCase() + lang.slice(1)
  }

  if (!open) return null

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
          width: 680,
          maxHeight: '80vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Code size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Snippet Manager
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {snippets.length} snippets
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={handleImport}
              title="Import snippets"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', fontSize: 11, fontWeight: 500,
                color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)', borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              <Upload size={12} /> Import
            </button>
            <button
              onClick={handleExport}
              title="Export snippets"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', fontSize: 11, fontWeight: 500,
                color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)', borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              <Download size={12} /> Export
            </button>
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26,
                color: 'var(--text-muted)', background: 'transparent',
                border: 'none', borderRadius: 5, cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>

        {/* Toolbar: search + filter + add */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-primary)', borderRadius: 5,
            border: '1px solid var(--border)', padding: '0 8px',
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snippets..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 12, color: 'var(--text-primary)', padding: '6px 0',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>
          <select
            value={filterLang}
            onChange={(e) => setFilterLang(e.target.value)}
            style={{
              fontSize: 11, padding: '5px 8px',
              background: 'var(--bg-primary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 5, outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Languages</option>
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', fontSize: 11, fontWeight: 600,
              color: showAddForm ? 'var(--text-primary)' : '#fff',
              background: showAddForm ? 'var(--bg-tertiary)' : 'var(--accent)',
              border: 'none', borderRadius: 5, cursor: 'pointer',
            }}
          >
            <Plus size={13} /> Add Snippet
          </button>
        </div>

        {/* Add snippet form */}
        {showAddForm && (
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Prefix (trigger)
                </label>
                <input
                  value={formPrefix}
                  onChange={(e) => setFormPrefix(e.target.value)}
                  placeholder="e.g. mysnippet"
                  style={{
                    width: '100%', marginTop: 4, padding: '5px 8px',
                    fontSize: 12, background: 'var(--bg-primary)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    color: 'var(--text-primary)', outline: 'none',
                    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Description
                </label>
                <input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="e.g. My custom snippet"
                  style={{
                    width: '100%', marginTop: 4, padding: '5px 8px',
                    fontSize: 12, background: 'var(--bg-primary)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    color: 'var(--text-primary)', outline: 'none',
                    fontFamily: 'var(--font-sans)',
                  }}
                />
              </div>
              <div style={{ width: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Language
                </label>
                <select
                  value={formLang}
                  onChange={(e) => setFormLang(e.target.value)}
                  style={{
                    width: '100%', marginTop: 4, padding: '5px 8px',
                    fontSize: 12, background: 'var(--bg-primary)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    color: 'var(--text-secondary)', outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Body (use $1, $2 for tab stops, ${'{1:placeholder}'} for named placeholders)
              </label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder={"e.g. console.log($1);"}
                rows={4}
                style={{
                  width: '100%', marginTop: 4, padding: '6px 8px',
                  fontSize: 12, background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text-primary)', outline: 'none',
                  fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                  resize: 'vertical', lineHeight: 1.5,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={resetAddForm}
                style={{
                  padding: '5px 14px', fontSize: 11,
                  color: 'var(--text-secondary)', background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!formPrefix.trim() || !formBody.trim()}
                style={{
                  padding: '5px 14px', fontSize: 11, fontWeight: 600,
                  color: '#fff',
                  background: formPrefix.trim() && formBody.trim() ? 'var(--accent)' : 'var(--bg-active)',
                  border: 'none', borderRadius: 4,
                  cursor: formPrefix.trim() && formBody.trim() ? 'pointer' : 'not-allowed',
                  opacity: formPrefix.trim() && formBody.trim() ? 1 : 0.5,
                }}
              >
                Add Snippet
              </button>
            </div>
          </div>
        )}

        {/* Snippet list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {grouped.size === 0 ? (
            <div style={{
              padding: '40px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 12,
            }}>
              No snippets found
            </div>
          ) : (
            Array.from(grouped.entries()).map(([lang, langSnippets]) => (
              <div key={lang}>
                {/* Language header */}
                <div
                  onClick={() => toggleLangCollapse(lang)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 18px',
                    cursor: 'pointer',
                    fontSize: 11, fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    userSelect: 'none',
                  }}
                >
                  {collapsedLangs.has(lang)
                    ? <ChevronRight size={12} />
                    : <ChevronDown size={12} />
                  }
                  {langLabel(lang)}
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, fontWeight: 400,
                    color: 'var(--text-muted)', opacity: 0.7,
                  }}>
                    {langSnippets.length} snippet{langSnippets.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Snippets for this language */}
                {!collapsedLangs.has(lang) && langSnippets.map((snippet) => (
                  <div key={snippet.id}>
                    {editingId === snippet.id ? (
                      /* Edit form (inline) */
                      <div style={{
                        padding: '10px 18px',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                      }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <input
                            value={editPrefix}
                            onChange={(e) => setEditPrefix(e.target.value)}
                            placeholder="Prefix"
                            style={{
                              flex: 1, padding: '4px 8px', fontSize: 12,
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)', borderRadius: 4,
                              color: 'var(--text-primary)', outline: 'none',
                              fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                            }}
                          />
                          <input
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Description"
                            style={{
                              flex: 2, padding: '4px 8px', fontSize: 12,
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)', borderRadius: 4,
                              color: 'var(--text-primary)', outline: 'none',
                            }}
                          />
                          <select
                            value={editLang}
                            onChange={(e) => setEditLang(e.target.value)}
                            style={{
                              width: 110, padding: '4px 6px', fontSize: 11,
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)', borderRadius: 4,
                              color: 'var(--text-secondary)', outline: 'none',
                            }}
                          >
                            {LANGUAGE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={3}
                          style={{
                            width: '100%', padding: '5px 8px', fontSize: 12,
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)', borderRadius: 4,
                            color: 'var(--text-primary)', outline: 'none',
                            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                            resize: 'vertical', lineHeight: 1.5,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{
                              padding: '4px 12px', fontSize: 11,
                              color: 'var(--text-secondary)', background: 'var(--bg-primary)',
                              border: '1px solid var(--border)', borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 12px', fontSize: 11, fontWeight: 600,
                              color: '#fff', background: 'var(--accent)',
                              border: 'none', borderRadius: 4, cursor: 'pointer',
                            }}
                          >
                            <Save size={11} /> Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Snippet row */
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 18px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: 12,
                        }}
                      >
                        <code style={{
                          padding: '2px 8px', fontSize: 11,
                          background: 'var(--bg-active)', borderRadius: 4,
                          color: 'var(--accent)', fontWeight: 600,
                          fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                          flexShrink: 0,
                          minWidth: 50, textAlign: 'center',
                        }}>
                          {snippet.prefix}
                        </code>
                        <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 12 }}>
                          {snippet.description}
                        </span>
                        <code style={{
                          flex: 2, fontSize: 10, color: 'var(--text-muted)',
                          fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: 220,
                        }}>
                          {snippet.body.replace(/\n/g, ' ').replace(/\t/g, '  ')}
                        </code>
                        {snippet.id.startsWith('builtin_') ? (
                          <span style={{
                            fontSize: 9, color: 'var(--text-muted)', opacity: 0.5,
                            padding: '1px 6px', borderRadius: 3,
                            border: '1px solid var(--border)',
                            flexShrink: 0,
                          }}>
                            built-in
                          </span>
                        ) : (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            <button
                              onClick={() => startEditing(snippet)}
                              title="Edit snippet"
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 24, height: 22,
                                color: 'var(--text-muted)', background: 'transparent',
                                border: 'none', borderRadius: 3, cursor: 'pointer',
                              }}
                            >
                              <Edit3 size={12} />
                            </button>
                            <button
                              onClick={() => removeSnippet(snippet.id)}
                              title="Delete snippet"
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 24, height: 22,
                                color: 'var(--text-muted)', background: 'transparent',
                                border: 'none', borderRadius: 3, cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 18px',
          borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)',
          display: 'flex', gap: 16,
        }}>
          <span>Use <code style={{ color: 'var(--text-secondary)' }}>$1</code>, <code style={{ color: 'var(--text-secondary)' }}>$2</code> for tab stops</span>
          <span>Use <code style={{ color: 'var(--text-secondary)' }}>{'${1:placeholder}'}</code> for named placeholders</span>
        </div>
      </div>
    </div>
  )
}
