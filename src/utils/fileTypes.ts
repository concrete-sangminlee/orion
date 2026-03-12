/**
 * File type detection, language mapping, and MIME types.
 * Used throughout the IDE for syntax highlighting, icons, and file handling.
 */

/* ── Extension to Language ID ──────────────────────────── */

const EXT_TO_LANGUAGE: Record<string, string> = {
  // JavaScript family
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.d.ts': 'typescript',

  // Web
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.svg': 'xml', '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml',

  // Data
  '.json': 'json', '.jsonc': 'jsonc', '.json5': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.csv': 'csv', '.tsv': 'csv',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.env': 'dotenv', '.env.local': 'dotenv', '.env.example': 'dotenv',

  // Systems
  '.py': 'python', '.pyw': 'python', '.pyi': 'python',
  '.rb': 'ruby', '.rake': 'ruby', '.gemspec': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.scala': 'scala',
  '.zig': 'zig',
  '.lua': 'lua',
  '.r': 'r', '.R': 'r',
  '.jl': 'julia',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
  '.lisp': 'lisp', '.el': 'lisp',
  '.pl': 'perl', '.pm': 'perl',
  '.php': 'php',
  '.dart': 'dart',
  '.v': 'v', '.vsh': 'v',
  '.nim': 'nim',
  '.cr': 'crystal',

  // Shell
  '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript',
  '.fish': 'shellscript',
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat',

  // Documentation
  '.md': 'markdown', '.mdx': 'markdown', '.rmd': 'markdown',
  '.rst': 'restructuredtext',
  '.tex': 'latex', '.bib': 'bibtex',
  '.adoc': 'asciidoc',
  '.org': 'orgmode',

  // Config
  '.dockerfile': 'dockerfile',
  '.dockerignore': 'ignore',
  '.gitignore': 'ignore', '.gitattributes': 'properties',
  '.npmignore': 'ignore', '.eslintignore': 'ignore',
  '.editorconfig': 'ini',
  '.prettierrc': 'json', '.eslintrc': 'json', '.babelrc': 'json',
  '.tf': 'hcl', '.hcl': 'hcl',
  '.prisma': 'prisma',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf',

  // Database
  '.sql': 'sql',

  // Other
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  '.wasm': 'wasm',
  '.lock': 'lock',
}

/** Special filenames mapped to languages */
const NAME_TO_LANGUAGE: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  'Jenkinsfile': 'groovy',
  'Vagrantfile': 'ruby',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.env': 'dotenv',
  'package.json': 'json',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc',
  '.eslintrc.json': 'jsonc',
  '.prettierrc.json': 'json',
  'tailwind.config.js': 'javascript',
  'vite.config.ts': 'typescript',
  'webpack.config.js': 'javascript',
  'rollup.config.js': 'javascript',
  'jest.config.ts': 'typescript',
  'vitest.config.ts': 'typescript',
}

/* ── Public API ────────────────────────────────────────── */

export function getLanguageId(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || ''

  // Check exact filename first
  const byName = NAME_TO_LANGUAGE[name]
  if (byName) return byName

  // Check double extension (.d.ts, .test.ts)
  const doubleExt = name.match(/(\.\w+\.\w+)$/)?.[1]?.toLowerCase()
  if (doubleExt && EXT_TO_LANGUAGE[doubleExt]) return EXT_TO_LANGUAGE[doubleExt]

  // Check single extension
  const ext = name.match(/(\.\w+)$/)?.[1]?.toLowerCase()
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext]

  return 'plaintext'
}

export function isImageFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'avif', 'tiff', 'tif'].includes(ext || '')
}

export function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tiff', 'tif',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'mp4', 'mkv', 'avi', 'mov', 'wmv',
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'wasm',
  ].includes(ext || '')
}

export function getFileCategory(path: string): string {
  const lang = getLanguageId(path)
  if (['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(lang)) return 'JavaScript/TypeScript'
  if (['python'].includes(lang)) return 'Python'
  if (['go'].includes(lang)) return 'Go'
  if (['rust'].includes(lang)) return 'Rust'
  if (['html', 'css', 'scss', 'less'].includes(lang)) return 'Web'
  if (['json', 'yaml', 'toml', 'xml', 'ini'].includes(lang)) return 'Data/Config'
  if (['markdown', 'restructuredtext', 'latex'].includes(lang)) return 'Documentation'
  if (['shellscript', 'powershell', 'bat'].includes(lang)) return 'Scripts'
  if (isImageFile(path)) return 'Images'
  if (isBinaryFile(path)) return 'Binary'
  return 'Other'
}

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const mimes: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    ts: 'application/typescript', json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
    md: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
    zip: 'application/zip', wasm: 'application/wasm',
  }
  return mimes[ext || ''] || 'application/octet-stream'
}
