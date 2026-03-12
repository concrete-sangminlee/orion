import { create } from 'zustand'

export interface Snippet {
  id: string
  prefix: string
  body: string
  description: string
  language: string
}

interface SnippetStore {
  snippets: Snippet[]
  addSnippet: (snippet: Omit<Snippet, 'id'>) => void
  removeSnippet: (id: string) => void
  updateSnippet: (id: string, updates: Partial<Omit<Snippet, 'id'>>) => void
  getSnippetsForLanguage: (language: string) => Snippet[]
  importSnippets: (snippets: Snippet[]) => void
  exportSnippets: () => Snippet[]
}

let _nextId = 1
function genId(): string {
  return `snippet_${Date.now()}_${_nextId++}`
}

// ── Built-in snippets ────────────────────────────────────────────────

const BUILTIN_SNIPPETS: Snippet[] = [
  // ─── JavaScript / TypeScript ───────────────────────────────────────
  {
    id: 'builtin_log',
    prefix: 'log',
    body: 'console.log($1);',
    description: 'Console log statement',
    language: 'javascript',
  },
  {
    id: 'builtin_fn',
    prefix: 'fn',
    body: 'function ${1:name}(${2:params}) {\n\t$3\n}',
    description: 'Function declaration',
    language: 'javascript',
  },
  {
    id: 'builtin_afn',
    prefix: 'afn',
    body: 'async function ${1:name}(${2:params}) {\n\t$3\n}',
    description: 'Async function declaration',
    language: 'javascript',
  },
  {
    id: 'builtin_imp',
    prefix: 'imp',
    body: "import { $2 } from '${1:module}';",
    description: 'Import statement',
    language: 'javascript',
  },
  {
    id: 'builtin_exp',
    prefix: 'exp',
    body: 'export ${1:default} $2;',
    description: 'Export statement',
    language: 'javascript',
  },
  {
    id: 'builtin_ife',
    prefix: 'ife',
    body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$3\n}',
    description: 'If/else block',
    language: 'javascript',
  },
  {
    id: 'builtin_for',
    prefix: 'for',
    body: 'for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t$3\n}',
    description: 'For loop',
    language: 'javascript',
  },
  {
    id: 'builtin_fore',
    prefix: 'fore',
    body: '${1:array}.forEach((${2:item}) => {\n\t$3\n});',
    description: 'Array forEach',
    language: 'javascript',
  },
  {
    id: 'builtin_map',
    prefix: 'map',
    body: '${1:array}.map((${2:item}) => {\n\t$3\n});',
    description: 'Array map',
    language: 'javascript',
  },
  {
    id: 'builtin_try',
    prefix: 'try',
    body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$3\n}',
    description: 'Try/catch block',
    language: 'javascript',
  },
  {
    id: 'builtin_class',
    prefix: 'class',
    body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$3\n\t}\n}',
    description: 'Class definition',
    language: 'javascript',
  },
  {
    id: 'builtin_iface',
    prefix: 'iface',
    body: 'interface ${1:Name} {\n\t${2:property}: ${3:type};\n}',
    description: 'TypeScript interface',
    language: 'typescript',
  },
  {
    id: 'builtin_use',
    prefix: 'use',
    body: 'const [${1:state}, set${2:State}] = useState(${3:initialValue});',
    description: 'React useState hook',
    language: 'javascript',
  },
  {
    id: 'builtin_uef',
    prefix: 'uef',
    body: 'useEffect(() => {\n\t$1\n\treturn () => {\n\t\t$2\n\t};\n}, [${3:deps}]);',
    description: 'React useEffect hook',
    language: 'javascript',
  },
  {
    id: 'builtin_uref',
    prefix: 'uref',
    body: 'const ${1:ref} = useRef<${2:HTMLDivElement}>(${3:null});',
    description: 'React useRef hook',
    language: 'javascript',
  },
  {
    id: 'builtin_comp',
    prefix: 'comp',
    body: "import React from 'react';\n\ninterface ${1:Component}Props {\n\t$2\n}\n\nexport default function ${1:Component}({ $3 }: ${1:Component}Props) {\n\treturn (\n\t\t<div>\n\t\t\t$4\n\t\t</div>\n\t);\n}",
    description: 'React functional component',
    language: 'javascript',
  },

  // ─── TypeScript duplicates (share JS snippets) ─────────────────────
  {
    id: 'builtin_ts_log',
    prefix: 'log',
    body: 'console.log($1);',
    description: 'Console log statement',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_fn',
    prefix: 'fn',
    body: 'function ${1:name}(${2:params}): ${3:void} {\n\t$4\n}',
    description: 'Function declaration',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_afn',
    prefix: 'afn',
    body: 'async function ${1:name}(${2:params}): Promise<${3:void}> {\n\t$4\n}',
    description: 'Async function declaration',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_imp',
    prefix: 'imp',
    body: "import { $2 } from '${1:module}';",
    description: 'Import statement',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_exp',
    prefix: 'exp',
    body: 'export ${1:default} $2;',
    description: 'Export statement',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_ife',
    prefix: 'ife',
    body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$3\n}',
    description: 'If/else block',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_for',
    prefix: 'for',
    body: 'for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t$3\n}',
    description: 'For loop',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_fore',
    prefix: 'fore',
    body: '${1:array}.forEach((${2:item}) => {\n\t$3\n});',
    description: 'Array forEach',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_map',
    prefix: 'map',
    body: '${1:array}.map((${2:item}) => {\n\t$3\n});',
    description: 'Array map',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_try',
    prefix: 'try',
    body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$3\n}',
    description: 'Try/catch block',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_class',
    prefix: 'class',
    body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$3\n\t}\n}',
    description: 'Class definition',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_use',
    prefix: 'use',
    body: 'const [${1:state}, set${2:State}] = useState<${3:type}>(${4:initialValue});',
    description: 'React useState hook',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_uef',
    prefix: 'uef',
    body: 'useEffect(() => {\n\t$1\n\treturn () => {\n\t\t$2\n\t};\n}, [${3:deps}]);',
    description: 'React useEffect hook',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_uref',
    prefix: 'uref',
    body: 'const ${1:ref} = useRef<${2:HTMLDivElement}>(${3:null});',
    description: 'React useRef hook',
    language: 'typescript',
  },
  {
    id: 'builtin_ts_comp',
    prefix: 'comp',
    body: "interface ${1:Component}Props {\n\t$2\n}\n\nexport default function ${1:Component}({ $3 }: ${1:Component}Props) {\n\treturn (\n\t\t<div>\n\t\t\t$4\n\t\t</div>\n\t);\n}",
    description: 'React functional component',
    language: 'typescript',
  },

  // ─── Python ────────────────────────────────────────────────────────
  {
    id: 'builtin_py_def',
    prefix: 'def',
    body: 'def ${1:name}(${2:params}):\n\t${3:pass}',
    description: 'Function definition',
    language: 'python',
  },
  {
    id: 'builtin_py_cls',
    prefix: 'cls',
    body: 'class ${1:Name}:\n\tdef __init__(self, ${2:params}):\n\t\t${3:pass}',
    description: 'Class definition',
    language: 'python',
  },
  {
    id: 'builtin_py_ifm',
    prefix: 'ifm',
    body: "if __name__ == '__main__':\n\t${1:main()}",
    description: 'if __name__ == "__main__"',
    language: 'python',
  },
  {
    id: 'builtin_py_try',
    prefix: 'try',
    body: 'try:\n\t$1\nexcept ${2:Exception} as ${3:e}:\n\t$4',
    description: 'Try/except block',
    language: 'python',
  },
  {
    id: 'builtin_py_with',
    prefix: 'with',
    body: "with ${1:open('${2:file}')} as ${3:f}:\n\t$4",
    description: 'With statement',
    language: 'python',
  },
]

