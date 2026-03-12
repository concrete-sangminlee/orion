/**
 * Enhanced language providers for Monaco editor.
 *
 * Registers DefinitionProvider, ReferenceProvider, HoverProvider,
 * DocumentSymbolProvider, and RenameProvider for TS/JS/TSX/JSX.
 * Uses regex-based parsing -- no TypeScript compiler required.
 */

import type { Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'

// ── Languages to register providers for ──────────────────
const PROVIDER_LANGUAGES = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact']

// ── Import parsing ──────────────────
const IMPORT_PATH_REGEX = /(?:import\s+.*\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/
const IMPORT_FULL_SRC = /import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s+from\s+['"](.+?)['"]/.source

interface ImportInfo {
  name: string
  alias?: string
  path: string
  isDefault: boolean
}

function parseImports(text: string): ImportInfo[] {
  const results: ImportInfo[] = []
  const regex = new RegExp(IMPORT_FULL_SRC, 'gm')
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const defaultName = m[1]
    const namedPart = m[2]
    const importPath = m[3]
    if (defaultName) results.push({ name: defaultName, path: importPath, isDefault: true })
    if (namedPart) {
      for (const n of namedPart.split(',').map((s) => s.trim()).filter(Boolean)) {
        const asParts = n.split(/\s+as\s+/)
        if (asParts.length === 2) results.push({ name: asParts[0].trim(), alias: asParts[1].trim(), path: importPath, isDefault: false })
        else results.push({ name: n.trim(), path: importPath, isDefault: false })
      }
    }
  }
  return results
}

// ── Re-export parsing ──────────────────
interface ReExportInfo {
  names: string[] | '*'
  sourcePath: string
  alias?: string // for `export * as ns from '...'`
}

function parseReExports(text: string): ReExportInfo[] {
  const results: ReExportInfo[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    // export { foo, bar } from './module'
    const namedReExport = line.match(/export\s+\{([^}]*)\}\s+from\s+['"](.+?)['"]/)
    if (namedReExport) {
      const names = namedReExport[1].split(',').map((s) => {
        const parts = s.trim().split(/\s+as\s+/)
        return parts[parts.length - 1].trim()
      }).filter(Boolean)
      results.push({ names, sourcePath: namedReExport[2] })
      continue
    }
    // export * as ns from './module'
    const nsReExport = line.match(/export\s+\*\s+as\s+(\w+)\s+from\s+['"](.+?)['"]/)
    if (nsReExport) {
      results.push({ names: '*', sourcePath: nsReExport[2], alias: nsReExport[1] })
      continue
    }
    // export * from './module'
    const starReExport = line.match(/export\s+\*\s+from\s+['"](.+?)['"]/)
    if (starReExport) {
      results.push({ names: '*', sourcePath: starReExport[1] })
      continue
    }
  }
  return results
}

// ── Definition finding ──────────────────
interface DefLocation {
  lineNum: number
  col: number
  endCol: number
  content: string
}

function findDefinitionInText(symbolName: string, text: string): DefLocation | null {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const defRegex = new RegExp(
    `(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s+(${escaped})\\b|(?:const|let|var)\\s+(${escaped})\\s*[=:]|class\\s+(${escaped})\\b|interface\\s+(${escaped})\\b|type\\s+(${escaped})\\b|enum\\s+(${escaped})\\b)`,
  )
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = defRegex.exec(lines[i])
    if (match) {
      const matchedName = match[1] || match[2] || match[3] || match[4] || match[5] || match[6]
      const nameIdx = lines[i].indexOf(matchedName, match.index)
      return { lineNum: i + 1, col: nameIdx + 1, endCol: nameIdx + 1 + matchedName.length, content: lines[i] }
    }
  }
  // Check export { name } patterns
  const exportRegex = new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`)
  for (let i = 0; i < lines.length; i++) {
    if (exportRegex.test(lines[i])) {
      const nameIdx = lines[i].indexOf(symbolName)
      return { lineNum: i + 1, col: nameIdx + 1, endCol: nameIdx + 1 + symbolName.length, content: lines[i] }
    }
  }
  return null
}

// ── Occurrence finding ──────────────────
interface Occurrence {
  lineNum: number
  col: number
  endCol: number
}

function findAllOccurrences(symbolName: string, text: string): Occurrence[] {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`\\b${escaped}\\b`, 'g')
  const results: Occurrence[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(lines[i])) !== null) {
      results.push({ lineNum: i + 1, col: match.index + 1, endCol: match.index + 1 + symbolName.length })
    }
  }
  return results
}

// ── JSDoc extraction with markdown formatting ──────────────────
function extractJSDocFormatted(lines: string[], defLineIdx: number): string | null {
  let endIdx = defLineIdx - 1
  while (endIdx >= 0 && lines[endIdx].trim() === '') endIdx--
  if (endIdx < 0 || !lines[endIdx].trim().endsWith('*/')) return null
  let startIdx = endIdx
  while (startIdx >= 0 && !lines[startIdx].includes('/**')) startIdx--
  if (startIdx < 0) return null

  const rawLines = lines
    .slice(startIdx, endIdx + 1)
    .map((l) => l.trim().replace(/^\/\*\*\s?|\s?\*\/$/g, '').replace(/^\*\s?/, ''))
    .filter((l) => l.length > 0)

  const result: string[] = []
  let description: string[] = []
  const params: string[] = []
  let returns = ''
  let example: string[] = []
  let inExample = false
  let deprecated = ''
  let since = ''
  let see: string[] = []
  let throws: string[] = []

  for (const line of rawLines) {
    if (line.startsWith('@param')) {
      inExample = false
      const paramMatch = line.match(/@param\s+\{([^}]+)\}\s+(\w+)\s*-?\s*(.*)/)
      if (paramMatch) {
        params.push(`- \`${paramMatch[2]}\`: \`${paramMatch[1]}\` -- ${paramMatch[3]}`)
      } else {
        const simpleParam = line.match(/@param\s+(\w+)\s*-?\s*(.*)/)
        if (simpleParam) {
          params.push(`- \`${simpleParam[1]}\` -- ${simpleParam[2]}`)
        }
      }
    } else if (line.startsWith('@returns') || line.startsWith('@return')) {
      inExample = false
      const retMatch = line.match(/@returns?\s+\{([^}]+)\}\s*(.*)/)
      if (retMatch) {
        returns = `**Returns** \`${retMatch[1]}\` -- ${retMatch[2]}`
      } else {
        returns = `**Returns** ${line.replace(/@returns?\s*/, '')}`
      }
    } else if (line.startsWith('@example')) {
      inExample = true
    } else if (line.startsWith('@deprecated')) {
      inExample = false
      deprecated = line.replace(/@deprecated\s*/, '') || 'This is deprecated.'
    } else if (line.startsWith('@since')) {
      inExample = false
      since = line.replace(/@since\s*/, '')
    } else if (line.startsWith('@see')) {
      inExample = false
      see.push(line.replace(/@see\s*/, ''))
    } else if (line.startsWith('@throws') || line.startsWith('@throw')) {
      inExample = false
      throws.push(line.replace(/@throws?\s*/, ''))
    } else if (line.startsWith('@')) {
      inExample = false
      // skip unknown tags
    } else if (inExample) {
      example.push(line)
    } else {
      description.push(line)
    }
  }

  if (description.length > 0) result.push(description.join(' '))
  if (deprecated) result.push(`\n**@deprecated** ${deprecated}`)
  if (params.length > 0) result.push('\n**Parameters:**\n' + params.join('\n'))
  if (returns) result.push('\n' + returns)
  if (throws.length > 0) result.push('\n**Throws:** ' + throws.join(', '))
  if (since) result.push(`\n*Since: ${since}*`)
  if (see.length > 0) result.push('\n*See:* ' + see.join(', '))
  if (example.length > 0) result.push('\n**Example:**\n```typescript\n' + example.join('\n') + '\n```')

  return result.length > 0 ? result.join('\n') : null
}

// ── Signature extraction ──────────────────
function extractSignature(lines: string[], lineIdx: number): string | null {
  const line = lines[lineIdx]

  // function declaration - handle multi-line params
  const funcMatch = line.match(
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/,
  )
  if (funcMatch) return `function ${funcMatch[1]}${funcMatch[2] || ''}(${funcMatch[3].trim()}): ${funcMatch[4] || 'void'}`

  // function declaration with params spanning multiple lines
  const funcStartMatch = line.match(
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*(<[^>]*>)?\s*\(/,
  )
  if (funcStartMatch && !line.includes(')')) {
    let params = line.substring(line.indexOf('(') + 1).trim()
    for (let j = lineIdx + 1; j < Math.min(lineIdx + 20, lines.length); j++) {
      const closeParen = lines[j].indexOf(')')
      if (closeParen !== -1) {
        params += ' ' + lines[j].substring(0, closeParen).trim()
        const retMatch = lines[j].match(/\)\s*:\s*([^\s{]+)/)
        const retType = retMatch ? retMatch[1] : 'void'
        // Clean up multi-line params
        params = params.replace(/\s+/g, ' ').trim()
        return `function ${funcStartMatch[1]}${funcStartMatch[2] || ''}(${params}): ${retType}`
      }
      params += ' ' + lines[j].trim()
    }
  }

  // arrow function
  const arrowMatch = line.match(
    /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+?)\s*)?=\s*(?:async\s+)?(?:\(([^)]*)\)|(\w+))\s*(?::\s*([^\s=>]+))?\s*=>/,
  )
  if (arrowMatch) {
    if (arrowMatch[2]) return `const ${arrowMatch[1]}: ${arrowMatch[2].trim()}`
    const params = arrowMatch[3] !== undefined ? arrowMatch[3].trim() : arrowMatch[4]
    return `const ${arrowMatch[1]} = (${params}) => ${arrowMatch[5] || 'inferred'}`
  }

  // arrow function with multi-line params
  const arrowStartMatch = line.match(
    /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+?)\s*)?=\s*(?:async\s+)?\(/,
  )
  if (arrowStartMatch && !line.includes(')')) {
    if (arrowStartMatch[2]) return `const ${arrowStartMatch[1]}: ${arrowStartMatch[2].trim()}`
    let params = line.substring(line.lastIndexOf('(') + 1).trim()
    for (let j = lineIdx + 1; j < Math.min(lineIdx + 20, lines.length); j++) {
      const closeParen = lines[j].indexOf(')')
      if (closeParen !== -1) {
        params += ' ' + lines[j].substring(0, closeParen).trim()
        const retMatch = lines[j].match(/\)\s*(?::\s*([^\s=>]+))?\s*=>/)
        const retType = retMatch?.[1] || 'inferred'
        params = params.replace(/\s+/g, ' ').trim()
        return `const ${arrowStartMatch[1]} = (${params}) => ${retType}`
      }
      params += ' ' + lines[j].trim()
    }
  }

  // class
  const classMatch = line.match(
    /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+(.+?))?(?:\s*\{)?$/,
  )
  if (classMatch) {
    let s = `class ${classMatch[1]}`
    if (classMatch[2]) s += ` extends ${classMatch[2]}`
    if (classMatch[3]) s += ` implements ${classMatch[3]}`
    return s
  }

  // interface
  const ifMatch = line.match(/(?:export\s+)?interface\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+(.+?))?/)
  if (ifMatch) {
    let s = `interface ${ifMatch[1]}`
    if (ifMatch[2]) s += `<${ifMatch[2]}>`
    if (ifMatch[3]) s += ` extends ${ifMatch[3]}`
    return s
  }

  // type alias
  const typeMatch = line.match(/(?:export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*(.+)/)
  if (typeMatch) return `type ${typeMatch[1]}${typeMatch[2] ? `<${typeMatch[2]}>` : ''} = ${typeMatch[3].trim()}`

  // enum
  const enumMatch = line.match(/(?:export\s+)?enum\s+(\w+)/)
  if (enumMatch) return `enum ${enumMatch[1]}`

  // variable with type annotation
  const varTyped = line.match(/(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*:\s*([^=]+?)\s*=/)
  if (varTyped) return `${(line.match(/const|let|var/) || ['const'])[0]} ${varTyped[1]}: ${varTyped[2].trim()}`

  // variable with inferred type
  const varInfer = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?)(?:;|\s*$)/)
  if (varInfer) {
    const val = varInfer[2].trim()
    let inferred = 'unknown'
    if (/^['"`]/.test(val)) inferred = 'string'
    else if (/^\d/.test(val)) inferred = 'number'
    else if (/^(?:true|false)$/.test(val)) inferred = 'boolean'
    else if (/^\[/.test(val)) inferred = 'Array'
    else if (/^\{/.test(val)) inferred = 'object'
    else if (/^new\s+(\w+)/.test(val)) inferred = val.match(/^new\s+(\w+)/)![1]
    else if (/^null$/.test(val)) inferred = 'null'
    else if (/^undefined$/.test(val)) inferred = 'undefined'
    else if (/^document\./.test(val)) inferred = 'Element | null'
    else if (/^React\.createRef/.test(val) || /^useRef/.test(val)) inferred = 'React.RefObject'
    else if (/^new Map/.test(val)) inferred = 'Map'
    else if (/^new Set/.test(val)) inferred = 'Set'
    else if (/^new WeakMap/.test(val)) inferred = 'WeakMap'
    else if (/^new WeakSet/.test(val)) inferred = 'WeakSet'
    else if (/^new Promise/.test(val)) inferred = 'Promise'
    else if (/^new RegExp/.test(val) || /^\/[^/]/.test(val)) inferred = 'RegExp'
    else if (/^new Date/.test(val) || /^Date\./.test(val)) inferred = 'Date'
    return `${(line.match(/const|let|var/) || ['const'])[0]} ${varInfer[1]}: ${inferred}`
  }

  return null
}

// ── Enhanced parameter info extraction ──────────────────
interface ParamInfo {
  name: string
  type?: string
  optional: boolean
  defaultValue?: string
}

function extractParameterInfo(lines: string[], lineIdx: number): ParamInfo[] {
  const params: ParamInfo[] = []
  // Collect the full parameter string, possibly spanning multiple lines
  let paramStr = ''
  let depth = 0
  let foundOpen = false
  for (let j = lineIdx; j < Math.min(lineIdx + 30, lines.length); j++) {
    for (let k = 0; k < lines[j].length; k++) {
      const ch = lines[j][k]
      if (ch === '(') {
        if (!foundOpen) { foundOpen = true; continue }
        depth++
      }
      if (ch === ')') {
        if (depth === 0 && foundOpen) {
          // Parse paramStr
          return parseParamString(paramStr)
        }
        depth--
      }
      if (foundOpen) paramStr += ch
    }
    if (foundOpen) paramStr += ' '
  }
  return params
}

function parseParamString(paramStr: string): ParamInfo[] {
  const params: ParamInfo[] = []
  // Split carefully considering nested <> and {}
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const ch of paramStr) {
    if ((ch === '<' || ch === '{' || ch === '(') ) depth++
    if ((ch === '>' || ch === '}' || ch === ')') ) depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())

  for (const part of parts) {
    if (!part) continue
    // Handle destructured params like { a, b }: Type
    const destructured = part.match(/^\{[^}]+\}\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/)
    if (destructured) {
      params.push({
        name: part.split(/[=:]/).map(s => s.trim())[0],
        type: destructured[1]?.trim(),
        optional: !!destructured[2],
        defaultValue: destructured[2]?.trim(),
      })
      continue
    }
    // name?: Type = default
    const match = part.match(/^(\w+)(\?)?\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/)
    if (match) {
      params.push({
        name: match[1],
        type: match[3]?.trim(),
        optional: !!match[2] || !!match[4],
        defaultValue: match[4]?.trim(),
      })
    }
  }
  return params
}

// ── Reserved keywords ──────────────────
const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'class', 'const', 'enum', 'export', 'extends', 'import',
  'super', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield', 'null', 'undefined', 'true', 'false',
  'async', 'await', 'of', 'type', 'namespace', 'abstract', 'as', 'from',
])

