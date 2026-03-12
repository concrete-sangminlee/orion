import { create } from 'zustand'

export interface Snippet {
  id: string
  name: string
  prefix: string
  body: string
  description: string
  language: string
  isBuiltin: boolean
}

/** VS Code snippet JSON format: Record<name, { prefix, body, description, scope? }> */
export interface VSCodeSnippetFormat {
  [name: string]: {
    prefix: string | string[]
    body: string | string[]
    description?: string
    scope?: string
  }
}

interface SnippetStore {
  snippets: Snippet[]
  userSnippets: Snippet[]
  createSnippet: (snippet: Omit<Snippet, 'id' | 'isBuiltin'>) => void
  updateSnippet: (id: string, changes: Partial<Omit<Snippet, 'id' | 'isBuiltin'>>) => void
  deleteSnippet: (id: string) => void
  getSnippetsForLanguage: (langId: string) => Snippet[]
  // Legacy compat
  addSnippet: (snippet: Omit<Snippet, 'id' | 'isBuiltin'>) => void
  removeSnippet: (id: string) => void
  importSnippets: (snippets: Array<Partial<Snippet> & { prefix: string; body: string }>) => void
  importVSCodeSnippets: (data: VSCodeSnippetFormat, defaultLanguage?: string) => number
  exportSnippets: () => Snippet[]
  exportVSCodeFormat: () => VSCodeSnippetFormat
  insertSnippetAtCursor: (snippet: Snippet) => void
}

let _nextId = 1
function genId(): string {
  return `snippet_${Date.now()}_${_nextId++}`
}

// ── Built-in snippets ────────────────────────────────────────────────

