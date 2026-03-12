import { useState, useMemo, useCallback, useRef, useEffect } from 'react'

interface MarkdownPreviewProps {
  content: string
  style?: React.CSSProperties
}

// ---------- Syntax Highlighting ----------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightCode(code: string, lang: string): string {
  const jsKeywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|default|from|async|await|try|catch|finally|throw|typeof|instanceof|in|of|yield|static|get|set|null|undefined|true|false|void|delete|super)\b/g
  const pyKeywords = /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|and|or|not|in|is|None|True|False|self|global|nonlocal|assert|del|print)\b/g
  const tsKeywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|default|from|async|await|try|catch|finally|throw|typeof|instanceof|in|of|yield|static|get|set|null|undefined|true|false|void|delete|super|interface|type|enum|implements|namespace|abstract|declare|readonly|private|protected|public|as|keyof|infer|never|unknown|any)\b/g
  const goKeywords = /\b(func|return|if|else|for|range|switch|case|break|continue|var|const|type|struct|interface|map|chan|go|defer|select|package|import|nil|true|false|make|len|cap|append|copy|delete|new|panic|recover)\b/g
  const rustKeywords = /\b(fn|let|mut|return|if|else|for|while|loop|match|break|continue|struct|enum|impl|trait|pub|use|mod|crate|self|super|where|async|await|move|ref|type|const|static|unsafe|extern|true|false|None|Some|Ok|Err|Self|dyn|Box|Vec|String|Option|Result)\b/g
  const cssKeywords = /\b(color|background|margin|padding|border|display|position|width|height|font|text|align|flex|grid|top|left|right|bottom|overflow|opacity|z-index|transform|transition|animation|none|auto|inherit|initial|solid|dashed|dotted|relative|absolute|fixed|sticky|block|inline|content|important)\b/g
  const htmlKeywords = /\b(div|span|button|input|form|table|thead|tbody|tr|td|th|ul|ol|li|a|p|h1|h2|h3|h4|h5|h6|img|section|article|header|footer|nav|main|aside|pre|code|strong|em|label|select|option|textarea)\b/g
  const shellKeywords = /\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|sed|awk|find|chmod|chown|sudo|apt|yum|brew|npm|yarn|pip|git|docker|curl|wget|export|source|alias|if|then|else|fi|for|do|done|while|case|esac|function|return|exit)\b/g
  const sqlKeywords = /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|UNION|ALL|SET|VALUES|INTO|COUNT|SUM|AVG|MIN|MAX|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END)\b/gi
  const javaKeywords = /\b(public|private|protected|static|final|abstract|class|interface|extends|implements|return|if|else|for|while|do|switch|case|break|continue|new|this|super|try|catch|finally|throw|throws|void|int|long|double|float|boolean|char|byte|short|String|null|true|false|import|package|instanceof|synchronized|volatile|transient|native|enum|assert)\b/g
  const cppKeywords = /\b(int|long|double|float|char|void|bool|auto|const|static|extern|register|volatile|unsigned|signed|short|struct|union|enum|class|public|private|protected|virtual|override|friend|inline|template|typename|namespace|using|new|delete|return|if|else|for|while|do|switch|case|break|continue|goto|throw|try|catch|nullptr|true|false|sizeof|typedef|include|define|ifdef|ifndef|endif|pragma)\b/g

  let keywords: RegExp
  const langLower = lang.toLowerCase()
  if (['js', 'javascript', 'jsx'].includes(langLower)) keywords = jsKeywords
  else if (['ts', 'typescript', 'tsx'].includes(langLower)) keywords = tsKeywords
  else if (['py', 'python'].includes(langLower)) keywords = pyKeywords
  else if (['go', 'golang'].includes(langLower)) keywords = goKeywords
  else if (['rs', 'rust'].includes(langLower)) keywords = rustKeywords
  else if (['css', 'scss', 'less'].includes(langLower)) keywords = cssKeywords
  else if (['html', 'xml', 'svg', 'vue'].includes(langLower)) keywords = htmlKeywords
  else if (['sh', 'bash', 'shell', 'zsh'].includes(langLower)) keywords = shellKeywords
  else if (['sql', 'mysql', 'postgres', 'sqlite'].includes(langLower)) keywords = sqlKeywords
  else if (['java', 'kotlin'].includes(langLower)) keywords = javaKeywords
  else if (['c', 'cpp', 'c++', 'cc', 'h', 'hpp'].includes(langLower)) keywords = cppKeywords
  else keywords = jsKeywords

  let highlighted = code

  // Protect strings first
  const strings: string[] = []
  highlighted = highlighted.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, (match) => {
    strings.push(match)
    return `__STR_${strings.length - 1}__`
  })

  // Protect comments
  const comments: string[] = []
  highlighted = highlighted.replace(/\/\/.*$/gm, (match) => {
    comments.push(match)
    return `__CMT_${comments.length - 1}__`
  })
  highlighted = highlighted.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    comments.push(match)
    return `__CMT_${comments.length - 1}__`
  })
  highlighted = highlighted.replace(/#.*$/gm, (match) => {
    if (['py', 'python', 'sh', 'bash', 'shell', 'zsh', 'yaml', 'yml', 'toml', 'ruby', 'rb'].includes(langLower)) {
      comments.push(match)
      return `__CMT_${comments.length - 1}__`
    }
    return match
  })
  // SQL comments
  highlighted = highlighted.replace(/--.*$/gm, (match) => {
    if (['sql', 'mysql', 'postgres', 'sqlite'].includes(langLower)) {
      comments.push(match)
      return `__CMT_${comments.length - 1}__`
    }
    return match
  })

  // Decorators / annotations
  highlighted = highlighted.replace(/@\w+/g, '<span class="md-hl-decorator">$&</span>')

  // Numbers
  highlighted = highlighted.replace(/\b(0x[0-9a-fA-F]+|\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="md-hl-number">$1</span>')

  // Keywords
  highlighted = highlighted.replace(keywords, '<span class="md-hl-keyword">$&</span>')

  // Function calls: word followed by (
  highlighted = highlighted.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, (match, name) => {
    if (match.includes('md-hl-')) return match
    return `<span class="md-hl-function">${name}</span>`
  })

  // Restore comments with highlighting
  comments.forEach((c, i) => {
    highlighted = highlighted.replace(`__CMT_${i}__`, `<span class="md-hl-comment">${c}</span>`)
  })

  // Restore strings with highlighting
  strings.forEach((s, i) => {
    highlighted = highlighted.replace(`__STR_${i}__`, `<span class="md-hl-string">${s}</span>`)
  })

  return highlighted
}