// Load user snippets from localStorage
function loadUserSnippets(): Snippet[] {
  try {
    const stored = localStorage.getItem('orion-user-snippets')
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

function saveUserSnippets(snippets: Snippet[]) {
  const userOnly = snippets.filter((s) => !s.id.startsWith('builtin_'))
  localStorage.setItem('orion-user-snippets', JSON.stringify(userOnly))
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  snippets: [...BUILTIN_SNIPPETS, ...loadUserSnippets()],

  addSnippet: (snippet) =>
    set((state) => {
      const newSnippet: Snippet = { ...snippet, id: genId() }
      const next = [...state.snippets, newSnippet]
      saveUserSnippets(next)
      return { snippets: next }
    }),

  removeSnippet: (id) =>
    set((state) => {
      // Prevent removing built-in snippets
      if (id.startsWith('builtin_')) return state
      const next = state.snippets.filter((s) => s.id !== id)
      saveUserSnippets(next)
      return { snippets: next }
    }),

  updateSnippet: (id, updates) =>
    set((state) => {
      const next = state.snippets.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      )
      saveUserSnippets(next)
      return { snippets: next }
    }),

  getSnippetsForLanguage: (language: string) => {
    const state = get()
    const lang = language.toLowerCase()
    // Map language variants
    const langAliases: Record<string, string[]> = {
      javascript: ['javascript', 'javascriptreact'],
      typescript: ['typescript', 'typescriptreact'],
      python: ['python'],
    }
    // Find which canonical language this belongs to
    let matchLangs = [lang]
    for (const [canonical, aliases] of Object.entries(langAliases)) {
      if (aliases.includes(lang) || canonical === lang) {
        matchLangs = [canonical, ...aliases]
        break
      }
    }
    // For typescript-family, also include javascript snippets
    if (matchLangs.includes('typescript') || matchLangs.includes('typescriptreact')) {
      matchLangs = [...new Set([...matchLangs, 'javascript', 'javascriptreact'])]
    }
    return state.snippets.filter((s) => matchLangs.includes(s.language.toLowerCase()))
  },

  importSnippets: (imported) =>
    set((state) => {
      // Assign new IDs to imported snippets to prevent collisions
      const withIds = imported.map((s) => ({
        ...s,
        id: s.id.startsWith('builtin_') ? s.id : genId(),
      }))
      // Merge: keep builtins, add new user snippets
      const builtins = state.snippets.filter((s) => s.id.startsWith('builtin_'))
      const existingUser = state.snippets.filter((s) => !s.id.startsWith('builtin_'))
      const newUser = withIds.filter((s) => !s.id.startsWith('builtin_'))
      const next = [...builtins, ...existingUser, ...newUser]
      saveUserSnippets(next)
      return { snippets: next }
    }),

  exportSnippets: () => {
    return get().snippets
  },
}))