// ── TS keyword descriptions for hover ──────────────────
const TS_KEYWORDS: Record<string, string> = {
  'string': 'Primitive type: represents text data.',
  'number': 'Primitive type: represents numeric values (integers and floats).',
  'boolean': 'Primitive type: represents true/false values.',
  'void': 'Type: indicates no return value.',
  'null': 'Primitive type: intentional absence of any value.',
  'undefined': 'Primitive type: variable declared but not assigned.',
  'any': 'Type: opt out of type checking. Any value is allowed.',
  'unknown': 'Type: type-safe counterpart of any. Must narrow before use.',
  'never': 'Type: represents values that never occur (e.g. function that always throws).',
  'object': 'Type: represents non-primitive values.',
  'Array': 'Built-in generic type: Array<T> or T[].',
  'Promise': 'Built-in generic type: Promise<T> represents an async result.',
  'Record': 'Utility type: Record<K, V> constructs an object type.',
  'Partial': 'Utility type: Partial<T> makes all properties optional.',
  'Required': 'Utility type: Required<T> makes all properties required.',
  'Readonly': 'Utility type: Readonly<T> makes all properties readonly.',
  'Pick': 'Utility type: Pick<T, K> picks a set of properties.',
  'Omit': 'Utility type: Omit<T, K> omits a set of properties.',
  'Exclude': 'Utility type: Exclude<T, U> excludes types assignable to U.',
  'Extract': 'Utility type: Extract<T, U> extracts types assignable to U.',
  'ReturnType': 'Utility type: ReturnType<T> extracts the return type of a function type.',
  'Parameters': 'Utility type: Parameters<T> extracts parameter types of a function type.',
  'useState': 'React Hook: returns [state, setState]. Manages component state.',
  'useEffect': 'React Hook: runs side effects after render. Cleanup via return function.',
  'useRef': 'React Hook: returns a mutable ref object that persists across renders.',
  'useCallback': 'React Hook: returns a memoized callback function.',
  'useMemo': 'React Hook: returns a memoized value. Recomputes only when dependencies change.',
  'useContext': 'React Hook: accepts a context object and returns the current context value.',
  'useReducer': 'React Hook: alternative to useState for complex state logic.',
  'async': 'Keyword: declares an asynchronous function that returns a Promise.',
  'await': 'Keyword: pauses async function execution until a Promise settles.',
  'interface': 'Keyword: declares a TypeScript interface (structural type).',
  'type': 'Keyword: declares a TypeScript type alias.',
  'enum': 'Keyword: declares a TypeScript enum (set of named constants).',
  'const': 'Keyword: declares a block-scoped constant binding.',
  'let': 'Keyword: declares a block-scoped variable binding.',
  'function': 'Keyword: declares a function.',
  'class': 'Keyword: declares a class.',
  'extends': 'Keyword: used in class/interface inheritance.',
  'implements': 'Keyword: used to implement an interface in a class.',
  'import': 'Keyword: imports bindings from another module.',
  'export': 'Keyword: exports bindings from a module.',
}

