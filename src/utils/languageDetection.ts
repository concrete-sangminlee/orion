/**
 * Advanced language detection for files.
 * Goes beyond file extensions to detect language from shebang lines,
 * modelines, content heuristics, and configuration files.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface LanguageInfo {
  id: string
  name: string
  extensions: string[]
  aliases: string[]
  mimeTypes: string[]
  firstLine?: RegExp
  color?: string
  icon?: string
}

export interface DetectionResult {
  languageId: string
  confidence: number
  method: 'extension' | 'filename' | 'shebang' | 'modeline' | 'content' | 'default'
}

/* ── Language Registry ─────────────────────────────────── */

const LANGUAGES: LanguageInfo[] = [
  { id: 'typescript', name: 'TypeScript', extensions: ['.ts', '.mts', '.cts'], aliases: ['ts'], mimeTypes: ['text/typescript'], color: '#3178c6' },
  { id: 'typescriptreact', name: 'TypeScript React', extensions: ['.tsx'], aliases: ['tsx'], mimeTypes: ['text/tsx'], color: '#3178c6' },
  { id: 'javascript', name: 'JavaScript', extensions: ['.js', '.mjs', '.cjs'], aliases: ['js'], mimeTypes: ['text/javascript'], color: '#f1e05a' },
  { id: 'javascriptreact', name: 'JavaScript React', extensions: ['.jsx'], aliases: ['jsx'], mimeTypes: ['text/jsx'], color: '#f1e05a' },
  { id: 'python', name: 'Python', extensions: ['.py', '.pyw', '.pyi'], aliases: ['py'], mimeTypes: ['text/x-python'], firstLine: /^#!.*\bpython[23]?\b/, color: '#3572a5' },
  { id: 'rust', name: 'Rust', extensions: ['.rs'], aliases: ['rs'], mimeTypes: ['text/x-rust'], color: '#dea584' },
  { id: 'go', name: 'Go', extensions: ['.go'], aliases: ['golang'], mimeTypes: ['text/x-go'], color: '#00add8' },
  { id: 'java', name: 'Java', extensions: ['.java'], aliases: [], mimeTypes: ['text/x-java-source'], color: '#b07219' },
  { id: 'kotlin', name: 'Kotlin', extensions: ['.kt', '.kts'], aliases: ['kt'], mimeTypes: ['text/x-kotlin'], color: '#A97BFF' },
  { id: 'swift', name: 'Swift', extensions: ['.swift'], aliases: [], mimeTypes: ['text/x-swift'], color: '#F05138' },
  { id: 'csharp', name: 'C#', extensions: ['.cs', '.csx'], aliases: ['cs'], mimeTypes: ['text/x-csharp'], color: '#178600' },
  { id: 'cpp', name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h'], aliases: ['c++'], mimeTypes: ['text/x-c++src'], color: '#f34b7d' },
  { id: 'c', name: 'C', extensions: ['.c'], aliases: [], mimeTypes: ['text/x-csrc'], color: '#555555' },
  { id: 'php', name: 'PHP', extensions: ['.php', '.phtml'], aliases: [], mimeTypes: ['text/x-php'], firstLine: /^<\?php/, color: '#4F5D95' },
  { id: 'ruby', name: 'Ruby', extensions: ['.rb', '.rake', '.gemspec'], aliases: ['rb'], mimeTypes: ['text/x-ruby'], firstLine: /^#!.*\bruby\b/, color: '#701516' },
  { id: 'lua', name: 'Lua', extensions: ['.lua'], aliases: [], mimeTypes: ['text/x-lua'], firstLine: /^#!.*\blua\b/, color: '#000080' },
  { id: 'perl', name: 'Perl', extensions: ['.pl', '.pm'], aliases: [], mimeTypes: ['text/x-perl'], firstLine: /^#!.*\bperl\b/, color: '#0298c3' },
  { id: 'r', name: 'R', extensions: ['.r', '.R', '.rmd'], aliases: [], mimeTypes: ['text/x-r'], color: '#198ce7' },
  { id: 'html', name: 'HTML', extensions: ['.html', '.htm', '.xhtml'], aliases: [], mimeTypes: ['text/html'], firstLine: /<!DOCTYPE html|<html/i, color: '#e34c26' },
  { id: 'css', name: 'CSS', extensions: ['.css'], aliases: [], mimeTypes: ['text/css'], color: '#563d7c' },
  { id: 'scss', name: 'SCSS', extensions: ['.scss'], aliases: [], mimeTypes: ['text/x-scss'], color: '#c6538c' },
  { id: 'less', name: 'Less', extensions: ['.less'], aliases: [], mimeTypes: ['text/x-less'], color: '#1d365d' },
  { id: 'json', name: 'JSON', extensions: ['.json', '.jsonc', '.json5'], aliases: [], mimeTypes: ['application/json'], color: '#8b949e' },
  { id: 'yaml', name: 'YAML', extensions: ['.yml', '.yaml'], aliases: ['yml'], mimeTypes: ['text/yaml'], color: '#cb171e' },
  { id: 'toml', name: 'TOML', extensions: ['.toml'], aliases: [], mimeTypes: ['text/toml'], color: '#9c4121' },
  { id: 'xml', name: 'XML', extensions: ['.xml', '.xsl', '.xsd', '.svg'], aliases: [], mimeTypes: ['text/xml'], firstLine: /^<\?xml/, color: '#0060ac' },
  { id: 'markdown', name: 'Markdown', extensions: ['.md', '.mdx', '.markdown'], aliases: ['md'], mimeTypes: ['text/markdown'], color: '#083fa1' },
  { id: 'sql', name: 'SQL', extensions: ['.sql'], aliases: [], mimeTypes: ['text/x-sql'], color: '#e38c00' },
  { id: 'graphql', name: 'GraphQL', extensions: ['.graphql', '.gql'], aliases: ['gql'], mimeTypes: ['application/graphql'], color: '#e10098' },
  { id: 'shell', name: 'Shell', extensions: ['.sh', '.bash', '.zsh', '.fish'], aliases: ['bash', 'zsh'], mimeTypes: ['text/x-shellscript'], firstLine: /^#!.*\b(bash|sh|zsh)\b/, color: '#89e051' },
  { id: 'powershell', name: 'PowerShell', extensions: ['.ps1', '.psm1', '.psd1'], aliases: ['ps1'], mimeTypes: ['text/x-powershell'], color: '#012456' },
  { id: 'dockerfile', name: 'Dockerfile', extensions: [], aliases: [], mimeTypes: ['text/x-dockerfile'], color: '#384d54' },
  { id: 'makefile', name: 'Makefile', extensions: [], aliases: ['make'], mimeTypes: ['text/x-makefile'], color: '#427819' },
  { id: 'vue', name: 'Vue', extensions: ['.vue'], aliases: [], mimeTypes: ['text/x-vue'], color: '#41b883' },
  { id: 'svelte', name: 'Svelte', extensions: ['.svelte'], aliases: [], mimeTypes: ['text/x-svelte'], color: '#ff3e00' },
  { id: 'astro', name: 'Astro', extensions: ['.astro'], aliases: [], mimeTypes: ['text/x-astro'], color: '#ff5a03' },
  { id: 'dart', name: 'Dart', extensions: ['.dart'], aliases: [], mimeTypes: ['text/x-dart'], color: '#00B4AB' },
  { id: 'elixir', name: 'Elixir', extensions: ['.ex', '.exs'], aliases: [], mimeTypes: ['text/x-elixir'], color: '#6e4a7e' },
  { id: 'haskell', name: 'Haskell', extensions: ['.hs', '.lhs'], aliases: ['hs'], mimeTypes: ['text/x-haskell'], color: '#5e5086' },
  { id: 'scala', name: 'Scala', extensions: ['.scala', '.sc'], aliases: [], mimeTypes: ['text/x-scala'], color: '#c22d40' },
  { id: 'clojure', name: 'Clojure', extensions: ['.clj', '.cljs', '.cljc'], aliases: ['clj'], mimeTypes: ['text/x-clojure'], color: '#db5855' },
  { id: 'zig', name: 'Zig', extensions: ['.zig'], aliases: [], mimeTypes: ['text/x-zig'], color: '#ec915c' },
  { id: 'nim', name: 'Nim', extensions: ['.nim'], aliases: [], mimeTypes: ['text/x-nim'], color: '#ffc200' },
  { id: 'ini', name: 'INI', extensions: ['.ini', '.cfg', '.conf', '.properties'], aliases: ['conf'], mimeTypes: ['text/x-ini'], color: '#d1dbe0' },
  { id: 'proto', name: 'Protocol Buffers', extensions: ['.proto'], aliases: ['protobuf'], mimeTypes: ['text/x-protobuf'], color: '#4285F4' },
  { id: 'terraform', name: 'Terraform', extensions: ['.tf', '.tfvars'], aliases: ['hcl'], mimeTypes: ['text/x-terraform'], color: '#5C4EE5' },
  { id: 'prisma', name: 'Prisma', extensions: ['.prisma'], aliases: [], mimeTypes: ['text/x-prisma'], color: '#2D3748' },
  { id: 'wasm', name: 'WebAssembly', extensions: ['.wat', '.wasm'], aliases: ['wat'], mimeTypes: ['application/wasm'], color: '#654FF0' },
  { id: 'plaintext', name: 'Plain Text', extensions: ['.txt', '.text', '.log'], aliases: ['txt'], mimeTypes: ['text/plain'], color: '#8b949e' },
]

/* ── Filename → Language Mapping ───────────────────────── */

const FILENAME_MAP: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Containerfile': 'dockerfile',
  'Makefile': 'makefile',
  'GNUmakefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  'Vagrantfile': 'ruby',
  'Procfile': 'yaml',
  '.gitignore': 'ignore',
  '.gitattributes': 'properties',
  '.editorconfig': 'ini',
  '.env': 'dotenv',
  '.env.local': 'dotenv',
  '.env.development': 'dotenv',
  '.env.production': 'dotenv',
  '.eslintrc': 'json',
  '.eslintrc.json': 'json',
  '.prettierrc': 'json',
  '.babelrc': 'json',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc',
  'package.json': 'json',
  'package-lock.json': 'json',
  'composer.json': 'json',
  'Cargo.toml': 'toml',
  'Cargo.lock': 'toml',
  'go.mod': 'gomod',
  'go.sum': 'gosum',
  'requirements.txt': 'pip-requirements',
  'Pipfile': 'toml',
  'Pipfile.lock': 'json',
  'pyproject.toml': 'toml',
  'setup.py': 'python',
  'setup.cfg': 'ini',
  'tox.ini': 'ini',
  '.dockerignore': 'ignore',
  '.npmignore': 'ignore',
  'LICENSE': 'plaintext',
  'CHANGELOG.md': 'markdown',
  'README.md': 'markdown',
}

/* ── Content Heuristics ────────────────────────────────── */

const CONTENT_PATTERNS: { pattern: RegExp; languageId: string; confidence: number }[] = [
  { pattern: /^package\s+\w+/m, languageId: 'go', confidence: 0.8 },
  { pattern: /^import\s+\(/, languageId: 'go', confidence: 0.9 },
  { pattern: /^fn\s+\w+.*->/, languageId: 'rust', confidence: 0.8 },
  { pattern: /^use\s+std::/, languageId: 'rust', confidence: 0.9 },
  { pattern: /^#\[derive\(/, languageId: 'rust', confidence: 0.95 },
  { pattern: /^import\s+React/, languageId: 'typescriptreact', confidence: 0.7 },
  { pattern: /^from\s+\w+\s+import\s+/, languageId: 'python', confidence: 0.8 },
  { pattern: /^def\s+\w+\(.*\):$/, languageId: 'python', confidence: 0.8 },
  { pattern: /^class\s+\w+:$/m, languageId: 'python', confidence: 0.7 },
  { pattern: /^<\?php/, languageId: 'php', confidence: 0.99 },
  { pattern: /^<!DOCTYPE html/i, languageId: 'html', confidence: 0.99 },
  { pattern: /^<template>[\s\S]*<script/, languageId: 'vue', confidence: 0.95 },
  { pattern: /^<script\s+lang="ts"/, languageId: 'vue', confidence: 0.9 },
  { pattern: /^defmodule\s+\w+/, languageId: 'elixir', confidence: 0.9 },
  { pattern: /^module\s+\w+\s+where/, languageId: 'haskell', confidence: 0.9 },
  { pattern: /^apiVersion:/, languageId: 'yaml', confidence: 0.8 },
  { pattern: /^\[package\]/, languageId: 'toml', confidence: 0.8 },
  { pattern: /^SELECT\s+|^INSERT\s+INTO|^CREATE\s+TABLE/i, languageId: 'sql', confidence: 0.85 },
  { pattern: /^type\s+Query\s*\{/, languageId: 'graphql', confidence: 0.9 },
  { pattern: /^syntax\s*=\s*"proto[23]"/, languageId: 'proto', confidence: 0.95 },
  { pattern: /^resource\s+"aws_/, languageId: 'terraform', confidence: 0.95 },
  { pattern: /^datasource\s+\w+\s*\{/, languageId: 'prisma', confidence: 0.95 },
]

/* ── Shebang Patterns ──────────────────────────────────── */

const SHEBANG_MAP: [RegExp, string][] = [
  [/\bnode\b/, 'javascript'],
  [/\bpython[23]?\b/, 'python'],
  [/\bruby\b/, 'ruby'],
  [/\bperl\b/, 'perl'],
  [/\bbash\b/, 'shell'],
  [/\bsh\b/, 'shell'],
  [/\bzsh\b/, 'shell'],
  [/\bfish\b/, 'shell'],
  [/\blua\b/, 'lua'],
  [/\bphp\b/, 'php'],
  [/\bawk\b/, 'awk'],
  [/\bsed\b/, 'shell'],
  [/\benv\s+node\b/, 'javascript'],
  [/\benv\s+python/, 'python'],
  [/\benv\s+ruby/, 'ruby'],
  [/\bdeno\b/, 'typescript'],
  [/\bbun\b/, 'typescript'],
  [/\btsc?\b/, 'typescript'],
]

/* ── Vim Modeline Patterns ─────────────────────────────── */

const MODELINE_PATTERNS = [
  /vim?:\s*set\s+(?:.*\s)?(?:ft|filetype)=(\w+)/,
  /vim?:\s*(?:.*\s)?(?:ft|filetype)=(\w+)/,
  /-\*-\s*mode:\s*(\w+)\s*-\*-/,
  /kate:\s*.*\bhl\s+(\w+)/,
]

const MODELINE_LANGUAGE_MAP: Record<string, string> = {
  vim: 'viml',
  python3: 'python',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
  js: 'javascript',
  ts: 'typescript',
  rb: 'ruby',
  rs: 'rust',
  cs: 'csharp',
  'c++': 'cpp',
}

/* ── Main Detection Functions ──────────────────────────── */

export function detectLanguage(
  filePath: string,
  content?: string
): DetectionResult {
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const ext = getExtension(fileName)

  // 1. Check filename mapping first (highest confidence)
  const filenameMatch = FILENAME_MAP[fileName]
  if (filenameMatch) {
    return { languageId: filenameMatch, confidence: 1.0, method: 'filename' }
  }

  // 2. Check shebang line
  if (content) {
    const firstLine = content.split('\n')[0]
    if (firstLine.startsWith('#!')) {
      for (const [pattern, langId] of SHEBANG_MAP) {
        if (pattern.test(firstLine)) {
          return { languageId: langId, confidence: 0.95, method: 'shebang' }
        }
      }
    }

    // 3. Check modelines (first 5 and last 5 lines)
    const lines = content.split('\n')
    const checkLines = [
      ...lines.slice(0, 5),
      ...lines.slice(-5),
    ]

    for (const line of checkLines) {
      for (const pattern of MODELINE_PATTERNS) {
        const match = line.match(pattern)
        if (match) {
          const mode = match[1].toLowerCase()
          const langId = MODELINE_LANGUAGE_MAP[mode] || mode
          return { languageId: langId, confidence: 0.9, method: 'modeline' }
        }
      }
    }
  }

  // 4. Check file extension
  if (ext) {
    const lang = LANGUAGES.find(l => l.extensions.includes(ext))
    if (lang) {
      return { languageId: lang.id, confidence: 0.85, method: 'extension' }
    }
  }

  // 5. Content-based heuristics
  if (content) {
    let bestMatch: DetectionResult | null = null

    for (const { pattern, languageId, confidence } of CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { languageId, confidence, method: 'content' }
        }
      }
    }

    if (bestMatch) return bestMatch
  }

  // 6. Default to plaintext
  return { languageId: 'plaintext', confidence: 0.1, method: 'default' }
}

/** Get language info by ID */
export function getLanguageInfo(languageId: string): LanguageInfo | undefined {
  return LANGUAGES.find(l => l.id === languageId || l.aliases.includes(languageId))
}

/** Get all registered languages */
export function getAllLanguages(): LanguageInfo[] {
  return [...LANGUAGES]
}

/** Get language color */
export function getLanguageColor(languageId: string): string {
  return getLanguageInfo(languageId)?.color || '#8b949e'
}

/** Get language by extension */
export function getLanguageByExtension(ext: string): LanguageInfo | undefined {
  const dotExt = ext.startsWith('.') ? ext : `.${ext}`
  return LANGUAGES.find(l => l.extensions.includes(dotExt))
}

/** Get Monaco language ID from our language ID */
export function toMonacoLanguageId(languageId: string): string {
  const mapping: Record<string, string> = {
    'shell': 'shell',
    'dotenv': 'ini',
    'ignore': 'plaintext',
    'pip-requirements': 'plaintext',
    'gomod': 'go',
    'gosum': 'plaintext',
    'cmake': 'plaintext',
    'properties': 'ini',
    'viml': 'plaintext',
    'awk': 'plaintext',
  }
  return mapping[languageId] || languageId
}

/** Get file extension with dot */
function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}

/* ── Language Statistics ───────────────────────────────── */

export interface LanguageStats {
  languageId: string
  name: string
  color: string
  fileCount: number
  lineCount: number
  percentage: number
}

export function computeLanguageStats(
  files: { path: string; lineCount: number }[]
): LanguageStats[] {
  const stats = new Map<string, { fileCount: number; lineCount: number }>()

  for (const file of files) {
    const detection = detectLanguage(file.path)
    const existing = stats.get(detection.languageId) || { fileCount: 0, lineCount: 0 }
    existing.fileCount++
    existing.lineCount += file.lineCount
    stats.set(detection.languageId, existing)
  }

  const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0)

  return [...stats.entries()]
    .map(([langId, data]) => {
      const info = getLanguageInfo(langId)
      return {
        languageId: langId,
        name: info?.name || langId,
        color: info?.color || '#8b949e',
        fileCount: data.fileCount,
        lineCount: data.lineCount,
        percentage: totalLines > 0 ? (data.lineCount / totalLines) * 100 : 0,
      }
    })
    .sort((a, b) => b.lineCount - a.lineCount)
}
