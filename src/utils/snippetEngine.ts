/**
 * Advanced snippet engine with VS Code-compatible syntax.
 * Supports tabstops, placeholders, choices, variables, and transformations.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface Snippet {
  name: string
  prefix: string | string[]
  body: string | string[]
  description?: string
  scope?: string
  isFileTemplate?: boolean
}

export interface SnippetVariable {
  name: string
  resolver: (context: SnippetContext) => string
}

export interface SnippetContext {
  filePath: string
  fileName: string
  fileNameBase: string
  fileExtension: string
  directory: string
  workspaceName: string
  selection: string
  clipboard: string
  lineIndex: number
  lineNumber: number
  cursorColumn: number
  currentDate: Date
  language: string
}

export interface TabStop {
  index: number
  placeholder: string
  choices?: string[]
  transform?: SnippetTransform
  position: { start: number; end: number }
}

export interface SnippetTransform {
  regex: string
  replacement: string
  flags: string
}

export interface ParsedSnippet {
  text: string
  tabStops: TabStop[]
  finalCursorOffset: number
}

/* ── Built-in Variables ───────────────────────────────── */

const BUILTIN_VARIABLES: Record<string, (ctx: SnippetContext) => string> = {
  TM_SELECTED_TEXT: ctx => ctx.selection,
  TM_CURRENT_LINE: () => '',
  TM_CURRENT_WORD: () => '',
  TM_LINE_INDEX: ctx => ctx.lineIndex.toString(),
  TM_LINE_NUMBER: ctx => ctx.lineNumber.toString(),
  TM_FILENAME: ctx => ctx.fileName,
  TM_FILENAME_BASE: ctx => ctx.fileNameBase,
  TM_DIRECTORY: ctx => ctx.directory,
  TM_FILEPATH: ctx => ctx.filePath,
  RELATIVE_FILEPATH: ctx => ctx.filePath,
  CLIPBOARD: ctx => ctx.clipboard,
  WORKSPACE_NAME: ctx => ctx.workspaceName,
  WORKSPACE_FOLDER: ctx => ctx.directory,
  CURSOR_INDEX: ctx => ctx.cursorColumn.toString(),
  CURSOR_NUMBER: ctx => (ctx.cursorColumn + 1).toString(),

  // Date/Time
  CURRENT_YEAR: ctx => ctx.currentDate.getFullYear().toString(),
  CURRENT_YEAR_SHORT: ctx => ctx.currentDate.getFullYear().toString().slice(-2),
  CURRENT_MONTH: ctx => (ctx.currentDate.getMonth() + 1).toString().padStart(2, '0'),
  CURRENT_MONTH_NAME: ctx => ctx.currentDate.toLocaleString('en', { month: 'long' }),
  CURRENT_MONTH_NAME_SHORT: ctx => ctx.currentDate.toLocaleString('en', { month: 'short' }),
  CURRENT_DATE: ctx => ctx.currentDate.getDate().toString().padStart(2, '0'),
  CURRENT_DAY_NAME: ctx => ctx.currentDate.toLocaleString('en', { weekday: 'long' }),
  CURRENT_DAY_NAME_SHORT: ctx => ctx.currentDate.toLocaleString('en', { weekday: 'short' }),
  CURRENT_HOUR: ctx => ctx.currentDate.getHours().toString().padStart(2, '0'),
  CURRENT_MINUTE: ctx => ctx.currentDate.getMinutes().toString().padStart(2, '0'),
  CURRENT_SECOND: ctx => ctx.currentDate.getSeconds().toString().padStart(2, '0'),
  CURRENT_SECONDS_UNIX: ctx => Math.floor(ctx.currentDate.getTime() / 1000).toString(),
  CURRENT_TIMEZONE_OFFSET: ctx => {
    const offset = ctx.currentDate.getTimezoneOffset()
    const sign = offset <= 0 ? '+' : '-'
    const h = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0')
    const m = (Math.abs(offset) % 60).toString().padStart(2, '0')
    return `${sign}${h}:${m}`
  },

  // Random
  RANDOM: () => Math.random().toString().slice(2, 8),
  RANDOM_HEX: () => Math.random().toString(16).slice(2, 8),
  UUID: () => crypto.randomUUID(),

  // Block comment
  BLOCK_COMMENT_START: ctx => {
    const map: Record<string, string> = { python: '#', html: '<!--', css: '/*', sql: '/*' }
    return map[ctx.language] || '/*'
  },
  BLOCK_COMMENT_END: ctx => {
    const map: Record<string, string> = { python: '', html: '-->', css: '*/', sql: '*/' }
    return map[ctx.language] || '*/'
  },
  LINE_COMMENT: ctx => {
    const map: Record<string, string> = { python: '#', html: '<!--', css: '//', sql: '--' }
    return map[ctx.language] || '//'
  },
}