// ── Color preview regexes ──────────────────
const CSS_HEX_REGEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/
const CSS_RGBA_REGEX = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
const CSS_HSLA_REGEX = /hsla?\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*(?:,\s*([\d.]+))?\s*\)/
const HOVER_IMPORT_REGEX = /import\s+(?:\{[^}]*\}|[^{}]+)\s+from\s+['"](.+?)['"]/
// CSS named colors for hover preview
const CSS_NAMED_COLOR_REGEX = /(?:color|background|background-color|border-color|fill|stroke)\s*:\s*['"]?(\w+)['"]?/
const NAMED_COLORS: Record<string, string> = {
  red: '#FF0000', blue: '#0000FF', green: '#008000', yellow: '#FFFF00',
  orange: '#FFA500', purple: '#800080', white: '#FFFFFF', black: '#000000',
  pink: '#FFC0CB', cyan: '#00FFFF', magenta: '#FF00FF', gray: '#808080',
  grey: '#808080', lime: '#00FF00', navy: '#000080', teal: '#008080',
  maroon: '#800000', olive: '#808000', aqua: '#00FFFF', coral: '#FF7F50',
  salmon: '#FA8072', gold: '#FFD700', silver: '#C0C0C0', indigo: '#4B0082',
  violet: '#EE82EE', tomato: '#FF6347', crimson: '#DC143C', turquoise: '#40E0D0',
}

// ── Helper: resolve a model matching an import path ──────────────────
function resolveModelForImport(
  monaco: Monaco,
  importPath: string,
  currentModelUri: string,
  allModels: MonacoEditor.ITextModel[],
): MonacoEditor.ITextModel | null {
  const importPathNorm = importPath.replace(/^[.@/]+/, '').replace(/\.(tsx?|jsx?|js|ts)$/, '')
  // Direct match
  for (const otherModel of allModels) {
    const otherUri = otherModel.uri.toString()
    const uriNorm = otherUri.replace(/\.(tsx?|jsx?|js|ts)$/, '')
    if (uriNorm.includes(importPathNorm) || uriNorm.endsWith(importPathNorm)) {
      return otherModel
    }
  }
  // Barrel import: try index file
  for (const otherModel of allModels) {
    const otherUri = otherModel.uri.toString()
    const uriNorm = otherUri.replace(/\.(tsx?|jsx?|js|ts)$/, '')
    if (uriNorm.endsWith(importPathNorm + '/index') || uriNorm.includes(importPathNorm + '/index')) {
      return otherModel
    }
  }
  return null
}

// ── Helper: follow re-exports to find a symbol definition ──────────────────
interface CrossFileDefResult {
  model: MonacoEditor.ITextModel
  def: DefLocation
}

function findDefinitionAcrossModels(
  symbolName: string,
  monaco: Monaco,
  startModel: MonacoEditor.ITextModel,
  visited: Set<string> = new Set(),
): CrossFileDefResult | null {
  const uri = startModel.uri.toString()
  if (visited.has(uri)) return null
  visited.add(uri)

  const text = startModel.getValue()

  // Direct definition
  const def = findDefinitionInText(symbolName, text)
  if (def) return { model: startModel, def }

  // Follow re-exports
  const reExports = parseReExports(text)
  const allModels = monaco.editor.getModels()

  for (const re of reExports) {
    if (re.names === '*' || re.names.includes(symbolName)) {
      const targetModel = resolveModelForImport(monaco, re.sourcePath, uri, allModels)
      if (targetModel) {
        const result = findDefinitionAcrossModels(symbolName, monaco, targetModel, visited)
        if (result) return result
      }
    }
  }

  // Follow imports (the symbol might be imported and re-exported)
  const imports = parseImports(text)
  const imp = imports.find((i) => i.name === symbolName || i.alias === symbolName)
  if (imp) {
    const targetModel = resolveModelForImport(monaco, imp.path, uri, allModels)
    if (targetModel) {
      const result = findDefinitionAcrossModels(imp.name, monaco, targetModel, visited)
      if (result) return result
    }
  }

  return null
}

// ── Helper: hsl to hex for color preview ──────────────────
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Options for the hover provider's diagnostic section.
 */
export interface LanguageProviderOptions {
  /** Returns the currently active file path so diagnostics can be matched. */
  getActiveFilePath?: () => string | null
  /** Returns problems from the problems store for quick-fix hints. */
  getProblems?: () => Array<{ file: string; line: number; message: string; quickFix?: string }>
}

/**
 * Register all enhanced language providers on the given Monaco instance.
 * Call this once during editor mount.
 */
export function registerLanguageProviders(
  monaco: Monaco,
  _editor: MonacoEditor.IStandaloneCodeEditor,
  options: LanguageProviderOptions = {},
): void {
  for (const lang of PROVIDER_LANGUAGES) {
    // ────────────────────────────────────────────────────────
    // 1. Definition provider (cross-file, re-exports, barrel imports, type defs)
    // ────────────────────────────────────────────────────────
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber)
        const word = model.getWordAtPosition(position)
        if (!word) return null
        const symbolName = word.word
        const fullText = model.getValue()
        const allImports = parseImports(fullText)
        const allModels = monaco.editor.getModels()

        // Cursor on an import path string -- resolve the file
        const importMatch = IMPORT_PATH_REGEX.exec(lineContent)
        if (importMatch) {
          const importPath = importMatch[1] || importMatch[2]
          if (importPath) {
            window.dispatchEvent(
              new CustomEvent('orion:open-file-from-import', {
                detail: { importPath, currentFile: model.uri.toString() },
              }),
            )
          }
          return {
            uri: model.uri,
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          }
        }

        // Symbol is imported -- follow the chain across models
        const importInfo = allImports.find((imp) => imp.name === symbolName || imp.alias === symbolName)
        if (importInfo) {
          const targetModel = resolveModelForImport(monaco, importInfo.path, model.uri.toString(), allModels)
          if (targetModel) {
            // Follow re-exports and barrel imports recursively
            const result = findDefinitionAcrossModels(
              importInfo.name,
              monaco,
              targetModel,
            )
            if (result) {
              return {
                uri: result.model.uri,
                range: new monaco.Range(result.def.lineNum, result.def.col, result.def.lineNum, result.def.endCol),
                originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              } as any
            }

            // Default import -- look for export default
            if (importInfo.isDefault) {
              const otherText = targetModel.getValue()
              const lines = otherText.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (/export\s+default\b/.test(lines[i])) {
                  return {
                    uri: targetModel.uri,
                    range: new monaco.Range(i + 1, 1, i + 1, lines[i].length + 1),
                    originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                  } as any
                }
              }
            }

            // Barrel import: check re-exports in the index file
            const reExports = parseReExports(targetModel.getValue())
            for (const re of reExports) {
              if (re.names === '*' || re.names.includes(importInfo.name)) {
                const innerModel = resolveModelForImport(monaco, re.sourcePath, targetModel.uri.toString(), allModels)
                if (innerModel) {
                  const innerResult = findDefinitionAcrossModels(importInfo.name, monaco, innerModel)
                  if (innerResult) {
                    return {
                      uri: innerResult.model.uri,
                      range: new monaco.Range(innerResult.def.lineNum, innerResult.def.col, innerResult.def.lineNum, innerResult.def.endCol),
                      originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                    } as any
                  }
                }
              }
            }
          }

          // Try all open models as fallback
          for (const otherModel of allModels) {
            if (otherModel === model) continue
            const otherUri = otherModel.uri.toString()
            const importPathNorm = importInfo.path.replace(/^[.@/]+/, '').replace(/\.(tsx?|jsx?|js|ts)$/, '')
            const uriNorm = otherUri.replace(/\.(tsx?|jsx?|js|ts)$/, '')
            if (uriNorm.includes(importPathNorm) || uriNorm.endsWith(importPathNorm)) {
              const otherText = otherModel.getValue()
              const def = findDefinitionInText(importInfo.name, otherText)
              if (def) {
                return {
                  uri: otherModel.uri,
                  range: new monaco.Range(def.lineNum, def.col, def.lineNum, def.endCol),
                  originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                } as any
              }
              if (importInfo.isDefault) {
                const lines = otherText.split('\n')
                for (let i = 0; i < lines.length; i++) {
                  if (/export\s+default\b/.test(lines[i])) {
                    return {
                      uri: otherModel.uri,
                      range: new monaco.Range(i + 1, 1, i + 1, lines[i].length + 1),
                      originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                    } as any
                  }
                }
              }
            }
          }

          // Fallback: dispatch open-file event
          window.dispatchEvent(
            new CustomEvent('orion:open-file-from-import', {
              detail: { importPath: importInfo.path, currentFile: model.uri.toString(), symbol: importInfo.name },
            }),
          )
          return {
            uri: model.uri,
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          }
        }

        // Same-file definition
        const def = findDefinitionInText(symbolName, fullText)
        if (def && (def.lineNum !== position.lineNumber || def.col !== word.startColumn)) {
          return {
            uri: model.uri,
            range: new monaco.Range(def.lineNum, def.col, def.lineNum, def.endCol),
            originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          } as any
        }

        // Type definition navigation: look for type/interface with same name + Props/State/Type suffix
        const typeDefNames = [symbolName, symbolName + 'Props', symbolName + 'State', symbolName + 'Type']
        for (const typeName of typeDefNames) {
          if (typeName === symbolName) continue
          const typeDef = findDefinitionInText(typeName, fullText)
          if (typeDef) {
            return {
              uri: model.uri,
              range: new monaco.Range(typeDef.lineNum, typeDef.col, typeDef.lineNum, typeDef.endCol),
              originSelectionRange: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            } as any
          }
        }

        return null
      },
    })

    // ────────────────────────────────────────────────────────
    // 1b. Type definition provider
    // ────────────────────────────────────────────────────────
    monaco.languages.registerTypeDefinitionProvider(lang, {
      provideTypeDefinition: (model, position) => {
        const word = model.getWordAtPosition(position)
        if (!word) return null
        const symbolName = word.word
        const fullText = model.getValue()
        const allModels = monaco.editor.getModels()

        // Look for the type annotation of this symbol
        const lines = fullText.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          // const x: SomeType or let x: SomeType
          const typeAnnotation = lines[i].match(new RegExp(`(?:const|let|var)\\s+${escaped}\\s*:\\s*(\\w+)`))
          if (typeAnnotation) {
            const typeName = typeAnnotation[1]
            // Find the type definition
            const typeDef = findDefinitionInText(typeName, fullText)
            if (typeDef) {
              return {
                uri: model.uri,
                range: new monaco.Range(typeDef.lineNum, typeDef.col, typeDef.lineNum, typeDef.endCol),
              }
            }
            // Look in other models
            for (const otherModel of allModels) {
              if (otherModel === model) continue
              const otherDef = findDefinitionInText(typeName, otherModel.getValue())
              if (otherDef) {
                return {
                  uri: otherModel.uri,
                  range: new monaco.Range(otherDef.lineNum, otherDef.col, otherDef.lineNum, otherDef.endCol),
                }
              }
            }
          }
          // function param: (param: SomeType)
          const paramType = lines[i].match(new RegExp(`${escaped}\\s*[?]?\\s*:\\s*(\\w+)`))
          if (paramType && i === position.lineNumber - 1) {
            const typeName = paramType[1]
            const typeDef = findDefinitionInText(typeName, fullText)
            if (typeDef) {
              return {
                uri: model.uri,
                range: new monaco.Range(typeDef.lineNum, typeDef.col, typeDef.lineNum, typeDef.endCol),
              }
            }
            for (const otherModel of allModels) {
              if (otherModel === model) continue
              const otherDef = findDefinitionInText(typeName, otherModel.getValue())
              if (otherDef) {
                return {
                  uri: otherModel.uri,
                  range: new monaco.Range(otherDef.lineNum, otherDef.col, otherDef.lineNum, otherDef.endCol),
                }
              }
            }
          }
        }

        // Direct type/interface lookup
        const typeDef = findDefinitionInText(symbolName, fullText)
        if (typeDef) {
          const defLine = lines[typeDef.lineNum - 1]
          if (/\b(?:interface|type)\b/.test(defLine)) {
            return {
              uri: model.uri,
              range: new monaco.Range(typeDef.lineNum, typeDef.col, typeDef.lineNum, typeDef.endCol),
            }
          }
        }

        return null
      },
    })

    // ────────────────────────────────────────────────────────
    // 2. Reference provider (cross-file, with highlights & count)
    // ────────────────────────────────────────────────────────
    monaco.languages.registerReferenceProvider(lang, {
      provideReferences: (model, position, _context) => {
        const word = model.getWordAtPosition(position)
        if (!word) return []
        const symbolName = word.word
        const results: Array<{ uri: any; range: any }> = []

        // Current file
        for (const occ of findAllOccurrences(symbolName, model.getValue())) {
          results.push({
            uri: model.uri,
            range: new monaco.Range(occ.lineNum, occ.col, occ.lineNum, occ.endCol),
          })
        }

        // Other open models -- find all references across files
        for (const otherModel of monaco.editor.getModels()) {
          if (otherModel === model) continue
          for (const occ of findAllOccurrences(symbolName, otherModel.getValue())) {
            results.push({
              uri: otherModel.uri,
              range: new monaco.Range(occ.lineNum, occ.col, occ.lineNum, occ.endCol),
            })
          }
        }

        // Emit reference count event for status bar or other consumers
        window.dispatchEvent(
          new CustomEvent('orion:reference-count', {
            detail: {
              symbol: symbolName,
              totalCount: results.length,
              fileCount: new Set(results.map((r) => r.uri.toString())).size,
              currentFileCount: findAllOccurrences(symbolName, model.getValue()).length,
            },
          }),
        )

        return results
      },
    })

    // ────────────────────────────────────────────────────────
    // 2b. Document highlight provider (highlight references in current file)
    // ────────────────────────────────────────────────────────
    monaco.languages.registerDocumentHighlightProvider(lang, {
      provideDocumentHighlights: (model, position) => {
        const word = model.getWordAtPosition(position)
        if (!word) return []
        const symbolName = word.word
        if (JS_KEYWORDS.has(symbolName)) return []

        const fullText = model.getValue()
        const occurrences = findAllOccurrences(symbolName, fullText)
        const def = findDefinitionInText(symbolName, fullText)

        return occurrences.map((occ) => ({
          range: new monaco.Range(occ.lineNum, occ.col, occ.lineNum, occ.endCol),
          // Write occurrences are at the definition site; read occurrences elsewhere
          kind: def && occ.lineNum === def.lineNum && occ.col === def.col
            ? monaco.languages.DocumentHighlightKind.Write
            : monaco.languages.DocumentHighlightKind.Read,
        }))
      },
    })

    // ────────────────────────────────────────────────────────
    // 3. Hover provider (signatures, JSDoc, types, imports, colors)
    // ────────────────────────────────────────────────────────
    monaco.languages.registerHoverProvider(lang, {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position)
        const lineContent = model.getLineContent(position.lineNumber)

        // --- Diagnostic hover: show rich tooltip for errors/warnings ---
        const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: 'orion' })
        const hitMarkers = markers.filter(
          (m) =>
            m.startLineNumber <= position.lineNumber &&
            m.endLineNumber >= position.lineNumber &&
            (m.startLineNumber < position.lineNumber || m.startColumn <= position.column) &&
            (m.endLineNumber > position.lineNumber || m.endColumn >= position.column),
        )
        if (hitMarkers.length > 0) {
          const contents: { value: string }[] = []
          for (const marker of hitMarkers) {
            const sevIcon =
              marker.severity === monaco.MarkerSeverity.Error
                ? '\u26D4'
                : marker.severity === monaco.MarkerSeverity.Warning
                  ? '\u26A0\uFE0F'
                  : '\u2139\uFE0F'
            const sevLabel =
              marker.severity === monaco.MarkerSeverity.Error
                ? 'Error'
                : marker.severity === monaco.MarkerSeverity.Warning
                  ? 'Warning'
                  : 'Info'
            contents.push({ value: `${sevIcon} **${sevLabel}**: ${marker.message}` })
            if (marker.source) {
              contents.push({ value: `_Source: ${marker.source}_` })
            }
            // Quick fix hint from problems store
            if (options.getProblems && options.getActiveFilePath) {
              const storeProblems = options.getProblems()
              const activeFile = options.getActiveFilePath()
              const matchingProblem = storeProblems.find(
                (p) => p.file === activeFile && p.line === marker.startLineNumber && p.message === marker.message,
              )
              if (matchingProblem?.quickFix) {
                contents.push({ value: `\u{1F527} **Quick Fix**: ${matchingProblem.quickFix}` })
              }
            }
            contents.push({ value: `\u{1F916} [Fix with AI](command:orion-fix-with-ai)` })
          }
          const firstMarker = hitMarkers[0]
          return {
            range: new monaco.Range(firstMarker.startLineNumber, firstMarker.startColumn, firstMarker.endLineNumber, firstMarker.endColumn),
            contents,
          }
        }

        // --- Color previews: hex ---
        const hexMatch = CSS_HEX_REGEX.exec(lineContent)
        if (hexMatch) {
          const startCol = hexMatch.index + 1
          const endCol = startCol + hexMatch[0].length
          if (position.column >= startCol && position.column <= endCol) {
            const hex = hexMatch[0]
            // Expand 3-char hex to 6-char for display
            let expandedHex = hex
            if (hex.length === 4) {
              expandedHex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
            }
            return {
              range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
              contents: [
                { value: '**Color Preview**' },
                { value: `\`${hex}\` ${expandedHex !== hex ? `(\`${expandedHex}\`)` : ''}\n\n\u2588\u2588\u2588\u2588 \`${hex}\`` },
              ],
            }
          }
        }

        // --- Color previews: rgba ---
        const rgbaMatch = CSS_RGBA_REGEX.exec(lineContent)
        if (rgbaMatch) {
          const startCol = rgbaMatch.index + 1
          const endCol = startCol + rgbaMatch[0].length
          if (position.column >= startCol && position.column <= endCol) {
            const r = parseInt(rgbaMatch[1]), g = parseInt(rgbaMatch[2]), b = parseInt(rgbaMatch[3])
            const hexEquiv = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
            return {
              range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
              contents: [
                { value: '**Color Preview**' },
                { value: `\`${rgbaMatch[0]}\`\n\nR: ${rgbaMatch[1]} G: ${rgbaMatch[2]} B: ${rgbaMatch[3]} A: ${rgbaMatch[4] || '1'}\n\nHex: \`${hexEquiv}\`\n\n\u2588\u2588\u2588\u2588` },
              ],
            }
          }
        }

        // --- Color previews: hsla ---
        const hslaMatch = CSS_HSLA_REGEX.exec(lineContent)
        if (hslaMatch) {
          const startCol = hslaMatch.index + 1
          const endCol = startCol + hslaMatch[0].length
          if (position.column >= startCol && position.column <= endCol) {
            const h = parseInt(hslaMatch[1]), s = parseInt(hslaMatch[2]), l = parseInt(hslaMatch[3])
            const hexEquiv = hslToHex(h, s, l)
            return {
              range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
              contents: [
                { value: '**Color Preview**' },
                { value: `\`${hslaMatch[0]}\`\n\nH: ${hslaMatch[1]} S: ${hslaMatch[2]}% L: ${hslaMatch[3]}% A: ${hslaMatch[4] || '1'}\n\nHex: \`${hexEquiv}\`\n\n\u2588\u2588\u2588\u2588` },
              ],
            }
          }
        }

        // --- Color previews: named colors in CSS-in-JS ---
        const namedColorMatch = CSS_NAMED_COLOR_REGEX.exec(lineContent)
        if (namedColorMatch) {
          const colorName = namedColorMatch[1].toLowerCase()
          const hexValue = NAMED_COLORS[colorName]
          if (hexValue) {
            const nameStart = lineContent.indexOf(namedColorMatch[1], namedColorMatch.index)
            const startCol = nameStart + 1
            const endCol = startCol + namedColorMatch[1].length
            if (position.column >= startCol && position.column <= endCol) {
              return {
                range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
                contents: [
                  { value: '**Color Preview**' },
                  { value: `\`${namedColorMatch[1]}\` = \`${hexValue}\`\n\n\u2588\u2588\u2588\u2588` },
                ],
              }
            }
          }
        }

        if (!word) return null

        // --- Import path hover with source info ---
        const importMatch = HOVER_IMPORT_REGEX.exec(lineContent)
        if (importMatch) {
          const importPath = importMatch[1]
          const braceStart = lineContent.indexOf('{')
          const braceEnd = lineContent.indexOf('}')
          if (braceStart !== -1 && braceEnd !== -1 && position.column > braceStart && position.column <= braceEnd + 1) {
            const hoverContents: { value: string }[] = [
              { value: `**\`${word.word}\`**` },
              { value: `Imported from \`${importPath}\`` },
            ]
            // Try to find signature in the source model
            const allModels = monaco.editor.getModels()
            const targetModel = resolveModelForImport(monaco, importPath, model.uri.toString(), allModels)
            if (targetModel) {
              const result = findDefinitionAcrossModels(word.word, monaco, targetModel)
              if (result) {
                const otherLines = result.model.getValue().split('\n')
                const sig = extractSignature(otherLines, result.def.lineNum - 1)
                if (sig) hoverContents.splice(1, 0, { value: '```typescript\n' + sig + '\n```' })
                const jsdoc = extractJSDocFormatted(otherLines, result.def.lineNum - 1)
                if (jsdoc) hoverContents.push({ value: jsdoc })
              }
            }
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: hoverContents,
            }
          }
          const defaultImportMatch = lineContent.match(/import\s+(\w+)\s+from/)
          if (defaultImportMatch && defaultImportMatch[1] === word.word) {
            const hoverContents: { value: string }[] = [
              { value: `**\`${word.word}\`** (default import)` },
              { value: `Imported from \`${importPath}\`` },
            ]
            const allModels = monaco.editor.getModels()
            const targetModel = resolveModelForImport(monaco, importPath, model.uri.toString(), allModels)
            if (targetModel) {
              const result = findDefinitionAcrossModels(word.word, monaco, targetModel)
              if (result) {
                const otherLines = result.model.getValue().split('\n')
                const sig = extractSignature(otherLines, result.def.lineNum - 1)
                if (sig) hoverContents.splice(1, 0, { value: '```typescript\n' + sig + '\n```' })
              }
            }
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: hoverContents,
            }
          }
        }

        // --- Keyword hints ---
        if (TS_KEYWORDS[word.word]) {
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [{ value: `**\`${word.word}\`**` }, { value: TS_KEYWORDS[word.word] }],
          }
        }

        // --- Enhanced hover: signature + formatted JSDoc + parameter info + type info ---
        const fullText = model.getValue()
        const allLines = fullText.split('\n')
        const def = findDefinitionInText(word.word, fullText)
        if (def) {
          const contents: Array<{ value: string }> = []
          const sig = extractSignature(allLines, def.lineNum - 1)
          if (sig) contents.push({ value: '```typescript\n' + sig + '\n```' })

          // Parameter info for functions
          const paramInfos = extractParameterInfo(allLines, def.lineNum - 1)
          if (paramInfos.length > 0) {
            const paramLines = paramInfos.map((p) => {
              let s = `- \`${p.name}\``
              if (p.type) s += `: \`${p.type}\``
              if (p.optional) s += ' *(optional)*'
              if (p.defaultValue) s += ` = \`${p.defaultValue}\``
              return s
            })
            contents.push({ value: '**Parameters:**\n' + paramLines.join('\n') })
          }

          // Formatted JSDoc
          const jsdoc = extractJSDocFormatted(allLines, def.lineNum - 1)
          if (jsdoc) contents.push({ value: jsdoc })

          // Import source path
          const allImports = parseImports(fullText)
          const impInfo = allImports.find((imp) => imp.name === word.word || imp.alias === word.word)
          if (impInfo) contents.push({ value: `*Imported from \`${impInfo.path}\`*` })

          // Reference count in current file
          const refCount = findAllOccurrences(word.word, fullText).length
          if (refCount > 1) contents.push({ value: `*${refCount} references in this file*` })

          if (contents.length > 0) {
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents,
            }
          }
        }

        // --- Imported symbol hover: look up definition in other models ---
        const importLineRegex = new RegExp(
          `import\\s+(?:\\{[^}]*\\b${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}|${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+from\\s+['"](.+?)['"]`,
        )
        const fileImportMatch = importLineRegex.exec(fullText)
        if (fileImportMatch) {
          const contents: Array<{ value: string }> = [
            { value: `**\`${word.word}\`**` },
            { value: `*Imported from \`${fileImportMatch[1]}\`*` },
          ]
          // Try to find richer info across models following re-exports
          const allModels = monaco.editor.getModels()
          const targetModel = resolveModelForImport(monaco, fileImportMatch[1], model.uri.toString(), allModels)
          if (targetModel) {
            const crossResult = findDefinitionAcrossModels(word.word, monaco, targetModel)
            if (crossResult) {
              const otherLines = crossResult.model.getValue().split('\n')
              const sig = extractSignature(otherLines, crossResult.def.lineNum - 1)
              if (sig) contents.splice(1, 0, { value: '```typescript\n' + sig + '\n```' })
              const jsdoc = extractJSDocFormatted(otherLines, crossResult.def.lineNum - 1)
              if (jsdoc) contents.splice(sig ? 2 : 1, 0, { value: jsdoc })
              // Parameter info
              const paramInfos = extractParameterInfo(otherLines, crossResult.def.lineNum - 1)
              if (paramInfos.length > 0) {
                const paramLines = paramInfos.map((p) => {
                  let s = `- \`${p.name}\``
                  if (p.type) s += `: \`${p.type}\``
                  if (p.optional) s += ' *(optional)*'
                  if (p.defaultValue) s += ` = \`${p.defaultValue}\``
                  return s
                })
                const insertIdx = sig ? 2 : 1
                contents.splice(insertIdx, 0, { value: '**Parameters:**\n' + paramLines.join('\n') })
              }
            }
          } else {
            // Fallback: search all open models
            for (const otherModel of allModels) {
              if (otherModel === model) continue
              const otherText = otherModel.getValue()
              const otherDef = findDefinitionInText(word.word, otherText)
              if (otherDef) {
                const otherLines = otherText.split('\n')
                const sig = extractSignature(otherLines, otherDef.lineNum - 1)
                if (sig) contents.splice(1, 0, { value: '```typescript\n' + sig + '\n```' })
                const jsdoc = extractJSDocFormatted(otherLines, otherDef.lineNum - 1)
                if (jsdoc) contents.splice(sig ? 2 : 1, 0, { value: jsdoc })
                break
              }
            }
          }

          // Cross-file reference count
          let totalRefs = 0
          for (const m of allModels) {
            totalRefs += findAllOccurrences(word.word, m.getValue()).length
          }
          if (totalRefs > 0) contents.push({ value: `*${totalRefs} references across ${allModels.length} open files*` })

          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents,
          }
        }

        // --- Variable with inferred type on same line (not a definition, but hover on usage) ---
        if (!def) {
          // Check if this word appears as a variable in current scope
          const currentLine = allLines[position.lineNumber - 1]
          const varUsage = currentLine.match(new RegExp(`\\b${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`))
          if (varUsage) {
            // Search backwards for a declaration
            for (let i = position.lineNumber - 1; i >= 0; i--) {
              const varDecl = allLines[i].match(new RegExp(`(?:const|let|var)\\s+${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?::\\s*([^=]+?))?\\s*=`))
              if (varDecl) {
                const sig = extractSignature(allLines, i)
                if (sig) {
                  return {
                    range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                    contents: [{ value: '```typescript\n' + sig + '\n```' }],
                  }
                }
                break
              }
            }
          }
        }

        return null
      },
    })

    // ────────────────────────────────────────────────────────
    // 4. Document symbol provider (Ctrl+Shift+O, breadcrumbs)
    //    Detects: React components, hooks, styled-components,
    //    Zustand stores, class methods, object properties
    // ────────────────────────────────────────────────────────
    monaco.languages.registerDocumentSymbolProvider(lang, {
      provideDocumentSymbols: (model) => {
        const symbols: Array<{
          name: string
          detail: string
          kind: any
          range: any
          selectionRange: any
          tags: any[]
          children?: any[]
        }> = []
        const text = model.getValue()
        const lines = text.split('\n')
        const SK = monaco.languages.SymbolKind

        // ── Detect React function components ──────────────────
        // Pattern: const Foo = (props) => { return <... } or function Foo(props) { return <...
        // Also: const Foo: React.FC<Props> = ...
        const isReactComponent = (name: string, lineIdx: number): boolean => {
          // Name starts with uppercase (React component convention)
          if (!/^[A-Z]/.test(name)) return false
          // Check for JSX return in next ~50 lines
          let braceDepth = 0
          let foundOpen = false
          for (let j = lineIdx; j < Math.min(lineIdx + 50, lines.length); j++) {
            for (const ch of lines[j]) {
              if (ch === '{') { braceDepth++; foundOpen = true }
              else if (ch === '}') braceDepth--
            }
            if (/return\s*\(?\s*</.test(lines[j]) || /=>\s*\(?\s*</.test(lines[j])) return true
            if (foundOpen && braceDepth <= 0) break
          }
          // Check for React.FC or FC type annotation on the definition line
          if (/(?:React\.)?(?:FC|FunctionComponent|ComponentType)/.test(lines[lineIdx])) return true
          return false
        }

        // ── Detect React class components ──────────────────
        const isReactClassComponent = (lineIdx: number): boolean => {
          const line = lines[lineIdx]
          return /extends\s+(?:React\.)?(?:Component|PureComponent)\b/.test(line)
        }

        // ── Main patterns ──────────────────
        const patterns: Array<{ regex: RegExp; kind: any; detail: string; getKind?: (name: string, lineIdx: number) => { kind: any; detail: string } }> = [
          {
            regex: /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)/,
            kind: SK.Function,
            detail: 'function',
            getKind: (name, lineIdx) => {
              if (/^use[A-Z]/.test(name)) return { kind: SK.Event, detail: 'hook' }
              if (isReactComponent(name, lineIdx)) return { kind: SK.Class, detail: 'React component' }
              return { kind: SK.Function, detail: 'function' }
            },
          },
          {
            regex: /(?:export\s+(?:default\s+)?)?class\s+(\w+)/,
            kind: SK.Class,
            detail: 'class',
            getKind: (_name, lineIdx) => {
              if (isReactClassComponent(lineIdx)) return { kind: SK.Class, detail: 'React class component' }
              return { kind: SK.Class, detail: 'class' }
            },
          },
          { regex: /(?:export\s+)?interface\s+(\w+)/, kind: SK.Interface, detail: 'interface' },
          { regex: /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/, kind: SK.TypeParameter, detail: 'type' },
          { regex: /(?:export\s+)?enum\s+(\w+)/, kind: SK.Enum, detail: 'enum' },
          {
            regex: /(?:export\s+(?:default\s+)?)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>)/,
            kind: SK.Function,
            detail: 'arrow function',
            getKind: (name, lineIdx) => {
              if (/^use[A-Z]/.test(name)) return { kind: SK.Event, detail: 'hook' }
              if (isReactComponent(name, lineIdx)) return { kind: SK.Class, detail: 'React component' }
              // Styled-components: const Foo = styled.div`...` or styled(Component)`...`
              if (/=\s*styled[.(]/.test(lines[lineIdx])) return { kind: SK.Class, detail: 'styled-component' }
              return { kind: SK.Function, detail: 'arrow function' }
            },
          },
          {
            regex: /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=(?!\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>))/,
            kind: SK.Variable,
            detail: 'variable',
            getKind: (name, lineIdx) => {
              const line = lines[lineIdx]
              // Styled-components
              if (/=\s*styled[.(]/.test(line)) return { kind: SK.Class, detail: 'styled-component' }
              // Zustand store: const useStore = create(...)
              if (/=\s*create\s*[(<]/.test(line) && /^use[A-Z]/.test(name)) return { kind: SK.Module, detail: 'Zustand store' }
              // createSlice, createStore patterns
              if (/=\s*(?:createSlice|createStore|defineStore)\s*\(/.test(line)) return { kind: SK.Module, detail: 'store' }
              return { kind: SK.Variable, detail: 'variable' }
            },
          },
        ]

        // Track class/interface/enum ranges for nesting children
        const containerStack: Array<{ symbolIdx: number; endLine: number }> = []

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue

          // ── Check for styled-components: const Foo = styled.xxx or styled(xxx)
          const styledMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*styled[.(]/)
          if (styledMatch) {
            const name = styledMatch[1]
            const nameIdx = line.indexOf(name, styledMatch.index)
            const lineNum = i + 1
            // Find end of template literal
            let endLine = lineNum
            let foundBacktick = false
            for (let j = i; j < lines.length; j++) {
              if (lines[j].includes('`')) {
                if (foundBacktick) { endLine = j + 1; break }
                foundBacktick = true
              }
            }
            symbols.push({
              name,
              detail: 'styled-component',
              kind: SK.Class,
              tags: [],
              range: new monaco.Range(lineNum, 1, endLine, (lines[endLine - 1]?.length || 0) + 1),
              selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 1 + name.length),
            })
            continue
          }

          // ── Check for Zustand/store patterns not caught by main patterns
          const zustandMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*create\s*[(<]/)
          if (zustandMatch && /^use[A-Z]/.test(zustandMatch[1])) {
            // Already handled by main pattern getKind, skip to avoid double
          }

          for (const pat of patterns) {
            const match = pat.regex.exec(line)
            if (match && match[1]) {
              const name = match[1]
              const nameIdx = line.indexOf(name, match.index)
              const lineNum = i + 1

              // Determine kind
              const kindInfo = pat.getKind ? pat.getKind(name, i) : { kind: pat.kind, detail: pat.detail }

              // For container types, find the closing brace
              let endLine = lineNum
              if (kindInfo.kind === SK.Class || pat.kind === SK.Interface || pat.kind === SK.Enum ||
                  kindInfo.detail === 'React class component' || kindInfo.detail === 'React component') {
                let braceDepth = 0
                let foundOpen = false
                for (let j = i; j < lines.length; j++) {
                  for (const ch of lines[j]) {
                    if (ch === '{') {
                      braceDepth++
                      foundOpen = true
                    } else if (ch === '}') braceDepth--
                  }
                  if (foundOpen && braceDepth <= 0) {
                    endLine = j + 1
                    break
                  }
                }
              }

              const symbol = {
                name,
                detail: kindInfo.detail,
                kind: kindInfo.kind,
                tags: [] as any[],
                range: new monaco.Range(lineNum, 1, endLine, (lines[endLine - 1]?.length || 0) + 1),
                selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 1 + name.length),
                children: [] as any[],
              }

              // ── Detect children for classes, interfaces, enums ──────────────────
              if (pat.kind === SK.Class || pat.kind === SK.Interface || pat.kind === SK.Enum) {
                const children = extractContainerChildren(lines, i, endLine - 1, monaco, SK)
                if (children.length > 0) symbol.children = children
              }

              symbols.push(symbol)
              break // first matching pattern wins per line
            }
          }
        }

        return symbols
      },
    })

    // ────────────────────────────────────────────────────────
    // 5. Rename provider (cross-file, preview, import updates)
    // ────────────────────────────────────────────────────────
    monaco.languages.registerRenameProvider(lang, {
      provideRenameEdits: (model, position, newName) => {
        const word = model.getWordAtPosition(position)
        if (!word) return { edits: [] }

        // Validate
        if (!newName || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newName)) {
          return {
            rejectReason: 'Invalid identifier: must start with a letter, underscore, or $ and contain only alphanumeric characters.',
            edits: [],
          }
        }
        if (JS_KEYWORDS.has(newName)) {
          return {
            rejectReason: `"${newName}" is a reserved keyword and cannot be used as an identifier.`,
            edits: [],
          }
        }

        const symbolName = word.word
        const fullText = model.getValue()
        const edits: Array<{ resource: any; versionId: undefined; textEdit: { range: any; text: string } }> = []

        // Determine if this symbol is exported (to update imports in other files)
        const isExported = isSymbolExported(symbolName, fullText)

        // Current file occurrences
        const occurrences = findAllOccurrences(symbolName, fullText)
        for (const occ of occurrences) {
          edits.push({
            resource: model.uri,
            versionId: undefined,
            textEdit: {
              range: new monaco.Range(occ.lineNum, occ.col, occ.lineNum, occ.endCol),
              text: newName,
            },
          })
        }

        // Cross-file rename: rename in all other open models
        for (const otherModel of monaco.editor.getModels()) {
          if (otherModel === model) continue
          const otherText = otherModel.getValue()
          const otherOccurrences = findAllOccurrences(symbolName, otherText)

          for (const occ of otherOccurrences) {
            edits.push({
              resource: otherModel.uri,
              versionId: undefined,
              textEdit: {
                range: new monaco.Range(occ.lineNum, occ.col, occ.lineNum, occ.endCol),
                text: newName,
              },
            })
          }

          // Update import statements specifically
          if (isExported) {
            const otherLines = otherText.split('\n')
            for (let i = 0; i < otherLines.length; i++) {
              const line = otherLines[i]
              // Named import: import { oldName } from '...'
              // Handle alias: import { oldName as alias } -- rename oldName but keep alias
              const namedImportRegex = new RegExp(`\\{[^}]*\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}`)
              if (namedImportRegex.test(line) && /from\s+['"]/.test(line)) {
                // The word-boundary occurrence is already handled above,
                // but we need to handle `import { old as alias }` -> `import { new as alias }`
                const asPattern = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+as\\s+`)
                if (asPattern.test(line)) {
                  // Already covered by findAllOccurrences for the original name
                  // The alias stays the same
                }
              }
              // Default import: import OldName from '...'
              const defaultImportRegex = new RegExp(`import\\s+${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+from\\s+['"]`)
              if (defaultImportRegex.test(line)) {
                // Already covered by findAllOccurrences
              }
            }
          }
        }

        // Emit preview event so the UI can show changes before applying
        const fileChanges: Record<string, number> = {}
        for (const edit of edits) {
          const uri = edit.resource.toString()
          fileChanges[uri] = (fileChanges[uri] || 0) + 1
        }
        window.dispatchEvent(
          new CustomEvent('orion:rename-preview', {
            detail: {
              oldName: symbolName,
              newName,
              totalEdits: edits.length,
              fileCount: Object.keys(fileChanges).length,
              fileChanges,
            },
          }),
        )

        return { edits }
      },
      resolveRenameLocation: (model, position) => {
        const word = model.getWordAtPosition(position)
        if (!word) {
          return {
            rejectReason: 'No symbol found at this position.',
            range: new monaco.Range(1, 1, 1, 1),
            text: '',
          }
        }
        if (JS_KEYWORDS.has(word.word)) {
          return {
            rejectReason: `Cannot rename keyword "${word.word}".`,
            range: new monaco.Range(1, 1, 1, 1),
            text: '',
          }
        }

        // Show a preview of how many references will be renamed
        const fullText = model.getValue()
        let totalRefs = findAllOccurrences(word.word, fullText).length
        let fileCount = 1
        for (const otherModel of monaco.editor.getModels()) {
          if (otherModel === model) continue
          const otherRefs = findAllOccurrences(word.word, otherModel.getValue()).length
          if (otherRefs > 0) {
            totalRefs += otherRefs
            fileCount++
          }
        }

        // Emit count for UI display
        window.dispatchEvent(
          new CustomEvent('orion:rename-prepare', {
            detail: {
              symbol: word.word,
              referenceCount: totalRefs,
              fileCount,
            },
          }),
        )

        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          text: word.word,
        }
      },
    })
  }
}