// ---------- Mermaid Diagram Type Detection ----------

function detectMermaidType(code: string): string {
  const trimmed = code.trim().toLowerCase()
  if (trimmed.startsWith('graph') || trimmed.startsWith('flowchart')) return 'Flowchart'
  if (trimmed.startsWith('sequencediagram')) return 'Sequence Diagram'
  if (trimmed.startsWith('classdiagram')) return 'Class Diagram'
  if (trimmed.startsWith('statediagram')) return 'State Diagram'
  if (trimmed.startsWith('erdiagram')) return 'Entity Relationship Diagram'
  if (trimmed.startsWith('gantt')) return 'Gantt Chart'
  if (trimmed.startsWith('pie')) return 'Pie Chart'
  if (trimmed.startsWith('journey')) return 'User Journey'
  if (trimmed.startsWith('gitgraph')) return 'Git Graph'
  if (trimmed.startsWith('mindmap')) return 'Mind Map'
  if (trimmed.startsWith('timeline')) return 'Timeline'
  if (trimmed.startsWith('quadrantchart')) return 'Quadrant Chart'
  if (trimmed.startsWith('sankey')) return 'Sankey Diagram'
  if (trimmed.startsWith('xychart')) return 'XY Chart'
  if (trimmed.startsWith('block')) return 'Block Diagram'
  return 'Diagram'
}

// ---------- Markdown Parser ----------

interface TocEntry {
  level: number
  text: string
  id: string
}