/* ── Snippet Parser ───────────────────────────────────── */

export function parseSnippetBody(body: string | string[]): string {
  if (Array.isArray(body)) return body.join('\n')
  return body
}

export function expandSnippet(raw: string, context: SnippetContext): ParsedSnippet {
  let text = raw
  const tabStops: TabStop[] = []

  // Step 1: Resolve variables ($VARIABLE or ${VARIABLE:default} or ${VARIABLE/regex/replacement/flags})
  text = resolveVariables(text, context)

  // Step 2: Parse tab stops and placeholders
  const { result, stops } = parseTabStops(text)
  text = result

  // Sort tabstops by index
  stops.sort((a, b) => a.index - b.index)

  // Find final cursor position ($0)
  const finalStop = stops.find(s => s.index === 0)
  const finalCursorOffset = finalStop?.position.start ?? text.length

  return {
    text,
    tabStops: stops.filter(s => s.index > 0),
    finalCursorOffset,
  }
}

function resolveVariables(text: string, context: SnippetContext): string {
  // ${VARIABLE:default}
  text = text.replace(/\$\{(\w+):([^}]*)\}/g, (_, name, defaultValue) => {
    const resolver = BUILTIN_VARIABLES[name]
    if (resolver) {
      const value = resolver(context)
      return value || defaultValue
    }
    return defaultValue
  })

  // ${VARIABLE/regex/replacement/flags}
  text = text.replace(/\$\{(\w+)\/([^/]*)\/([^/]*)\/([^}]*)\}/g, (_, name, regex, replacement, flags) => {
    const resolver = BUILTIN_VARIABLES[name]
    if (resolver) {
      const value = resolver(context)
      try {
        return value.replace(new RegExp(regex, flags), replacement)
      } catch {
        return value
      }
    }
    return ''
  })

  // $VARIABLE (simple)
  text = text.replace(/\$(\w+)(?!\d)/g, (match, name) => {
    // Skip if it's a tab stop ($1, $2, etc.)
    if (/^\d+$/.test(name)) return match
    const resolver = BUILTIN_VARIABLES[name]
    return resolver ? resolver(context) : match
  })

  return text
}

function parseTabStops(text: string): { result: string; stops: TabStop[] } {
  const stops: TabStop[] = []
  let result = ''
  let i = 0

  while (i < text.length) {
    if (text[i] === '$') {
      // Simple tabstop: $1, $0
      const simpleMatch = text.slice(i).match(/^\$(\d+)/)
      if (simpleMatch) {
        const index = parseInt(simpleMatch[1])
        stops.push({
          index,
          placeholder: '',
          position: { start: result.length, end: result.length },
        })
        i += simpleMatch[0].length
        continue
      }

      // Placeholder: ${1:text}
      const placeholderMatch = text.slice(i).match(/^\$\{(\d+):([^}]*)\}/)
      if (placeholderMatch) {
        const index = parseInt(placeholderMatch[1])
        const placeholder = placeholderMatch[2]
        stops.push({
          index,
          placeholder,
          position: { start: result.length, end: result.length + placeholder.length },
        })
        result += placeholder
        i += placeholderMatch[0].length
        continue
      }

      // Choice: ${1|one,two,three|}
      const choiceMatch = text.slice(i).match(/^\$\{(\d+)\|([^}]+)\|\}/)
      if (choiceMatch) {
        const index = parseInt(choiceMatch[1])
        const choices = choiceMatch[2].split(',')
        const firstChoice = choices[0] || ''
        stops.push({
          index,
          placeholder: firstChoice,
          choices,
          position: { start: result.length, end: result.length + firstChoice.length },
        })
        result += firstChoice
        i += choiceMatch[0].length
        continue
      }

      // Transform: ${1/regex/replacement/flags}
      const transformMatch = text.slice(i).match(/^\$\{(\d+)\/([^/]*)\/([^/]*)\/([^}]*)\}/)
      if (transformMatch) {
        const index = parseInt(transformMatch[1])
        stops.push({
          index,
          placeholder: '',
          transform: {
            regex: transformMatch[2],
            replacement: transformMatch[3],
            flags: transformMatch[4],
          },
          position: { start: result.length, end: result.length },
        })
        i += transformMatch[0].length
        continue
      }
    }

    // Escaped characters
    if (text[i] === '\\' && i + 1 < text.length && '${}\\'.includes(text[i + 1])) {
      result += text[i + 1]
      i += 2
      continue
    }

    result += text[i]
    i++
  }

  return { result, stops }
}