const BUILTIN_SNIPPETS: Snippet[] = [
  // ─── JavaScript ─────────────────────────────────────────────────────
  {
    id: 'builtin_js_if',
    name: 'If Statement',
    prefix: 'if',
    body: 'if (${1:condition}) {\n\t$0\n}',
    description: 'If statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_ife',
    name: 'If/Else Statement',
    prefix: 'ife',
    body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}',
    description: 'If/else block',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_for',
    name: 'For Loop',
    prefix: 'for',
    body: 'for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t$0\n}',
    description: 'For loop',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_forof',
    name: 'For...Of Loop',
    prefix: 'forof',
    body: 'for (const ${1:item} of ${2:iterable}) {\n\t$0\n}',
    description: 'For...of loop',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_forin',
    name: 'For...In Loop',
    prefix: 'forin',
    body: 'for (const ${1:key} in ${2:object}) {\n\tif (${2:object}.hasOwnProperty(${1:key})) {\n\t\t$0\n\t}\n}',
    description: 'For...in loop with hasOwnProperty check',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_fore',
    name: 'ForEach',
    prefix: 'forEach',
    body: '${1:array}.forEach((${2:item}) => {\n\t$0\n});',
    description: 'Array forEach',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_map',
    name: 'Array Map',
    prefix: 'map',
    body: '${1:array}.map((${2:item}) => {\n\t$0\n});',
    description: 'Array map',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_filter',
    name: 'Array Filter',
    prefix: 'filter',
    body: '${1:array}.filter((${2:item}) => {\n\t$0\n});',
    description: 'Array filter',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_reduce',
    name: 'Array Reduce',
    prefix: 'reduce',
    body: '${1:array}.reduce((${2:acc}, ${3:item}) => {\n\t$0\n\treturn ${2:acc};\n}, ${4:initialValue});',
    description: 'Array reduce',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_find',
    name: 'Array Find',
    prefix: 'find',
    body: '${1:array}.find((${2:item}) => ${0:condition});',
    description: 'Array find',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_switch',
    name: 'Switch Statement',
    prefix: 'switch',
    body: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t$3\n\t\tbreak;\n\tdefault:\n\t\t$0\n\t\tbreak;\n}',
    description: 'Switch statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_try',
    name: 'Try/Catch',
    prefix: 'trycatch',
    body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}',
    description: 'Try/catch block',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_tryf',
    name: 'Try/Catch/Finally',
    prefix: 'trycatchfinally',
    body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$3\n} finally {\n\t$0\n}',
    description: 'Try/catch/finally block',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_async',
    name: 'Async Function',
    prefix: 'async',
    body: 'async function ${1:name}(${2:params}) {\n\t$0\n}',
    description: 'Async function declaration',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_await',
    name: 'Await Expression',
    prefix: 'await',
    body: 'const ${1:result} = await ${2:promise};',
    description: 'Await expression',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_promise',
    name: 'Promise',
    prefix: 'promise',
    body: 'new Promise((resolve, reject) => {\n\t$0\n});',
    description: 'New Promise',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_promiseall',
    name: 'Promise.all',
    prefix: 'promiseall',
    body: 'const ${1:results} = await Promise.all([\n\t$0\n]);',
    description: 'Promise.all with await',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_class',
    name: 'Class',
    prefix: 'class',
    body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}',
    description: 'Class definition',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_imp',
    name: 'Import',
    prefix: 'import',
    body: "import { $2 } from '${1:module}';",
    description: 'Named import statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_impd',
    name: 'Import Default',
    prefix: 'importd',
    body: "import ${2:name} from '${1:module}';",
    description: 'Default import statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_impa',
    name: 'Import All',
    prefix: 'importall',
    body: "import * as ${2:name} from '${1:module}';",
    description: 'Import all as namespace',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_exp',
    name: 'Export',
    prefix: 'export',
    body: 'export ${1|default,|} $0;',
    description: 'Export statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_arrow',
    name: 'Arrow Function',
    prefix: 'arrow',
    body: 'const ${1:name} = (${2:params}) => {\n\t$0\n};',
    description: 'Arrow function',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_log',
    name: 'Console Log',
    prefix: 'log',
    body: 'console.log($1);',
    description: 'Console log statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_logv',
    name: 'Console Log Variable',
    prefix: 'logv',
    body: "console.log('${1:variable}:', ${1:variable});",
    description: 'Console log with variable name label',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_warn',
    name: 'Console Warn',
    prefix: 'warn',
    body: 'console.warn($1);',
    description: 'Console warn statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_err',
    name: 'Console Error',
    prefix: 'error',
    body: 'console.error($1);',
    description: 'Console error statement',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_timeout',
    name: 'Set Timeout',
    prefix: 'setTimeout',
    body: 'setTimeout(() => {\n\t$0\n}, ${1:1000});',
    description: 'setTimeout call',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_interval',
    name: 'Set Interval',
    prefix: 'setInterval',
    body: 'const ${1:intervalId} = setInterval(() => {\n\t$0\n}, ${2:1000});',
    description: 'setInterval call',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_fn',
    name: 'Function',
    prefix: 'fn',
    body: 'function ${1:name}(${2:params}) {\n\t$0\n}',
    description: 'Function declaration',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_destruct',
    name: 'Destructure Object',
    prefix: 'destruct',
    body: 'const { ${2:prop} } = ${1:object};',
    description: 'Object destructuring',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_ternary',
    name: 'Ternary Operator',
    prefix: 'ternary',
    body: '${1:condition} ? ${2:trueValue} : ${3:falseValue}',
    description: 'Ternary conditional expression',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_iife',
    name: 'IIFE',
    prefix: 'iife',
    body: '(function () {\n\t$0\n})();',
    description: 'Immediately Invoked Function Expression',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_js_fetch',
    name: 'Fetch Request',
    prefix: 'fetch',
    body: "const ${1:response} = await fetch('${2:url}', {\n\tmethod: '${3|GET,POST,PUT,DELETE|}',\n\theaders: {\n\t\t'Content-Type': 'application/json',\n\t},\n\t${4:body: JSON.stringify($5),}\n});\nconst ${6:data} = await ${1:response}.json();",
    description: 'Fetch API request with async/await',
    language: 'javascript',
    isBuiltin: true,
  },

  // ─── TypeScript ─────────────────────────────────────────────────────
  {
    id: 'builtin_ts_if',
    name: 'If Statement',
    prefix: 'if',
    body: 'if (${1:condition}) {\n\t$0\n}',
    description: 'If statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_ife',
    name: 'If/Else Statement',
    prefix: 'ife',
    body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}',
    description: 'If/else block',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_for',
    name: 'For Loop',
    prefix: 'for',
    body: 'for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t$0\n}',
    description: 'For loop',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_fore',
    name: 'ForEach',
    prefix: 'forEach',
    body: '${1:array}.forEach((${2:item}) => {\n\t$0\n});',
    description: 'Array forEach',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_map',
    name: 'Array Map',
    prefix: 'map',
    body: '${1:array}.map((${2:item}) => {\n\t$0\n});',
    description: 'Array map',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_filter',
    name: 'Array Filter',
    prefix: 'filter',
    body: '${1:array}.filter((${2:item}) => {\n\t$0\n});',
    description: 'Array filter',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_reduce',
    name: 'Array Reduce',
    prefix: 'reduce',
    body: '${1:array}.reduce((${2:acc}, ${3:item}) => {\n\t$0\n\treturn ${2:acc};\n}, ${4:initialValue});',
    description: 'Array reduce',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_switch',
    name: 'Switch Statement',
    prefix: 'switch',
    body: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t$3\n\t\tbreak;\n\tdefault:\n\t\t$0\n\t\tbreak;\n}',
    description: 'Switch statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_try',
    name: 'Try/Catch',
    prefix: 'trycatch',
    body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}',
    description: 'Try/catch block',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_async',
    name: 'Async Function',
    prefix: 'async',
    body: 'async function ${1:name}(${2:params}): Promise<${3:void}> {\n\t$0\n}',
    description: 'Async function declaration',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_await',
    name: 'Await Expression',
    prefix: 'await',
    body: 'const ${1:result} = await ${2:promise};',
    description: 'Await expression',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_promise',
    name: 'Promise',
    prefix: 'promise',
    body: 'new Promise<${1:void}>((resolve, reject) => {\n\t$0\n});',
    description: 'New Promise',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_class',
    name: 'Class',
    prefix: 'class',
    body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}',
    description: 'Class definition',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_iface',
    name: 'Interface',
    prefix: 'interface',
    body: 'interface ${1:Name} {\n\t${2:property}: ${3:type};\n\t$0\n}',
    description: 'TypeScript interface',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_iface_ext',
    name: 'Interface Extends',
    prefix: 'interfaceext',
    body: 'interface ${1:Name} extends ${2:Base} {\n\t${3:property}: ${4:type};\n\t$0\n}',
    description: 'TypeScript interface extending another',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_type',
    name: 'Type Alias',
    prefix: 'type',
    body: 'type ${1:Name} = ${0:string};',
    description: 'TypeScript type alias',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_type_union',
    name: 'Union Type',
    prefix: 'typeunion',
    body: "type ${1:Name} = ${2:'a'} | ${3:'b'} | ${0:'c'};",
    description: 'TypeScript union type alias',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_enum',
    name: 'Enum',
    prefix: 'enum',
    body: 'enum ${1:Name} {\n\t${2:Value} = ${3:0},\n\t$0\n}',
    description: 'TypeScript enum',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_generic_fn',
    name: 'Generic Function',
    prefix: 'genfn',
    body: 'function ${1:name}<${2:T}>(${3:arg}: ${2:T}): ${4:T} {\n\t$0\n}',
    description: 'Generic function with type parameter',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_mapped_type',
    name: 'Mapped Type',
    prefix: 'mapped',
    body: 'type ${1:Name}<${2:T}> = {\n\t[K in keyof ${2:T}]: ${3:T[K]};\n};',
    description: 'TypeScript mapped type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_readonly',
    name: 'Readonly Type',
    prefix: 'readonly',
    body: 'type ${1:Name} = Readonly<${2:Type}>;',
    description: 'Readonly utility type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_partial',
    name: 'Partial Type',
    prefix: 'partial',
    body: 'type ${1:Name} = Partial<${2:Type}>;',
    description: 'Partial utility type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_pick',
    name: 'Pick Type',
    prefix: 'pick',
    body: "type ${1:Name} = Pick<${2:Type}, '${3:key}'>;",
    description: 'Pick utility type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_omit',
    name: 'Omit Type',
    prefix: 'omit',
    body: "type ${1:Name} = Omit<${2:Type}, '${3:key}'>;",
    description: 'Omit utility type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_imp',
    name: 'Import',
    prefix: 'import',
    body: "import { $2 } from '${1:module}';",
    description: 'Named import statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_impd',
    name: 'Import Default',
    prefix: 'importd',
    body: "import ${2:name} from '${1:module}';",
    description: 'Default import statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_impt',
    name: 'Import Type',
    prefix: 'importtype',
    body: "import type { $2 } from '${1:module}';",
    description: 'Type-only import statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_exp',
    name: 'Export',
    prefix: 'export',
    body: 'export ${1|default,|} $0;',
    description: 'Export statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_arrow',
    name: 'Arrow Function',
    prefix: 'arrow',
    body: 'const ${1:name} = (${2:params}): ${3:void} => {\n\t$0\n};',
    description: 'Typed arrow function',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_log',
    name: 'Console Log',
    prefix: 'log',
    body: 'console.log($1);',
    description: 'Console log statement',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_timeout',
    name: 'Set Timeout',
    prefix: 'setTimeout',
    body: 'setTimeout(() => {\n\t$0\n}, ${1:1000});',
    description: 'setTimeout call',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_interval',
    name: 'Set Interval',
    prefix: 'setInterval',
    body: 'const ${1:intervalId} = setInterval(() => {\n\t$0\n}, ${2:1000});',
    description: 'setInterval call',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_fn',
    name: 'Function',
    prefix: 'fn',
    body: 'function ${1:name}(${2:params}): ${3:void} {\n\t$0\n}',
    description: 'Typed function declaration',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_guard',
    name: 'Type Guard',
    prefix: 'typeguard',
    body: 'function is${1:Type}(${2:value}: unknown): ${2:value} is ${1:Type} {\n\treturn $0;\n}',
    description: 'TypeScript type guard function',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_ts_assertnever',
    name: 'Assert Never',
    prefix: 'assertnever',
    body: 'function assertNever(${1:value}: never): never {\n\tthrow new Error(`Unexpected value: ${${1:value}}`);\n}',
    description: 'Exhaustive check helper function',
    language: 'typescript',
    isBuiltin: true,
  },

  // ─── React (JavaScript) ────────────────────────────────────────────
  {
    id: 'builtin_react_usestate',
    name: 'useState Hook',
    prefix: 'useState',
    body: 'const [${1:state}, set${2:State}] = useState(${3:initialValue});',
    description: 'React useState hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_useeffect',
    name: 'useEffect Hook',
    prefix: 'useEffect',
    body: 'useEffect(() => {\n\t$1\n\n\treturn () => {\n\t\t$2\n\t};\n}, [${3:deps}]);',
    description: 'React useEffect hook with cleanup',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_usecallback',
    name: 'useCallback Hook',
    prefix: 'useCallback',
    body: 'const ${1:memoizedFn} = useCallback((${2:params}) => {\n\t$0\n}, [${3:deps}]);',
    description: 'React useCallback hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_usememo',
    name: 'useMemo Hook',
    prefix: 'useMemo',
    body: 'const ${1:memoizedValue} = useMemo(() => {\n\t$0\n}, [${2:deps}]);',
    description: 'React useMemo hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_useref',
    name: 'useRef Hook',
    prefix: 'useRef',
    body: 'const ${1:ref} = useRef(${2:null});',
    description: 'React useRef hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_usecontext',
    name: 'useContext Hook',
    prefix: 'useContext',
    body: 'const ${1:value} = useContext(${2:MyContext});',
    description: 'React useContext hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_usereducer',
    name: 'useReducer Hook',
    prefix: 'useReducer',
    body: 'const [${1:state}, ${2:dispatch}] = useReducer(${3:reducer}, ${4:initialState});',
    description: 'React useReducer hook',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_fc',
    name: 'Functional Component',
    prefix: 'rfc',
    body: "import React from 'react';\n\nexport default function ${1:Component}(${2:props}) {\n\treturn (\n\t\t<div>\n\t\t\t$0\n\t\t</div>\n\t);\n}",
    description: 'React functional component',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_cc',
    name: 'Class Component',
    prefix: 'rcc',
    body: "import React, { Component } from 'react';\n\nclass ${1:MyComponent} extends Component {\n\tstate = {\n\t\t$2\n\t};\n\n\trender() {\n\t\treturn (\n\t\t\t<div>\n\t\t\t\t$0\n\t\t\t</div>\n\t\t);\n\t}\n}\n\nexport default ${1:MyComponent};",
    description: 'React class component',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ctx',
    name: 'Create Context',
    prefix: 'createcontext',
    body: "const ${1:MyContext} = React.createContext(${2:defaultValue});\n\nexport function ${1:MyContext}Provider({ children }) {\n\tconst [${3:value}, set${4:Value}] = useState($5);\n\n\treturn (\n\t\t<${1:MyContext}.Provider value={{ ${3:value}, set${4:Value} }}>\n\t\t\t{children}\n\t\t</${1:MyContext}.Provider>\n\t);\n}",
    description: 'Create React context with provider',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_cn',
    name: 'className',
    prefix: 'cn',
    body: 'className="${1:class}"',
    description: 'JSX className attribute',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_cond',
    name: 'Conditional Render',
    prefix: 'condrender',
    body: '{${1:condition} && (\n\t$0\n)}',
    description: 'Conditional rendering in JSX',
    language: 'javascript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_maprender',
    name: 'Map Render List',
    prefix: 'maprender',
    body: '{${1:items}.map((${2:item}) => (\n\t<${3:div} key={${2:item}.${4:id}}>\n\t\t$0\n\t</${3:div}>\n))}',
    description: 'Map array to rendered list',
    language: 'javascript',
    isBuiltin: true,
  },

  // ─── React (TypeScript) ────────────────────────────────────────────
  {
    id: 'builtin_react_ts_usestate',
    name: 'useState Hook (TS)',
    prefix: 'useState',
    body: 'const [${1:state}, set${2:State}] = useState<${3:type}>(${4:initialValue});',
    description: 'React useState hook with type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_useeffect',
    name: 'useEffect Hook',
    prefix: 'useEffect',
    body: 'useEffect(() => {\n\t$1\n\n\treturn () => {\n\t\t$2\n\t};\n}, [${3:deps}]);',
    description: 'React useEffect hook with cleanup',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_usecallback',
    name: 'useCallback Hook',
    prefix: 'useCallback',
    body: 'const ${1:memoizedFn} = useCallback((${2:params}) => {\n\t$0\n}, [${3:deps}]);',
    description: 'React useCallback hook',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_usememo',
    name: 'useMemo Hook',
    prefix: 'useMemo',
    body: 'const ${1:memoizedValue} = useMemo(() => {\n\t$0\n}, [${2:deps}]);',
    description: 'React useMemo hook',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_useref',
    name: 'useRef Hook (TS)',
    prefix: 'useRef',
    body: 'const ${1:ref} = useRef<${2:HTMLDivElement}>(${3:null});',
    description: 'React useRef hook with type',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_usecontext',
    name: 'useContext Hook',
    prefix: 'useContext',
    body: 'const ${1:value} = useContext(${2:MyContext});',
    description: 'React useContext hook',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_fc',
    name: 'Functional Component (TS)',
    prefix: 'rfc',
    body: "interface ${1:Component}Props {\n\t$2\n}\n\nexport default function ${1:Component}({ $3 }: ${1:Component}Props) {\n\treturn (\n\t\t<div>\n\t\t\t$0\n\t\t</div>\n\t);\n}",
    description: 'React functional component with props interface',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_cc',
    name: 'Class Component (TS)',
    prefix: 'rcc',
    body: "import React, { Component } from 'react';\n\ninterface ${1:MyComponent}Props {\n\t$2\n}\n\ninterface ${1:MyComponent}State {\n\t$3\n}\n\nclass ${1:MyComponent} extends Component<${1:MyComponent}Props, ${1:MyComponent}State> {\n\tstate: ${1:MyComponent}State = {\n\t\t$4\n\t};\n\n\trender() {\n\t\treturn (\n\t\t\t<div>\n\t\t\t\t$0\n\t\t\t</div>\n\t\t);\n\t}\n}\n\nexport default ${1:MyComponent};",
    description: 'React class component with typed props and state',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_customhook',
    name: 'Custom Hook (TS)',
    prefix: 'customhook',
    body: 'function use${1:Hook}(${2:params}): ${3:ReturnType} {\n\tconst [${4:state}, set${5:State}] = useState<${6:type}>(${7:initial});\n\n\tuseEffect(() => {\n\t\t$0\n\t}, []);\n\n\treturn ${4:state};\n}',
    description: 'Custom React hook with TypeScript',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_cn',
    name: 'className',
    prefix: 'cn',
    body: 'className="${1:class}"',
    description: 'JSX className attribute',
    language: 'typescript',
    isBuiltin: true,
  },
  {
    id: 'builtin_react_ts_condrender',
    name: 'Conditional Render',
    prefix: 'condrender',
    body: '{${1:condition} && (\n\t$0\n)}',
    description: 'Conditional rendering in JSX',
    language: 'typescript',
    isBuiltin: true,
  },

  // ─── HTML ───────────────────────────────────────────────────────────
  {
    id: 'builtin_html_doc',
    name: 'HTML5 Boilerplate',
    prefix: 'html5',
    body: '<!DOCTYPE html>\n<html lang="${1:en}">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${2:Document}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>',
    description: 'HTML5 document boilerplate',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_div',
    name: 'Div',
    prefix: 'div',
    body: '<div class="${1:class}">\n\t$0\n</div>',
    description: 'HTML div with class',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_span',
    name: 'Span',
    prefix: 'span',
    body: '<span class="${1:class}">$0</span>',
    description: 'HTML span with class',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_a',
    name: 'Anchor Link',
    prefix: 'a',
    body: '<a href="${1:#}" ${2:target="_blank"}>${3:Link text}</a>',
    description: 'HTML anchor link',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_img',
    name: 'Image',
    prefix: 'img',
    body: '<img src="${1:src}" alt="${2:alt}" />',
    description: 'HTML image tag',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_input',
    name: 'Input',
    prefix: 'input',
    body: '<input type="${1:text}" id="${2:id}" name="${3:name}" placeholder="${4:placeholder}" />',
    description: 'HTML input element',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_button',
    name: 'Button',
    prefix: 'button',
    body: '<button type="${1|button,submit,reset|}" class="${2:class}">${3:Click me}</button>',
    description: 'HTML button element',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_ul',
    name: 'Unordered List',
    prefix: 'ul',
    body: '<ul>\n\t<li>${1:Item}</li>\n\t<li>${2:Item}</li>\n\t$0\n</ul>',
    description: 'Unordered list with items',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_ol',
    name: 'Ordered List',
    prefix: 'ol',
    body: '<ol>\n\t<li>${1:Item}</li>\n\t<li>${2:Item}</li>\n\t$0\n</ol>',
    description: 'Ordered list with items',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_table',
    name: 'Table',
    prefix: 'table',
    body: '<table>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>${1:Header}</th>\n\t\t\t<th>${2:Header}</th>\n\t\t</tr>\n\t</thead>\n\t<tbody>\n\t\t<tr>\n\t\t\t<td>${3:Data}</td>\n\t\t\t<td>${4:Data}</td>\n\t\t</tr>\n\t</tbody>\n</table>',
    description: 'HTML table with thead and tbody',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_form',
    name: 'Form',
    prefix: 'form',
    body: '<form action="${1:#}" method="${2:post}">\n\t<label for="${3:input}">${4:Label}</label>\n\t<input type="${5:text}" id="${3:input}" name="${3:input}" />\n\t<button type="submit">${6:Submit}</button>\n</form>',
    description: 'HTML form with label and input',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_select',
    name: 'Select Dropdown',
    prefix: 'select',
    body: '<select name="${1:name}" id="${2:id}">\n\t<option value="${3:value1}">${4:Option 1}</option>\n\t<option value="${5:value2}">${6:Option 2}</option>\n\t$0\n</select>',
    description: 'HTML select dropdown',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_textarea',
    name: 'Textarea',
    prefix: 'textarea',
    body: '<textarea name="${1:name}" id="${2:id}" cols="${3:30}" rows="${4:10}" placeholder="${5:Enter text...}">$0</textarea>',
    description: 'HTML textarea element',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_link',
    name: 'Link (stylesheet)',
    prefix: 'link',
    body: '<link rel="stylesheet" href="${1:style.css}" />',
    description: 'HTML link tag for stylesheet',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_meta',
    name: 'Meta Tag',
    prefix: 'meta',
    body: '<meta name="${1:description}" content="${2:content}" />',
    description: 'HTML meta tag',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_script',
    name: 'Script Tag',
    prefix: 'script',
    body: '<script src="${1:script.js}"></script>',
    description: 'HTML script tag',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_section',
    name: 'Section',
    prefix: 'section',
    body: '<section class="${1:section}">\n\t<h2>${2:Title}</h2>\n\t$0\n</section>',
    description: 'HTML section with heading',
    language: 'html',
    isBuiltin: true,
  },
  {
    id: 'builtin_html_nav',
    name: 'Nav',
    prefix: 'nav',
    body: '<nav class="${1:navbar}">\n\t<ul>\n\t\t<li><a href="${2:#}">${3:Home}</a></li>\n\t\t<li><a href="${4:#}">${5:About}</a></li>\n\t\t$0\n\t</ul>\n</nav>',
    description: 'HTML nav element with links',
    language: 'html',
    isBuiltin: true,
  },

  // ─── CSS ────────────────────────────────────────────────────────────
  {
    id: 'builtin_css_flex',
    name: 'Flexbox Container',
    prefix: 'flex',
    body: 'display: flex;\njustify-content: ${1|center,flex-start,flex-end,space-between,space-around|};\nalign-items: ${2|center,flex-start,flex-end,stretch,baseline|};\n$0',
    description: 'Flexbox container with justify and align',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_flexcol',
    name: 'Flexbox Column',
    prefix: 'flexcol',
    body: 'display: flex;\nflex-direction: column;\njustify-content: ${1:center};\nalign-items: ${2:center};\ngap: ${3:8px};\n$0',
    description: 'Flexbox column layout',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_grid',
    name: 'Grid Container',
    prefix: 'grid',
    body: 'display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngrid-template-rows: ${2:auto};\ngap: ${3:16px};\n$0',
    description: 'CSS Grid container',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_gridarea',
    name: 'Grid Template Areas',
    prefix: 'gridarea',
    body: "display: grid;\ngrid-template-areas:\n\t'${1:header} ${1:header}'\n\t'${2:sidebar} ${3:main}'\n\t'${4:footer} ${4:footer}';\ngrid-template-columns: ${5:200px} ${6:1fr};\ngrid-template-rows: ${7:auto 1fr auto};\n$0",
    description: 'CSS Grid with named areas',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_media',
    name: 'Media Query',
    prefix: 'media',
    body: '@media (${1|max-width,min-width|}: ${2:768px}) {\n\t$0\n}',
    description: 'CSS media query',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_mediaprefers',
    name: 'Prefers Color Scheme',
    prefix: 'mediacolor',
    body: '@media (prefers-color-scheme: ${1|dark,light|}) {\n\t$0\n}',
    description: 'Media query for color scheme preference',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_animation',
    name: 'Animation',
    prefix: 'animation',
    body: '@keyframes ${1:name} {\n\t0% {\n\t\t$2\n\t}\n\t100% {\n\t\t$3\n\t}\n}\n\n.${4:element} {\n\tanimation: ${1:name} ${5:1s} ${6|ease,ease-in,ease-out,ease-in-out,linear|} ${7:infinite};\n}',
    description: 'CSS keyframe animation with class',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_transition',
    name: 'Transition',
    prefix: 'transition',
    body: 'transition: ${1:all} ${2:0.3s} ${3|ease,ease-in,ease-out,ease-in-out,linear|};',
    description: 'CSS transition shorthand',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_transform',
    name: 'Transform',
    prefix: 'transform',
    body: 'transform: ${1|translate,translateX,translateY,rotate,scale,skew|}(${2:value});',
    description: 'CSS transform property',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_var',
    name: 'CSS Variable',
    prefix: 'var',
    body: '--${1:name}: ${2:value};',
    description: 'CSS custom property (variable)',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_usevar',
    name: 'Use CSS Variable',
    prefix: 'usevar',
    body: 'var(--${1:name}${2:, ${3:fallback}})',
    description: 'Use CSS custom property with fallback',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_center',
    name: 'Center Absolute',
    prefix: 'center',
    body: 'position: absolute;\ntop: 50%;\nleft: 50%;\ntransform: translate(-50%, -50%);',
    description: 'Center element with absolute positioning',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_centerflex',
    name: 'Center with Flexbox',
    prefix: 'centerflex',
    body: 'display: flex;\njustify-content: center;\nalign-items: center;',
    description: 'Center content with flexbox',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_reset',
    name: 'Box Sizing Reset',
    prefix: 'boxreset',
    body: '*, *::before, *::after {\n\tbox-sizing: border-box;\n\tmargin: 0;\n\tpadding: 0;\n}',
    description: 'Box-sizing reset with margin/padding',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_scrollbar',
    name: 'Custom Scrollbar',
    prefix: 'scrollbar',
    body: '&::-webkit-scrollbar {\n\twidth: ${1:8px};\n}\n\n&::-webkit-scrollbar-track {\n\tbackground: ${2:#f1f1f1};\n}\n\n&::-webkit-scrollbar-thumb {\n\tbackground: ${3:#888};\n\tborder-radius: ${4:4px};\n}',
    description: 'Custom webkit scrollbar styles',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_clamp',
    name: 'Clamp',
    prefix: 'clamp',
    body: 'clamp(${1:min}, ${2:preferred}, ${3:max})',
    description: 'CSS clamp function for responsive values',
    language: 'css',
    isBuiltin: true,
  },
  {
    id: 'builtin_css_container',
    name: 'Container Query',
    prefix: 'container',
    body: 'container-type: ${1|inline-size,size|};\ncontainer-name: ${2:name};\n\n@container ${2:name} (min-width: ${3:400px}) {\n\t$0\n}',
    description: 'CSS container query',
    language: 'css',
    isBuiltin: true,
  },

  // ─── Python ─────────────────────────────────────────────────────────
  {
    id: 'builtin_py_def',
    name: 'Function',
    prefix: 'def',
    body: 'def ${1:name}(${2:params}):\n\t${0:pass}',
    description: 'Function definition',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_cls',
    name: 'Class',
    prefix: 'class',
    body: 'class ${1:Name}:\n\tdef __init__(self, ${2:params}):\n\t\t${0:pass}',
    description: 'Class definition',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_ifm',
    name: 'If Main',
    prefix: 'ifmain',
    body: "if __name__ == '__main__':\n\t${0:main()}",
    description: 'if __name__ == "__main__" guard',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_try',
    name: 'Try/Except',
    prefix: 'try',
    body: 'try:\n\t$1\nexcept ${2:Exception} as ${3:e}:\n\t$0',
    description: 'Try/except block',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_with',
    name: 'With Statement',
    prefix: 'with',
    body: "with ${1:open('${2:file}')} as ${3:f}:\n\t$0",
    description: 'With statement / context manager',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_for',
    name: 'For Loop',
    prefix: 'for',
    body: 'for ${1:item} in ${2:iterable}:\n\t$0',
    description: 'For loop',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_if',
    name: 'If Statement',
    prefix: 'if',
    body: 'if ${1:condition}:\n\t$0',
    description: 'If statement',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_lambda',
    name: 'Lambda',
    prefix: 'lambda',
    body: 'lambda ${1:x}: ${0:x}',
    description: 'Lambda expression',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_deco',
    name: 'Decorator',
    prefix: 'decorator',
    body: 'def ${1:decorator}(func):\n\tdef wrapper(*args, **kwargs):\n\t\t$0\n\t\treturn func(*args, **kwargs)\n\treturn wrapper',
    description: 'Decorator function',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_listcomp',
    name: 'List Comprehension',
    prefix: 'listcomp',
    body: '[${1:expr} for ${2:item} in ${3:iterable}${4: if ${5:condition}}]',
    description: 'List comprehension',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_dictcomp',
    name: 'Dict Comprehension',
    prefix: 'dictcomp',
    body: '{${1:key}: ${2:value} for ${3:item} in ${4:iterable}}',
    description: 'Dictionary comprehension',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_dataclass',
    name: 'Dataclass',
    prefix: 'dataclass',
    body: 'from dataclasses import dataclass\n\n@dataclass\nclass ${1:Name}:\n\t${2:field}: ${3:str}\n\t$0',
    description: 'Python dataclass',
    language: 'python',
    isBuiltin: true,
  },
  {
    id: 'builtin_py_asyncdef',
    name: 'Async Function',
    prefix: 'asyncdef',
    body: 'async def ${1:name}(${2:params}):\n\t${0:pass}',
    description: 'Async function definition',
    language: 'python',
    isBuiltin: true,
  },

  // ─── Global (all languages) ─────────────────────────────────────────
  {
    id: 'builtin_global_todo',
    name: 'TODO Comment',
    prefix: 'todo',
    body: '// TODO: $0',
    description: 'TODO comment',
    language: 'global',
    isBuiltin: true,
  },
  {
    id: 'builtin_global_fixme',
    name: 'FIXME Comment',
    prefix: 'fixme',
    body: '// FIXME: $0',
    description: 'FIXME comment',
    language: 'global',
    isBuiltin: true,
  },
  {
    id: 'builtin_global_region',
    name: 'Region',
    prefix: 'region',
    body: '// #region ${1:Region Name}\n$0\n// #endregion',
    description: 'Foldable region markers',
    language: 'global',
    isBuiltin: true,
  },
  {
    id: 'builtin_global_header',
    name: 'File Header',
    prefix: 'header',
    body: '/**\n * ${1:Description}\n * @author ${2:$TM_FULLNAME}\n * @date $CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE\n */',
    description: 'File header comment block',
    language: 'global',
    isBuiltin: true,
  },
  {
    id: 'builtin_global_docblock',
    name: 'JSDoc Block',
    prefix: 'jsdoc',
    body: '/**\n * ${1:Description}\n * @param {${2:type}} ${3:param} - ${4:description}\n * @returns {${5:type}} ${6:description}\n */',
    description: 'JSDoc documentation block',
    language: 'global',
    isBuiltin: true,
  },
]