function extractToc(md: string): TocEntry[] {
  const entries: TocEntry[] = []
  const lines = md.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const text = match[2].replace(/[*_`~\[\]]/g, '')
      const id = 'heading-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      entries.push({ level: match[1].length, text, id })
    }
  }
  return entries
}

function parseMarkdown(md: string): string {
  let html = md

  // Escape HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Collect footnote definitions [^id]: text
  const footnotes: Record<string, string> = {}
  html = html.replace(/^\[\^(\w+)\]:\s+(.+)$/gm, (_, id, text) => {
    footnotes[id] = text
    return `__FOOTNOTE_DEF_${id}__`
  })

  // Mermaid code blocks - detect diagram type
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const diagramType = detectMermaidType(code.trim())
    return `<div class="md-mermaid-placeholder"><div class="md-mermaid-header"><span class="md-mermaid-icon">&#9672;</span> Mermaid ${diagramType}<span class="md-mermaid-badge">${diagramType}</span></div><pre class="md-mermaid-code"><code>${code.trim()}</code></pre></div>`
  })

  // Math code blocks ```math
  html = html.replace(/```math\n([\s\S]*?)```/g, (_, code) => {
    return `<div class="md-math-block"><div class="md-math-header"><span class="md-math-icon">&#8721;</span> LaTeX Math</div><pre class="md-math-content"><code>${code.trim()}</code></pre></div>`
  })

  // Code blocks with syntax highlighting, copy button, language label, and line numbers
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmed = code.trim()
    const highlighted = lang ? highlightCode(trimmed, lang) : trimmed
    const langLabel = lang ? `<span class="md-code-lang">${lang}</span>` : ''
    const copyBtn = `<button class="md-code-copy" title="Copy code"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg><span class="md-copy-text">Copy</span></button>`
    // Add line numbers
    const lines = highlighted.split('\n')
    const lineNumbered = lines.map((line, i) =>
      `<span class="md-code-line"><span class="md-code-ln">${i + 1}</span>${line}</span>`
    ).join('\n')
    return `<div class="md-code-wrapper"><div class="md-code-header">${langLabel}${copyBtn}</div><pre class="md-code-block"><code class="language-${lang}">${lineNumbered}</code></pre></div>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

  // Headers with IDs for TOC linking
  html = html.replace(/^######\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h6 class="md-h6" id="${id}">${t}</h6>` })
  html = html.replace(/^#####\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h5 class="md-h5" id="${id}">${t}</h5>` })
  html = html.replace(/^####\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h4 class="md-h4" id="${id}">${t}</h4>` })
  html = html.replace(/^###\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h3 class="md-h3" id="${id}">${t}</h3>` })
  html = html.replace(/^##\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h2 class="md-h2" id="${id}">${t}</h2>` })
  html = html.replace(/^#\s+(.+)$/gm, (_, t) => { const id = 'heading-' + t.replace(/[*_`~\[\]]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return `<h1 class="md-h1" id="${id}">${t}</h1>` })

  // Display math blocks $$...$$ (multiline)
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    return `<div class="md-math-block"><div class="md-math-header"><span class="md-math-icon">&#8721;</span> LaTeX Math</div><pre class="md-math-content"><code>${math.trim()}</code></pre></div>`
  })

  // Inline math $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, '<code class="md-math-inline">$1</code>')

  // Bold + Italic combos
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<del class="md-del">$1</del>')

  // Highlight ==text==
  html = html.replace(/==(.+?)==/g, '<mark class="md-mark">$1</mark>')

  // Images with placeholder
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    return `<div class="md-image-container"><img src="${src}" alt="${alt}" class="md-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="md-image-placeholder" style="display:none"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>${alt || 'Image'}</span></div></div>`
  })

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" title="$2">$1</a>')

  // Autolinks
  html = html.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1" class="md-link">$1</a>')

  // Footnote references [^id]
  html = html.replace(/\[\^(\w+)\]/g, (_, id) => {
    return `<sup class="md-footnote-ref"><a href="#fn-${id}" id="fnref-${id}">[${id}]</a></sup>`
  })

  // Blockquotes (handle nested with >>)
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="md-blockquote"><p>$1</p></blockquote>')
  html = html.replace(/<\/blockquote>\n<blockquote class="md-blockquote">/g, '')

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="md-hr" />')
  html = html.replace(/^\*\*\*$/gm, '<hr class="md-hr" />')
  html = html.replace(/^___$/gm, '<hr class="md-hr" />')

  // Definition lists (term\n: definition)
  html = html.replace(/^(.+)\n:\s+(.+)$/gm, '<dl class="md-dl"><dt class="md-dt">$1</dt><dd class="md-dd">$2</dd></dl>')

  // Task lists (before general lists)
  html = html.replace(/^[\s]*[-*+]\s+\[x\]\s+(.+)$/gim, '<li class="md-li md-task-li"><input type="checkbox" checked disabled class="md-checkbox" /><span>$1</span></li>')
  html = html.replace(/^[\s]*[-*+]\s+\[ \]\s+(.+)$/gm, '<li class="md-li md-task-li"><input type="checkbox" disabled class="md-checkbox" /><span>$1</span></li>')

  // Unordered lists
  html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, (match) => {
    if (match.includes('md-task-li')) return match
    return match.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li class="md-li">$1</li>')
  })
  html = html.replace(/(<li class="md-li[^"]*">.*<\/li>\n?)+/g, '<ul class="md-ul">$&</ul>')

  // Ordered lists
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li class="md-oli">$1</li>')
  html = html.replace(/(<li class="md-oli">.*<\/li>\n?)+/g, '<ol class="md-ol">$&</ol>')

  // Tables with alignment support and striped rows
  const tableRegex = /^\|(.+)\|\n\|([-| :]+)\|\n((?:\|.+\|\n?)*)/gm
  html = html.replace(tableRegex, (_, header, separator, rows) => {
    // Parse alignment from separator row
    const aligns = separator.split('|').map((s: string) => {
      s = s.trim()
      if (s.startsWith(':') && s.endsWith(':')) return 'center'
      if (s.endsWith(':')) return 'right'
      return 'left'
    })
    const headers = header.split('|').map((h: string, i: number) =>
      `<th class="md-th" style="text-align:${aligns[i] || 'left'}">${h.trim()}</th>`
    ).join('')
    const rowsHtml = rows.trim().split('\n').map((row: string, idx: number) => {
      const cells = row.replace(/^\||\|$/g, '').split('|').map((c: string, ci: number) =>
        `<td class="md-td" style="text-align:${aligns[ci] || 'left'}">${c.trim()}</td>`
      ).join('')
      return `<tr class="${idx % 2 === 1 ? 'md-tr-striped' : ''}">${cells}</tr>`
    }).join('')
    return `<div class="md-table-wrapper"><table class="md-table"><thead><tr>${headers}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`
  })

  // Build footnotes section
  const footnoteIds = Object.keys(footnotes)
  if (footnoteIds.length > 0) {
    footnoteIds.forEach(id => {
      html = html.replace(`__FOOTNOTE_DEF_${id}__`, '')
    })
    let footnotesHtml = '<section class="md-footnotes"><hr class="md-hr" /><ol class="md-footnote-list">'
    footnoteIds.forEach(id => {
      footnotesHtml += `<li id="fn-${id}" class="md-footnote-item"><span class="md-footnote-text">${footnotes[id]}</span> <a href="#fnref-${id}" class="md-footnote-backref">&#8617;</a></li>`
    })
    footnotesHtml += '</ol></section>'
    html += footnotesHtml
  }

  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[a-z/!]|$|\s*$)(.+)$/gm, '<p class="md-p">$1</p>')

  return html
}