/* ── Built-in Snippets ────────────────────────────────── */

export const BUILTIN_SNIPPETS: Record<string, Snippet[]> = {
  typescript: [
    { name: 'Console Log', prefix: 'clg', body: "console.log('$1', $2);$0", description: 'Console log statement' },
    { name: 'Console Error', prefix: 'cle', body: "console.error('$1', $2);$0", description: 'Console error statement' },
    { name: 'Arrow Function', prefix: 'af', body: 'const ${1:name} = ($2) => {\n\t$0\n};', description: 'Arrow function' },
    { name: 'Async Arrow Function', prefix: 'aaf', body: 'const ${1:name} = async ($2) => {\n\t$0\n};', description: 'Async arrow function' },
    { name: 'Export Function', prefix: 'ef', body: 'export function ${1:name}($2): ${3:void} {\n\t$0\n}', description: 'Exported function' },
    { name: 'Export Default Function', prefix: 'edf', body: 'export default function ${1:name}($2) {\n\t$0\n}', description: 'Export default function' },
    { name: 'Interface', prefix: 'iface', body: 'interface ${1:Name} {\n\t${2:property}: ${3:type};\n\t$0\n}', description: 'TypeScript interface' },
    { name: 'Export Interface', prefix: 'eiface', body: 'export interface ${1:Name} {\n\t${2:property}: ${3:type};\n\t$0\n}', description: 'Exported interface' },
    { name: 'Type Alias', prefix: 'type', body: 'type ${1:Name} = $0;', description: 'Type alias' },
    { name: 'Enum', prefix: 'enum', body: 'enum ${1:Name} {\n\t${2:Value},\n\t$0\n}', description: 'Enum' },
    { name: 'Try-Catch', prefix: 'trycatch', body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}', description: 'Try-catch block' },
    { name: 'Promise', prefix: 'prom', body: 'new Promise<${1:void}>((resolve, reject) => {\n\t$0\n});', description: 'New Promise' },
    { name: 'For Of Loop', prefix: 'forof', body: 'for (const ${1:item} of ${2:array}) {\n\t$0\n}', description: 'For...of loop' },
    { name: 'Map', prefix: 'map', body: '${1:array}.map((${2:item}) => {\n\t$0\n});', description: 'Array map' },
    { name: 'Filter', prefix: 'filter', body: '${1:array}.filter((${2:item}) => $0);', description: 'Array filter' },
    { name: 'Reduce', prefix: 'reduce', body: '${1:array}.reduce((${2:acc}, ${3:item}) => {\n\t$0\n\treturn ${2:acc};\n}, ${4:initialValue});', description: 'Array reduce' },
    { name: 'Destructure', prefix: 'dest', body: 'const { $1 } = $2;$0', description: 'Object destructuring' },
    { name: 'Import', prefix: 'imp', body: "import { $2 } from '$1';$0", description: 'Import statement' },
    { name: 'Import Default', prefix: 'impd', body: "import $2 from '$1';$0", description: 'Default import' },
  ],

  typescriptreact: [
    { name: 'React Component', prefix: 'rfc', body: [
      "import { ${2:useState} } from 'react';",
      '',
      'interface ${1:Component}Props {',
      '\t$3',
      '}',
      '',
      'export default function ${1:Component}({ $4 }: ${1:Component}Props) {',
      '\treturn (',
      '\t\t<div>',
      '\t\t\t$0',
      '\t\t</div>',
      '\t);',
      '}',
    ], description: 'React function component with props' },
    { name: 'useState', prefix: 'us', body: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState($2);$0', description: 'useState hook' },
    { name: 'useEffect', prefix: 'ue', body: 'useEffect(() => {\n\t$1\n\treturn () => {\n\t\t$2\n\t};\n}, [$3]);$0', description: 'useEffect hook' },
    { name: 'useCallback', prefix: 'ucb', body: 'const ${1:handler} = useCallback(($2) => {\n\t$0\n}, [$3]);', description: 'useCallback hook' },
    { name: 'useMemo', prefix: 'um', body: 'const ${1:value} = useMemo(() => {\n\t$0\n}, [$2]);', description: 'useMemo hook' },
    { name: 'useRef', prefix: 'ur', body: 'const ${1:ref} = useRef<${2:HTMLDivElement}>(${3:null});$0', description: 'useRef hook' },
    { name: 'useContext', prefix: 'uctx', body: 'const ${1:value} = useContext(${2:Context});$0', description: 'useContext hook' },
    { name: 'JSX Element', prefix: 'jsx', body: '<${1:div} ${2:className}="${3}">\n\t$0\n</${1:div}>', description: 'JSX element' },
    { name: 'Conditional Render', prefix: 'cond', body: '{${1:condition} && (\n\t$0\n)}', description: 'Conditional rendering' },
    { name: 'Map Render', prefix: 'mapr', body: '{${1:items}.map((${2:item}) => (\n\t<${3:div} key={${2:item}.id}>\n\t\t$0\n\t</${3:div}>\n))}', description: 'Map with render' },
  ],

  python: [
    { name: 'Main', prefix: 'main', body: 'if __name__ == "__main__":\n\t$0', description: 'Main guard' },
    { name: 'Function', prefix: 'def', body: 'def ${1:name}(${2:params}) -> ${3:None}:\n\t"""${4:Description}"""\n\t$0', description: 'Function definition' },
    { name: 'Class', prefix: 'class', body: 'class ${1:Name}:\n\t"""${2:Description}"""\n\n\tdef __init__(self, $3):\n\t\t$0', description: 'Class definition' },
    { name: 'Dataclass', prefix: 'dc', body: '@dataclass\nclass ${1:Name}:\n\t${2:field}: ${3:str}\n\t$0', description: 'Dataclass' },
    { name: 'Try-Except', prefix: 'try', body: 'try:\n\t$1\nexcept ${2:Exception} as e:\n\t$0', description: 'Try-except block' },
    { name: 'With Statement', prefix: 'with', body: "with ${1:open('file')} as ${2:f}:\n\t$0", description: 'With statement' },
    { name: 'List Comprehension', prefix: 'lc', body: '[${1:expr} for ${2:item} in ${3:iterable}]$0', description: 'List comprehension' },
    { name: 'Dict Comprehension', prefix: 'dc2', body: '{${1:key}: ${2:value} for ${3:item} in ${4:iterable}}$0', description: 'Dict comprehension' },
    { name: 'Lambda', prefix: 'lam', body: 'lambda ${1:x}: $0', description: 'Lambda function' },
    { name: 'Async Function', prefix: 'adef', body: 'async def ${1:name}(${2:params}) -> ${3:None}:\n\t"""${4:Description}"""\n\t$0', description: 'Async function' },
    { name: 'FastAPI Route', prefix: 'fapi', body: '@app.${1|get,post,put,delete,patch|}("/${2:path}")\nasync def ${3:handler}(${4:request}):\n\t$0', description: 'FastAPI route' },
  ],

  go: [
    { name: 'Main', prefix: 'main', body: 'func main() {\n\t$0\n}', description: 'Main function' },
    { name: 'Function', prefix: 'func', body: 'func ${1:name}(${2:params}) ${3:error} {\n\t$0\n}', description: 'Function' },
    { name: 'Error Check', prefix: 'iferr', body: 'if err != nil {\n\t${1:return err}\n}$0', description: 'Error check' },
    { name: 'Struct', prefix: 'struct', body: 'type ${1:Name} struct {\n\t${2:Field} ${3:string}\n\t$0\n}', description: 'Struct definition' },
    { name: 'Interface', prefix: 'iface', body: 'type ${1:Name} interface {\n\t${2:Method}(${3:params}) ${4:error}\n\t$0\n}', description: 'Interface' },
    { name: 'HTTP Handler', prefix: 'handler', body: 'func ${1:handler}(w http.ResponseWriter, r *http.Request) {\n\t$0\n}', description: 'HTTP handler' },
    { name: 'For Range', prefix: 'forr', body: 'for ${1:i}, ${2:v} := range ${3:slice} {\n\t$0\n}', description: 'For range loop' },
    { name: 'Goroutine', prefix: 'go', body: 'go func() {\n\t$0\n}()', description: 'Goroutine' },
    { name: 'Test', prefix: 'test', body: 'func Test${1:Name}(t *testing.T) {\n\t$0\n}', description: 'Test function' },
  ],

  css: [
    { name: 'Flexbox Center', prefix: 'flex-center', body: 'display: flex;\njustify-content: center;\nalign-items: center;$0', description: 'Flexbox centering' },
    { name: 'Grid', prefix: 'grid', body: 'display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngap: ${2:1rem};$0', description: 'CSS Grid' },
    { name: 'Media Query', prefix: 'mq', body: '@media (${1|max-width,min-width|}: ${2:768px}) {\n\t$0\n}', description: 'Media query' },
    { name: 'Animation', prefix: 'anim', body: '@keyframes ${1:name} {\n\tfrom {\n\t\t$2\n\t}\n\tto {\n\t\t$3\n\t}\n}\n\n.${4:element} {\n\tanimation: ${1:name} ${5:0.3s} ${6:ease};\n}$0', description: 'CSS animation' },
    { name: 'Variable', prefix: 'var', body: 'var(--${1:name}${2:, ${3:fallback}})$0', description: 'CSS variable' },
    { name: 'Transition', prefix: 'trans', body: 'transition: ${1:all} ${2:0.3s} ${3:ease};$0', description: 'Transition' },
  ],

  html: [
    { name: 'HTML5 Boilerplate', prefix: 'html5', body: [
      '<!DOCTYPE html>',
      '<html lang="${1:en}">',
      '<head>',
      '\t<meta charset="UTF-8">',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '\t<title>${2:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ], description: 'HTML5 boilerplate' },
    { name: 'Link Tag', prefix: 'link', body: '<link rel="${1:stylesheet}" href="$2">$0', description: 'Link tag' },
    { name: 'Script Tag', prefix: 'script', body: '<script src="$1"></script>$0', description: 'Script tag' },
  ],
}

/* ── Snippet Search ───────────────────────────────────── */

export function findSnippets(prefix: string, language: string): Snippet[] {
  const languageSnippets = BUILTIN_SNIPPETS[language] || []
  const tsSnippets = ['typescriptreact'].includes(language) ? BUILTIN_SNIPPETS.typescript || [] : []
  const allSnippets = [...languageSnippets, ...tsSnippets]

  if (!prefix) return allSnippets

  return allSnippets.filter(s => {
    const prefixes = Array.isArray(s.prefix) ? s.prefix : [s.prefix]
    return prefixes.some(p => p.startsWith(prefix.toLowerCase()))
  })
}

export function getSnippetCompletions(prefix: string, language: string): Array<{
  label: string
  insertText: string
  detail: string
  kind: 'snippet'
}> {
  return findSnippets(prefix, language).map(s => ({
    label: Array.isArray(s.prefix) ? s.prefix[0] : s.prefix,
    insertText: parseSnippetBody(s.body),
    detail: s.description || s.name,
    kind: 'snippet' as const,
  }))
}

/* ── Custom Snippet Storage ───────────────────────────── */

const CUSTOM_SNIPPETS_KEY = 'orion:custom-snippets'

export function getCustomSnippets(): Record<string, Snippet[]> {
  try {
    const stored = localStorage.getItem(CUSTOM_SNIPPETS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function saveCustomSnippet(language: string, snippet: Snippet): void {
  const snippets = getCustomSnippets()
  if (!snippets[language]) snippets[language] = []
  snippets[language].push(snippet)
  localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(snippets))
}

export function removeCustomSnippet(language: string, name: string): void {
  const snippets = getCustomSnippets()
  if (snippets[language]) {
    snippets[language] = snippets[language].filter(s => s.name !== name)
    localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(snippets))
  }
}

export function importVSCodeSnippets(json: Record<string, any>): Snippet[] {
  return Object.entries(json).map(([name, def]) => ({
    name,
    prefix: def.prefix,
    body: def.body,
    description: def.description,
    scope: def.scope,
  }))
}

export function exportToVSCodeFormat(snippets: Snippet[]): Record<string, any> {
  const result: Record<string, any> = {}
  for (const s of snippets) {
    result[s.name] = {
      prefix: s.prefix,
      body: Array.isArray(s.body) ? s.body : s.body.split('\n'),
      description: s.description,
      scope: s.scope,
    }
  }
  return result
}