// Load user snippets from localStorage
function loadUserSnippets(): Snippet[] {
  try {
    const stored = localStorage.getItem('orion-user-snippets')
    if (stored) {
      const parsed = JSON.parse(stored) as Snippet[]
      // Migrate old snippets that lack `name` or `isBuiltin`
      return parsed.map((s) => ({
        ...s,
        name: s.name || s.prefix,
        isBuiltin: false,
      }))
    }
  } catch { /* ignore */ }
  return []
}

function saveUserSnippets(userSnippets: Snippet[]) {
  localStorage.setItem('orion-user-snippets', JSON.stringify(userSnippets))
}

/**
 * Convert VS Code snippet JSON format to Orion snippet array.
 * VS Code format: { "name": { prefix, body (string|string[]), description?, scope? } }
 */
function parseVSCodeFormat(data: VSCodeSnippetFormat, defaultLanguage: string = 'global'): Omit<Snippet, 'id' | 'isBuiltin'>[] {
  const result: Omit<Snippet, 'id' | 'isBuiltin'>[] = []
  for (const [name, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') continue
    const prefix = Array.isArray(entry.prefix) ? entry.prefix[0] : entry.prefix
    const body = Array.isArray(entry.body) ? entry.body.join('\n') : entry.body
    if (!prefix || !body) continue

    // Parse scope to language — VS Code uses comma-separated scope
    let language = defaultLanguage
    if (entry.scope) {
      const scopeParts = entry.scope.split(',').map((s) => s.trim().toLowerCase())
      // Use first scope as language
      if (scopeParts.length > 0 && scopeParts[0]) {
        language = scopeParts[0]
      }
    }

    result.push({
      name,
      prefix,
      body,
      description: entry.description || name,
      language,
    })
  }
  return result
}

/**
 * Convert Orion snippets to VS Code snippet JSON format.
 */
function toVSCodeFormat(snippets: Snippet[]): VSCodeSnippetFormat {
  const result: VSCodeSnippetFormat = {}
  for (const s of snippets) {
    result[s.name] = {
      prefix: s.prefix,
      body: s.body.split('\n'),
      description: s.description,
      ...(s.language !== 'global' ? { scope: s.language } : {}),
    }
  }
  return result
}

export const useSnippetStore = create<SnippetStore>((set, get) => {
  const initialUserSnippets = loadUserSnippets()

  return {
    snippets: [...BUILTIN_SNIPPETS, ...initialUserSnippets],
    userSnippets: initialUserSnippets,

    createSnippet: (snippet) =>
      set((state) => {
        const newSnippet: Snippet = { ...snippet, id: genId(), isBuiltin: false }
        const nextUser = [...state.userSnippets, newSnippet]
        saveUserSnippets(nextUser)
        return {
          snippets: [...BUILTIN_SNIPPETS, ...nextUser],
          userSnippets: nextUser,
        }
      }),

    updateSnippet: (id, changes) =>
      set((state) => {
        // Cannot update built-in snippets
        if (!state.userSnippets.find((s) => s.id === id)) return state
        const nextUser = state.userSnippets.map((s) =>
          s.id === id ? { ...s, ...changes } : s
        )
        saveUserSnippets(nextUser)
        return {
          snippets: [...BUILTIN_SNIPPETS, ...nextUser],
          userSnippets: nextUser,
        }
      }),

    deleteSnippet: (id) =>
      set((state) => {
        // Cannot delete built-in snippets
        if (!state.userSnippets.find((s) => s.id === id)) return state
        const nextUser = state.userSnippets.filter((s) => s.id !== id)
        saveUserSnippets(nextUser)
        return {
          snippets: [...BUILTIN_SNIPPETS, ...nextUser],
          userSnippets: nextUser,
        }
      }),

    getSnippetsForLanguage: (langId: string) => {
      const state = get()
      const lang = langId.toLowerCase()
      const langAliases: Record<string, string[]> = {
        javascript: ['javascript', 'javascriptreact', 'jsx'],
        typescript: ['typescript', 'typescriptreact', 'tsx'],
        python: ['python'],
        html: ['html', 'htm'],
      }
      let matchLangs = [lang]
      for (const [canonical, aliases] of Object.entries(langAliases)) {
        if (aliases.includes(lang) || canonical === lang) {
          matchLangs = [canonical, ...aliases]
          break
        }
      }
      // For typescript-family, also include javascript snippets
      if (matchLangs.includes('typescript') || matchLangs.includes('typescriptreact')) {
        matchLangs = [...new Set([...matchLangs, 'javascript', 'javascriptreact', 'jsx'])]
      }
      // Always include global snippets
      matchLangs.push('global')
      return state.snippets.filter((s) => matchLangs.includes(s.language.toLowerCase()))
    },

    // Legacy compat aliases
    addSnippet: (snippet) => get().createSnippet(snippet),

    removeSnippet: (id) => get().deleteSnippet(id),

    importSnippets: (imported) =>
      set((state) => {
        const newUser = imported
          .filter((s) => !s.id?.startsWith('builtin_'))
          .map((s) => ({
            id: genId(),
            name: s.name || s.prefix,
            prefix: s.prefix,
            body: s.body,
            description: s.description || s.prefix,
            language: s.language || 'global',
            isBuiltin: false,
          }))
        const nextUser = [...state.userSnippets, ...newUser]
        saveUserSnippets(nextUser)
        return {
          snippets: [...BUILTIN_SNIPPETS, ...nextUser],
          userSnippets: nextUser,
        }
      }),

    importVSCodeSnippets: (data: VSCodeSnippetFormat, defaultLanguage?: string) => {
      const parsed = parseVSCodeFormat(data, defaultLanguage)
      if (parsed.length === 0) return 0
      const state = get()
      const newUser = parsed.map((s) => ({
        ...s,
        id: genId(),
        isBuiltin: false,
      }))
      const nextUser = [...state.userSnippets, ...newUser]
      saveUserSnippets(nextUser)
      set({
        snippets: [...BUILTIN_SNIPPETS, ...nextUser],
        userSnippets: nextUser,
      })
      return newUser.length
    },

    exportSnippets: () => {
      // Export only user snippets
      return get().userSnippets
    },

    exportVSCodeFormat: () => {
      return toVSCodeFormat(get().userSnippets)
    },

    insertSnippetAtCursor: (snippet: Snippet) => {
      // Dispatch a custom event that the editor can listen for
      const event = new CustomEvent('orion-insert-snippet', {
        detail: { body: snippet.body, name: snippet.name },
      })
      window.dispatchEvent(event)
    },
  }
})