// ---------- HTML Export ----------

function generateExportHtml(content: string, styles: string): string {
  const body = parseMarkdown(content)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Markdown Export</title>
<style>
:root {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d30;
  --text-primary: #cccccc;
  --text-secondary: #9d9d9d;
  --text-muted: #6e7681;
  --border: #3e3e42;
  --accent-blue: #388bfd;
  --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
}
body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.7;
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 32px;
}
${styles}
</style>
</head>
<body class="markdown-preview">
${body}
</body>
</html>`
}

// ---------- View Mode Types ----------

type ViewMode = 'preview' | 'source' | 'split'

// ---------- Toolbar Icon Components ----------

function ToolbarIcon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d={d} />
    </svg>
  )
}

// ---------- Table of Contents Dropdown ----------

function TocDropdown({ entries, onSelect }: { entries: TocEntry[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (entries.length === 0) return null

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        className="md-toolbar-btn"
        onClick={() => setOpen(!open)}
        title="Table of Contents"
        style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <ToolbarIcon d="M1 2.75A.75.75 0 011.75 2h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 2.75zm0 5A.75.75 0 011.75 7h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 7.75zm0 5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H1.75a.75.75 0 01-.75-.75z" />
        <span style={{ fontSize: 11 }}>TOC</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="md-toc-dropdown">
          <div className="md-toc-title">Table of Contents</div>
          {entries.map((entry, i) => (
            <button
              key={i}
              className="md-toc-item"
              style={{ paddingLeft: 12 + (entry.level - 1) * 16 }}
              onClick={() => {
                onSelect(entry.id)
                setOpen(false)
              }}
            >
              <span className="md-toc-level">H{entry.level}</span>
              <span className="md-toc-text">{entry.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Main Component ----------

export default function MarkdownPreview({ content, style }: MarkdownPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [scrollSync, setScrollSync] = useState(true)
  const previewRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const isSyncing = useRef(false)

  const html = useMemo(() => parseMarkdown(content), [content])
  const toc = useMemo(() => extractToc(content), [content])

  // Word and character count
  const stats = useMemo(() => {
    const text = content.replace(/[#*`~\[\]()>|_-]/g, '')
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length
    const chars = content.length
    const lines = content.split('\n').length
    const readTime = Math.max(1, Math.ceil(words / 200))
    return { words, chars, lines, readTime }
  }, [content])

  // Handle copy button clicks via event delegation
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const copyBtn = target.closest('.md-code-copy') as HTMLElement | null
    if (copyBtn) {
      const wrapper = copyBtn.closest('.md-code-wrapper')
      const codeEl = wrapper?.querySelector('code')
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
          const textEl = copyBtn.querySelector('.md-copy-text')
          if (textEl) {
            textEl.textContent = 'Copied!'
            setTimeout(() => { if (textEl) textEl.textContent = 'Copy' }, 1500)
          }
        })
      }
    }
  }, [])

  // Scroll sync handler
  const handlePreviewScroll = useCallback(() => {
    if (!scrollSync || isSyncing.current || !sourceRef.current || !previewRef.current) return
    isSyncing.current = true
    const preview = previewRef.current
    const source = sourceRef.current
    const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1)
    source.scrollTop = ratio * (source.scrollHeight - source.clientHeight)
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [scrollSync])

  const handleSourceScroll = useCallback(() => {
    if (!scrollSync || isSyncing.current || !sourceRef.current || !previewRef.current) return
    isSyncing.current = true
    const source = sourceRef.current
    const preview = previewRef.current
    const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1)
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [scrollSync])

  // TOC navigation
  const handleTocSelect = useCallback((id: string) => {
    if (previewRef.current) {
      const el = previewRef.current.querySelector(`#${id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [])

  // Export as HTML
  const handleExport = useCallback(() => {
    const htmlContent = generateExportHtml(content, markdownBodyStyles)
    const blob = new Blob([htmlContent], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.html'
    a.click()
    URL.revokeObjectURL(url)
  }, [content])

  // Print
  const handlePrint = useCallback(() => {
    const htmlContent = generateExportHtml(content, markdownBodyStyles)
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(htmlContent)
      win.document.close()
      setTimeout(() => win.print(), 250)
    }
  }, [content])

  // Refresh (force re-render)
  const [, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div
      className="markdown-preview-root"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
        ...style,
      }}
    >
      {/* Toolbar */}
      <div className="md-toolbar">
        <div className="md-toolbar-group">
          {/* View mode buttons */}
          <div className="md-toolbar-segmented">
            <button
              className={`md-toolbar-seg-btn ${viewMode === 'source' ? 'md-seg-active' : ''}`}
              onClick={() => setViewMode('source')}
              title="Source view"
            >
              <ToolbarIcon d="M5.854 4.854a.5.5 0 10-.708-.708l-3.5 3.5a.5.5 0 000 .708l3.5 3.5a.5.5 0 00.708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 01.708-.708l3.5 3.5a.5.5 0 010 .708l-3.5 3.5a.5.5 0 01-.708-.708L13.293 8l-3.147-3.146z" />
              <span>Source</span>
            </button>
            <button
              className={`md-toolbar-seg-btn ${viewMode === 'split' ? 'md-seg-active' : ''}`}
              onClick={() => setViewMode('split')}
              title="Split view"
            >
              <ToolbarIcon d="M8.5 1.75v12.5a.75.75 0 01-1.5 0V1.75a.75.75 0 011.5 0zM1.75 1A.75.75 0 001 1.75v12.5c0 .414.336.75.75.75h12.5a.75.75 0 00.75-.75V1.75a.75.75 0 00-.75-.75H1.75zM2.5 2.5h11v11h-11v-11z" />
              <span>Split</span>
            </button>
            <button
              className={`md-toolbar-seg-btn ${viewMode === 'preview' ? 'md-seg-active' : ''}`}
              onClick={() => setViewMode('preview')}
              title="Preview"
            >
              <ToolbarIcon d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 010 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.62 1.62 0 010-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2zM1.679 7.932a.12.12 0 000 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 000-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717zM8 10a2 2 0 110-4 2 2 0 010 4z" />
              <span>Preview</span>
            </button>
          </div>

          <div className="md-toolbar-divider" />

          {/* Scroll sync toggle */}
          {viewMode === 'split' && (
            <button
              className={`md-toolbar-btn ${scrollSync ? 'md-btn-active' : ''}`}
              onClick={() => setScrollSync(!scrollSync)}
              title={scrollSync ? 'Scroll sync on' : 'Scroll sync off'}
            >
              <ToolbarIcon d="M8 0a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V.75A.75.75 0 018 0zm0 12a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5A.75.75 0 018 12zm4-4a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5A.75.75 0 0112 8zM.75 7.25a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5H.75zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />
              <span style={{ fontSize: 11 }}>Sync</span>
            </button>
          )}

          <TocDropdown entries={toc} onSelect={handleTocSelect} />
        </div>

        <div className="md-toolbar-group">
          {/* Stats */}
          <span className="md-toolbar-stats">
            {stats.words} words &middot; {stats.lines} lines &middot; ~{stats.readTime} min read
          </span>

          <div className="md-toolbar-divider" />

          {/* Refresh */}
          <button className="md-toolbar-btn" onClick={handleRefresh} title="Refresh preview">
            <ToolbarIcon d="M1.705 8.005a.75.75 0 01.834.656 5.5 5.5 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.002 7.002 0 011.05 8.84a.75.75 0 01.656-.834zM8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177l1.38 1.38A7.002 7.002 0 0114.95 7.16a.75.75 0 01-1.49.178A5.5 5.5 0 008 2.5z" />
          </button>

          {/* Export */}
          <button className="md-toolbar-btn" onClick={handleExport} title="Export as HTML">
            <ToolbarIcon d="M3.5 1.75a.25.25 0 01.25-.25h3.168a.75.75 0 01.536.222l5.293 5.293a.25.25 0 01.073.177v7.063a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V4.664a.75.75 0 01.536-.222L3.5 1.75zM3.75 0A1.75 1.75 0 002 1.75v12.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 14.25V7.5a.75.75 0 00-.22-.53l-5.5-5.5A.75.75 0 007.75 1.25H3.75zM7 5a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 017 5z" />
          </button>

          {/* Print */}
          <button className="md-toolbar-btn" onClick={handlePrint} title="Print">
            <ToolbarIcon d="M5 1v3H4a2 2 0 00-2 2v5a2 2 0 002 2h1v1a1 1 0 001 1h4a1 1 0 001-1v-1h1a2 2 0 002-2V6a2 2 0 00-2-2h-1V1a1 1 0 00-1-1H6a1 1 0 00-1 1zm1.5.5h3v2h-3v-2zm3 10h-3v-1h3v1zM4 5.5h8a.5.5 0 01.5.5v5a.5.5 0 01-.5.5h-1v-1a1 1 0 00-1-1H6a1 1 0 00-1 1v1H4a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5z" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="md-content-area" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Source Panel */}
        {(viewMode === 'source' || viewMode === 'split') && (
          <div className="md-source-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {viewMode === 'split' && (
              <div className="md-panel-label">SOURCE</div>
            )}
            <textarea
              ref={sourceRef}
              className="md-source-editor"
              value={content}
              readOnly
              onScroll={handleSourceScroll}
              spellCheck={false}
            />
          </div>
        )}

        {/* Split divider */}
        {viewMode === 'split' && (
          <div className="md-split-divider" />
        )}

        {/* Preview Panel */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {viewMode === 'split' && (
              <div className="md-panel-label">PREVIEW</div>
            )}
            <div
              ref={previewRef}
              className="markdown-preview"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 32px',
                color: 'var(--text-primary)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 14,
                lineHeight: 1.7,
                maxWidth: viewMode === 'split' ? '100%' : 900,
              }}
              onClick={handleClick}
              onScroll={handlePreviewScroll}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Body Styles (used in export and preview) ----------

const markdownBodyStyles = `
/* Headings - GitHub style */
.markdown-preview .md-h1 { font-size: 2em; font-weight: 700; margin: 24px 0 16px; padding-bottom: 0.3em; border-bottom: 2px solid var(--border); line-height: 1.25; letter-spacing: -0.02em; }
.markdown-preview .md-h2 { font-size: 1.5em; font-weight: 600; margin: 24px 0 16px; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); line-height: 1.25; }
.markdown-preview .md-h3 { font-size: 1.25em; font-weight: 600; margin: 24px 0 16px; line-height: 1.25; }
.markdown-preview .md-h4 { font-size: 1em; font-weight: 600; margin: 24px 0 16px; line-height: 1.25; }
.markdown-preview .md-h5 { font-size: 0.875em; font-weight: 600; margin: 24px 0 16px; line-height: 1.25; text-transform: uppercase; letter-spacing: 0.04em; }
.markdown-preview .md-h6 { font-size: 0.85em; font-weight: 600; margin: 24px 0 16px; color: var(--text-muted); line-height: 1.25; text-transform: uppercase; letter-spacing: 0.04em; }

/* Heading hover anchor */
.markdown-preview [id^="heading-"] { position: relative; scroll-margin-top: 16px; }
.markdown-preview [id^="heading-"]:hover::before {
  content: '#';
  position: absolute;
  left: -1.2em;
  color: var(--accent-blue, #388bfd);
  opacity: 0.5;
  font-weight: 400;
}

/* Paragraphs */
.markdown-preview .md-p { margin: 0 0 16px; }

/* Code block wrapper */
.markdown-preview .md-code-wrapper {
  position: relative;
  margin: 16px 0;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
  background: var(--bg-tertiary);
}
.markdown-preview .md-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid var(--border);
  min-height: 32px;
}
.markdown-preview .md-code-lang {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
}
.markdown-preview .md-code-copy {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
}
.markdown-preview .md-code-wrapper:hover .md-code-copy {
  opacity: 1;
}
.markdown-preview .md-code-copy:hover {
  color: var(--text-primary);
  background: rgba(255,255,255,0.08);
  border-color: var(--text-muted);
}
.markdown-preview .md-code-block {
  background: transparent;
  border-radius: 0;
  padding: 16px 0 16px 0;
  margin: 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  border: none;
  counter-reset: line;
}

/* Line numbers in code blocks */
.markdown-preview .md-code-line {
  display: block;
  padding: 0 16px 0 0;
}
.markdown-preview .md-code-line:hover {
  background: rgba(255,255,255,0.04);
}
.markdown-preview .md-code-ln {
  display: inline-block;
  width: 3em;
  text-align: right;
  padding-right: 1em;
  margin-right: 0.5em;
  color: var(--text-muted);
  opacity: 0.4;
  user-select: none;
  font-size: 12px;
  border-right: 1px solid var(--border);
}

/* Syntax highlighting */
.markdown-preview .md-hl-keyword { color: var(--md-hl-keyword, #ff7b72); font-weight: 500; }
.markdown-preview .md-hl-string { color: var(--md-hl-string, #a5d6ff); }
.markdown-preview .md-hl-comment { color: var(--md-hl-comment, #8b949e); font-style: italic; }
.markdown-preview .md-hl-number { color: var(--md-hl-number, #79c0ff); }
.markdown-preview .md-hl-function { color: var(--md-hl-function, #d2a8ff); }
.markdown-preview .md-hl-decorator { color: var(--md-hl-decorator, #ffa657); }

/* Inline code */
.markdown-preview .md-inline-code {
  background: rgba(110,118,129,0.25);
  padding: 0.2em 0.4em;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 85%;
  border: 1px solid rgba(110,118,129,0.15);
}

/* Blockquotes - GitHub style */
.markdown-preview .md-blockquote {
  border-left: 4px solid var(--accent-blue, #388bfd);
  padding: 8px 16px;
  margin: 0 0 16px;
  color: var(--text-secondary);
  background: rgba(88,166,255,0.04);
  border-radius: 0 6px 6px 0;
}
.markdown-preview .md-blockquote p { margin: 0; }

/* Links */
.markdown-preview .md-link {
  color: var(--accent-blue, #388bfd);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}
.markdown-preview .md-link:hover {
  text-decoration: underline;
  border-bottom-color: var(--accent-blue, #388bfd);
}

/* Horizontal rules */
.markdown-preview .md-hr {
  border: none;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--border), transparent);
  margin: 24px 0;
  border-radius: 2px;
}

/* Lists */
.markdown-preview .md-ul, .markdown-preview .md-ol { padding-left: 2em; margin: 0 0 16px; }
.markdown-preview .md-li, .markdown-preview .md-oli { margin: 4px 0; padding-left: 4px; }
.markdown-preview .md-li::marker { color: var(--text-muted); }
.markdown-preview .md-oli::marker { color: var(--text-muted); font-weight: 500; }

/* Task list items */
.markdown-preview .md-task-li {
  list-style: none;
  margin-left: -1.5em;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.markdown-preview .md-checkbox {
  margin: 4px 6px 0 0;
  width: 14px;
  height: 14px;
  accent-color: var(--accent-blue, #388bfd);
  flex-shrink: 0;
}
.markdown-preview .md-task-li:has(input:checked) span {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* Images */
.markdown-preview .md-image-container {
  margin: 16px 0;
}
.markdown-preview .md-image {
  max-width: 100%;
  border-radius: 8px;
  display: block;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  transition: box-shadow 0.2s ease;
}
.markdown-preview .md-image:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.markdown-preview .md-image-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  border: 2px dashed var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--bg-tertiary);
}

/* Strikethrough */
.markdown-preview .md-del { text-decoration: line-through; color: var(--text-muted); }

/* Highlight */
.markdown-preview .md-mark {
  background: rgba(255, 213, 79, 0.25);
  color: inherit;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

/* Tables - GitHub style with striped rows */
.markdown-preview .md-table-wrapper {
  overflow-x: auto;
  margin: 16px 0;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.markdown-preview .md-table {
  border-collapse: collapse;
  width: 100%;
  border: none;
}
.markdown-preview .md-th {
  padding: 10px 16px;
  border-bottom: 2px solid var(--border);
  background: var(--bg-tertiary);
  font-weight: 600;
  text-align: left;
  font-size: 13px;
  white-space: nowrap;
}
.markdown-preview .md-td {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  font-size: 13px;
}
.markdown-preview .md-tr-striped {
  background: rgba(255,255,255,0.02);
}
.markdown-preview .md-table tr:hover td {
  background: rgba(255,255,255,0.04);
}

/* Definition lists */
.markdown-preview .md-dl { margin: 0 0 16px; }
.markdown-preview .md-dt { font-weight: 600; margin-top: 8px; }
.markdown-preview .md-dd { margin-left: 2em; color: var(--text-secondary); }

/* Math - KaTeX-like rendering */
.markdown-preview .md-math-block {
  margin: 16px 0;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
  background: var(--bg-tertiary);
}
.markdown-preview .md-math-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  width: 100%;
  box-sizing: border-box;
  background: rgba(255,255,255,0.03);
}
.markdown-preview .md-math-icon {
  font-size: 14px;
  color: var(--accent-blue, #388bfd);
}
.markdown-preview .md-math-content {
  font-family: 'Latin Modern Math', 'STIX Two Math', 'Cambria Math', 'Times New Roman', var(--font-mono);
  font-size: 16px;
  padding: 20px 24px;
  margin: 0;
  overflow-x: auto;
  color: var(--text-primary);
  line-height: 1.8;
  text-align: center;
  letter-spacing: 0.02em;
}
.markdown-preview .md-math-content code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  border: none;
  padding: 0;
}
.markdown-preview .md-math-inline {
  font-family: 'Latin Modern Math', 'STIX Two Math', 'Cambria Math', 'Times New Roman', var(--font-mono);
  font-size: 95%;
  background: rgba(110,118,129,0.12);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  color: var(--accent-blue, #79c0ff);
  border: 1px solid rgba(110,118,129,0.1);
}

/* Mermaid placeholder */
.markdown-preview .md-mermaid-placeholder {
  margin: 16px 0;
  border-radius: 8px;
  border: 1px dashed var(--border);
  overflow: hidden;
  background: var(--bg-tertiary);
}
.markdown-preview .md-mermaid-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.03);
  border-bottom: 1px dashed var(--border);
}
.markdown-preview .md-mermaid-icon {
  margin-right: 4px;
  color: var(--accent-blue, #388bfd);
}
.markdown-preview .md-mermaid-badge {
  margin-left: auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(88,166,255,0.12);
  color: var(--accent-blue, #388bfd);
  font-weight: 600;
}
.markdown-preview .md-mermaid-code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 12px 16px;
  margin: 0;
  overflow-x: auto;
  color: var(--text-muted);
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
}

/* Footnotes */
.markdown-preview .md-footnotes {
  margin-top: 32px;
  font-size: 0.875em;
  color: var(--text-secondary);
}
.markdown-preview .md-footnote-list {
  padding-left: 1.5em;
  margin: 12px 0 0;
}
.markdown-preview .md-footnote-item {
  margin: 6px 0;
  line-height: 1.5;
}
.markdown-preview .md-footnote-ref a {
  color: var(--accent-blue, #388bfd);
  text-decoration: none;
  font-size: 0.8em;
  font-weight: 600;
}
.markdown-preview .md-footnote-ref a:hover { text-decoration: underline; }
.markdown-preview .md-footnote-backref {
  color: var(--accent-blue, #388bfd);
  text-decoration: none;
  margin-left: 4px;
  font-size: 0.9em;
}
.markdown-preview .md-footnote-backref:hover { text-decoration: underline; }

/* General typography */
.markdown-preview strong { font-weight: 600; }
.markdown-preview em { font-style: italic; }

/* Smooth scrollbar */
.markdown-preview::-webkit-scrollbar { width: 8px; }
.markdown-preview::-webkit-scrollbar-track { background: transparent; }
.markdown-preview::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.markdown-preview::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
`

// ---------- Exported Styles ----------

export const markdownPreviewStyles = `
${markdownBodyStyles}

/* Toolbar */
.md-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  min-height: 36px;
  gap: 8px;
  flex-shrink: 0;
}
.md-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.md-toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}
.md-toolbar-stats {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 4px;
}

/* Toolbar buttons */
.md-toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  font-family: inherit;
}
.md-toolbar-btn:hover {
  color: var(--text-primary);
  background: rgba(255,255,255,0.06);
  border-color: var(--border);
}
.md-toolbar-btn.md-btn-active {
  color: var(--accent-blue, #388bfd);
  background: rgba(56,139,253,0.1);
  border-color: rgba(56,139,253,0.3);
}

/* Segmented control for view mode */
.md-toolbar-segmented {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
}
.md-toolbar-seg-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  font-family: inherit;
  border-right: 1px solid var(--border);
}
.md-toolbar-seg-btn:last-child { border-right: none; }
.md-toolbar-seg-btn:hover {
  color: var(--text-primary);
  background: rgba(255,255,255,0.04);
}
.md-toolbar-seg-btn.md-seg-active {
  color: var(--text-primary);
  background: rgba(255,255,255,0.08);
  font-weight: 500;
}

/* TOC dropdown */
.md-toc-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 260px;
  max-width: 380px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  z-index: 100;
  padding: 4px 0;
}
.md-toc-title {
  padding: 8px 12px 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.md-toc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  font-family: inherit;
}
.md-toc-item:hover {
  background: rgba(255,255,255,0.06);
  color: var(--text-primary);
}
.md-toc-level {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-muted);
  opacity: 0.6;
  min-width: 18px;
  text-align: center;
  flex-shrink: 0;
  text-transform: uppercase;
}
.md-toc-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-toc-dropdown::-webkit-scrollbar { width: 6px; }
.md-toc-dropdown::-webkit-scrollbar-track { background: transparent; }
.md-toc-dropdown::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

/* Panel label */
.md-panel-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  padding: 4px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  flex-shrink: 0;
}

/* Source editor */
.md-source-editor {
  flex: 1;
  width: 100%;
  padding: 16px 20px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: none;
  outline: none;
  resize: none;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
  box-sizing: border-box;
  overflow: auto;
}
.md-source-editor::-webkit-scrollbar { width: 8px; }
.md-source-editor::-webkit-scrollbar-track { background: transparent; }
.md-source-editor::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

/* Split divider */
.md-split-divider {
  width: 1px;
  background: var(--border);
  flex-shrink: 0;
  position: relative;
}
.md-split-divider::after {
  content: '';
  position: absolute;
  top: 0;
  left: -3px;
  width: 7px;
  height: 100%;
  cursor: col-resize;
}

/* Content area */
.md-content-area {
  background: var(--bg-primary);
}

/* Print styles */
@media print {
  .md-toolbar { display: none !important; }
  .markdown-preview { max-width: 100% !important; }
  .md-code-copy { display: none !important; }
}

/* Selection styling */
.markdown-preview ::selection {
  background: rgba(56,139,253,0.3);
}
`