// ── Helper: Check if a symbol is exported ──────────────────
function isSymbolExported(symbolName: string, text: string): boolean {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // export const/let/var/function/class/interface/type/enum name
  if (new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${escaped}\\b`).test(text)) return true
  // export { name }
  if (new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(text)) return true
  // export default name
  if (new RegExp(`export\\s+default\\s+${escaped}\\b`).test(text)) return true
  return false
}

// ── Helper: Extract children (methods, properties) from class/interface/enum body ──────────
function extractContainerChildren(
  lines: string[],
  startLine: number,
  endLine: number,
  monaco: Monaco,
  SK: any,
): any[] {
  const children: any[] = []
  let braceDepth = 0
  let insideBody = false

  for (let j = startLine; j <= endLine && j < lines.length; j++) {
    const line = lines[j]
    for (const ch of line) {
      if (ch === '{') {
        braceDepth++
        if (!insideBody) insideBody = true
      }
      else if (ch === '}') braceDepth--
    }

    // Only look at top-level members (braceDepth === 1)
    if (!insideBody || braceDepth < 1) continue

    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '{' || trimmed === '}') continue

    // Class method: async? methodName(params): returnType
    const methodMatch = trimmed.match(/^(?:(?:public|private|protected|static|abstract|readonly|override|get|set)\s+)*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/)
    if (methodMatch && methodMatch[1] !== 'constructor' && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'while') {
      const name = methodMatch[1]
      const nameIdx = line.indexOf(name)
      const lineNum = j + 1
      children.push({
        name,
        detail: 'method',
        kind: SK.Method,
        range: new monaco.Range(lineNum, 1, lineNum, line.length + 1),
        selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 1 + name.length),
      })
      continue
    }

    // Constructor
    if (/^\s*constructor\s*\(/.test(line)) {
      const nameIdx = line.indexOf('constructor')
      const lineNum = j + 1
      children.push({
        name: 'constructor',
        detail: 'constructor',
        kind: SK.Constructor,
        range: new monaco.Range(lineNum, 1, lineNum, line.length + 1),
        selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 12),
      })
      continue
    }

    // Property/field: name: type or name = value or readonly name
    const propMatch = trimmed.match(/^(?:(?:public|private|protected|static|abstract|readonly|override)\s+)*(\w+)\s*[?]?\s*(?::\s*[^=;]+|=\s*[^;]+)?[;,]?\s*$/)
    if (propMatch && propMatch[1] && !['return', 'throw', 'break', 'continue', 'const', 'let', 'var', 'if', 'else', 'for', 'while'].includes(propMatch[1])) {
      const name = propMatch[1]
      const nameIdx = line.indexOf(name)
      const lineNum = j + 1
      children.push({
        name,
        detail: 'property',
        kind: SK.Property,
        range: new monaco.Range(lineNum, 1, lineNum, line.length + 1),
        selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 1 + name.length),
      })
      continue
    }

    // Enum member: NAME = value or NAME,
    const enumMatch = trimmed.match(/^(\w+)\s*(?:=\s*[^,]+)?\s*,?\s*$/)
    if (enumMatch && enumMatch[1] && braceDepth === 1) {
      const name = enumMatch[1]
      const nameIdx = line.indexOf(name)
      const lineNum = j + 1
      children.push({
        name,
        detail: 'enum member',
        kind: SK.EnumMember,
        range: new monaco.Range(lineNum, 1, lineNum, line.length + 1),
        selectionRange: new monaco.Range(lineNum, nameIdx + 1, lineNum, nameIdx + 1 + name.length),
      })
    }
  }

  return children
}
