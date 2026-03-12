// ─── Types ───────────────────────────────────────────────────────────────────

export interface TextSelection {
  start: number;
  end: number;
}

export interface RefactoringResult {
  code: string;
  /** Optional cursor position after refactoring */
  cursorOffset?: number;
}

export interface RefactoringAction {
  id: string;
  label: string;
  description: string;
  canApply(code: string, selection: TextSelection): boolean;
  apply(code: string, selection: TextSelection): RefactoringResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSelectedText(code: string, selection: TextSelection): string {
  return code.slice(selection.start, selection.end);
}

/** Collect all identifier-like tokens from a code snippet. */
function extractIdentifiers(snippet: string): string[] {
  const cleaned = snippet
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '');

  const matches = cleaned.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
  const keywords = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof',
    'instanceof', 'void', 'this', 'class', 'extends', 'super', 'import',
    'export', 'default', 'from', 'as', 'try', 'catch', 'finally', 'throw',
    'async', 'await', 'yield', 'in', 'of', 'true', 'false', 'null', 'undefined',
    'interface', 'type', 'enum', 'implements', 'public', 'private', 'protected',
    'static', 'readonly', 'abstract', 'declare', 'module', 'namespace',
  ]);
  const unique = [...new Set(matches)].filter((id) => !keywords.has(id));
  return unique;
}

/** Find identifiers that are declared (via const/let/var/function) within a snippet. */
function findDeclaredIdentifiers(snippet: string): Set<string> {
  const declared = new Set<string>();
  const declRegex = /\b(?:const|let|var)\s+(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(snippet)) !== null) {
    if (m[1]) {
      m[1].split(',').forEach((part) => {
        const id = part.split(':')[0].trim();
        if (id) declared.add(id);
      });
    } else if (m[2]) {
      declared.add(m[2]);
    }
  }
  const fnRegex = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((m = fnRegex.exec(snippet)) !== null) {
    declared.add(m[1]);
  }
  return declared;
}

/** Determine the indentation of the line that contains position `offset`. */
function getIndentAtOffset(code: string, offset: number): string {
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1;
  const match = code.slice(lineStart).match(/^(\s*)/);
  return match ? match[1] : '';
}

/** Simple check: does the string look like a single expression (no semicolons / statements)? */
function looksLikeExpression(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes(';') || trimmed.includes('\n')) return false;
  if (/^(if|for|while|switch|return|const|let|var|function|class)\b/.test(trimmed)) return false;
  return true;
}

/** Escape regex special characters. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Check if a position falls inside a string or comment (rough heuristic). */
function isInsideStringOrComment(code: string, pos: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < pos; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inSingle) { if (ch === '\\') { i++; } else if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '\\') { i++; } else if (ch === '"') inDouble = false; continue; }
    if (inTemplate) { if (ch === '\\') { i++; } else if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
  }
  return inSingle || inDouble || inTemplate || inLineComment || inBlockComment;
}

// ─── 1. Extract Function ─────────────────────────────────────────────────────

const extractFunction: RefactoringAction = {
  id: 'extract-function',
  label: 'Extract Function',
  description: 'Extract selected code into a new function',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return text.length > 0 && text.includes('\n') || text.length > 20;
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const selected = getSelectedText(code, selection);
    const trimmed = selected.trim();
    const indent = getIndentAtOffset(code, selection.start);

    const allIds = extractIdentifiers(trimmed);
    const declaredInside = findDeclaredIdentifiers(trimmed);
    const beforeSelection = code.slice(0, selection.start);
    const declaredBefore = findDeclaredIdentifiers(beforeSelection);

    // Parameters: identifiers used but not declared inside, that are declared before
    const params = allIds.filter((id) => !declaredInside.has(id) && declaredBefore.has(id));

    // Return values: identifiers declared inside that are used after the selection
    const afterSelection = code.slice(selection.end);
    const usedAfter = extractIdentifiers(afterSelection);
    const returnVars = [...declaredInside].filter((id) => usedAfter.includes(id));

    const funcName = 'extractedFunction';
    const paramList = params.join(', ');

    let body = trimmed;
    let returnStatement = '';
    if (returnVars.length === 1) {
      returnStatement = `\n${indent}  return ${returnVars[0]};`;
    } else if (returnVars.length > 1) {
      returnStatement = `\n${indent}  return { ${returnVars.join(', ')} };`;
    }

    // Re-indent the body to be inside the function
    const bodyLines = body.split('\n').map((line) => `${indent}  ${line.trimStart()}`);
    const funcBody = bodyLines.join('\n');

    const funcDecl = [
      `${indent}function ${funcName}(${paramList}) {`,
      funcBody,
      returnStatement,
      `${indent}}`,
    ]
      .filter(Boolean)
      .join('\n');

    // Build the call site
    let callSite: string;
    if (returnVars.length === 0) {
      callSite = `${indent}${funcName}(${paramList});`;
    } else if (returnVars.length === 1) {
      callSite = `${indent}const ${returnVars[0]} = ${funcName}(${paramList});`;
    } else {
      callSite = `${indent}const { ${returnVars.join(', ')} } = ${funcName}(${paramList});`;
    }

    const newCode =
      code.slice(0, selection.start) +
      callSite +
      '\n\n' +
      funcDecl +
      code.slice(selection.end);

    return { code: newCode };
  },
};

// ─── 2. Extract Variable ─────────────────────────────────────────────────────

const extractVariable: RefactoringAction = {
  id: 'extract-variable',
  label: 'Extract Variable',
  description: 'Extract expression into a const variable',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return text.length > 0 && looksLikeExpression(text);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const expr = getSelectedText(code, selection).trim();
    const indent = getIndentAtOffset(code, selection.start);
    const varName = 'extracted';
    const declaration = `${indent}const ${varName} = ${expr};\n`;
    const lineStart = code.lastIndexOf('\n', selection.start - 1) + 1;

    const newCode =
      code.slice(0, lineStart) +
      declaration +
      code.slice(lineStart, selection.start) +
      varName +
      code.slice(selection.end);

    return { code: newCode, cursorOffset: lineStart + indent.length + 6 };
  },
};

// ─── 3. Rename Symbol ────────────────────────────────────────────────────────

const renameSymbol: RefactoringAction = {
  id: 'rename-symbol',
  label: 'Rename Symbol',
  description: 'Rename all occurrences of the selected identifier',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(text);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const oldName = getSelectedText(code, selection).trim();
    const newName = `${oldName}Renamed`;
    const wordBoundary = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');

    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = wordBoundary.exec(code)) !== null) {
      const pos = match.index;
      if (!isInsideStringOrComment(code, pos)) {
        result += code.slice(lastIndex, pos) + newName;
      } else {
        result += code.slice(lastIndex, pos) + oldName;
      }
      lastIndex = pos + oldName.length;
    }
    result += code.slice(lastIndex);

    return { code: result };
  },
};

// ─── 4. Inline Variable ─────────────────────────────────────────────────────

const inlineVariable: RefactoringAction = {
  id: 'inline-variable',
  label: 'Inline Variable',
  description: 'Replace all usages of a variable with its initializer',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(text)) return false;
    const declPattern = new RegExp(
      `(?:const|let|var)\\s+${escapeRegex(text)}\\s*=\\s*`
    );
    return declPattern.test(code);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const varName = getSelectedText(code, selection).trim();
    const declRegex = new RegExp(
      `([ \\t]*)(?:const|let|var)\\s+${escapeRegex(varName)}\\s*=\\s*(.+?)\\s*;[ \\t]*\\r?\\n?`
    );
    const declMatch = code.match(declRegex);
    if (!declMatch) return { code };

    const initializer = declMatch[2];
    // Remove the declaration line
    let result = code.replace(declRegex, '');
    // Replace all usages with the initializer
    const usageRegex = new RegExp(`\\b${escapeRegex(varName)}\\b`, 'g');
    result = result.replace(usageRegex, (match, offset: number) => {
      if (isInsideStringOrComment(result, offset)) return match;
      return initializer;
    });

    return { code: result };
  },
};

// ─── 5. Convert Function ─────────────────────────────────────────────────────

const convertFunction: RefactoringAction = {
  id: 'convert-function',
  label: 'Convert Function',
  description: 'Convert between arrow function and regular function',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    const isArrow = /=>/.test(text) && /(?:const|let|var)\s+\w+\s*=/.test(text);
    const isRegular = /^(?:async\s+)?function\s+\w+/.test(text);
    return isArrow || isRegular;
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const text = getSelectedText(code, selection).trim();

    // Arrow → Regular
    const arrowMatch = text.match(
      /^((?:export\s+)?)(const|let|var)\s+(\w+)\s*=\s*(async\s+)?(?:\(([^)]*)\)|(\w+))\s*=>\s*([\s\S]*)$/
    );
    if (arrowMatch) {
      const [, exportKw, , name, asyncKw, params, singleParam, body] = arrowMatch;
      const paramList = params ?? singleParam ?? '';
      const asyncPrefix = asyncKw ? 'async ' : '';
      let funcBody: string;
      const trimBody = body.trim();
      if (trimBody.startsWith('{')) {
        funcBody = trimBody;
      } else {
        // Expression body → block with return
        const cleaned = trimBody.replace(/;$/, '');
        funcBody = `{\n  return ${cleaned};\n}`;
      }
      const result = `${exportKw}${asyncPrefix}function ${name}(${paramList}) ${funcBody}`;
      const newCode = code.slice(0, selection.start) + result + code.slice(selection.end);
      return { code: newCode };
    }

    // Regular → Arrow
    const funcMatch = text.match(
      /^((?:export\s+)?)(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(\{[\s\S]*\})$/
    );
    if (funcMatch) {
      const [, exportKw, asyncKw, name, params, body] = funcMatch;
      const asyncPrefix = asyncKw ? 'async ' : '';
      const result = `${exportKw}const ${name} = ${asyncPrefix}(${params}) => ${body}`;
      const newCode = code.slice(0, selection.start) + result + code.slice(selection.end);
      return { code: newCode };
    }

    return { code };
  },
};

// ─── 6. Add/Remove Braces ────────────────────────────────────────────────────

const toggleBraces: RefactoringAction = {
  id: 'toggle-braces',
  label: 'Add/Remove Braces',
  description: 'Toggle between concise and block arrow function body',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return /=>\s*/.test(text);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const text = getSelectedText(code, selection);

    // Block body → expression body (remove braces)
    const blockMatch = text.match(/([\s\S]*?=>\s*)\{\s*return\s+([\s\S]*?)\s*;\s*\}(\s*)$/);
    if (blockMatch) {
      const [, before, expr, trailing] = blockMatch;
      const result = `${before}${expr}${trailing}`;
      return { code: code.slice(0, selection.start) + result + code.slice(selection.end) };
    }

    // Expression body → block body (add braces)
    const exprMatch = text.match(/([\s\S]*?=>\s*)((?!\{)[\s\S]+)$/);
    if (exprMatch) {
      const [, before, expr] = exprMatch;
      const cleanExpr = expr.trim().replace(/;$/, '');
      const result = `${before}{\n  return ${cleanExpr};\n}`;
      return { code: code.slice(0, selection.start) + result + code.slice(selection.end) };
    }

    return { code };
  },
};

// ─── 7. Toggle Async ─────────────────────────────────────────────────────────

const toggleAsync: RefactoringAction = {
  id: 'toggle-async',
  label: 'Toggle Async',
  description: 'Add or remove async/await from a function',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return /\bfunction\b/.test(text) || /=>/.test(text);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    let text = getSelectedText(code, selection);

    // If already async, remove async and all awaits
    if (/\basync\b/.test(text)) {
      text = text.replace(/\basync\s+/, '');
      text = text.replace(/\bawait\s+/g, '');
    } else {
      // Add async before function keyword or before params in arrow
      if (/\bfunction\b/.test(text)) {
        text = text.replace(/\bfunction\b/, 'async function');
      } else {
        // Arrow function: add async before parameter list
        text = text.replace(/^(\s*(?:(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*)?)(\(|[a-zA-Z_$])/, '$1async $2');
      }
    }

    return { code: code.slice(0, selection.start) + text + code.slice(selection.end) };
  },
};

// ─── 8. Organize Imports ─────────────────────────────────────────────────────

interface ParsedImport {
  original: string;
  source: string;
  defaultImport: string | null;
  namedImports: string[];
  namespaceImport: string | null;
  isTypeOnly: boolean;
  sideEffectOnly: boolean;
}

function parseImportLine(line: string): ParsedImport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('import')) return null;

  const isTypeOnly = /^import\s+type\b/.test(trimmed);

  // Side-effect import: import 'foo';
  const sideEffectMatch = trimmed.match(/^import\s+(['"])(.+?)\1\s*;?\s*$/);
  if (sideEffectMatch) {
    return {
      original: trimmed,
      source: sideEffectMatch[2],
      defaultImport: null,
      namedImports: [],
      namespaceImport: null,
      isTypeOnly: false,
      sideEffectOnly: true,
    };
  }

  // Extract the source module
  const sourceMatch = trimmed.match(/from\s+(['"])(.+?)\1/);
  if (!sourceMatch) return null;
  const source = sourceMatch[2];

  let defaultImport: string | null = null;
  let namedImports: string[] = [];
  let namespaceImport: string | null = null;

  const importClause = trimmed
    .replace(/^import\s+(type\s+)?/, '')
    .replace(/\s*from\s+['"].*['"];?\s*$/, '')
    .trim();

  // Namespace import: * as Foo
  const nsMatch = importClause.match(/^\*\s+as\s+(\w+)$/);
  if (nsMatch) {
    namespaceImport = nsMatch[1];
  } else {
    // Named imports in braces
    const bracesMatch = importClause.match(/\{([^}]*)\}/);
    if (bracesMatch) {
      namedImports = bracesMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    // Default import (before braces or standalone)
    const defaultMatch = importClause.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*,)?/);
    if (defaultMatch && defaultMatch[1] !== '*') {
      const potentialDefault = defaultMatch[1];
      // Make sure it's not a named import inside braces
      if (!bracesMatch || !importClause.startsWith('{')) {
        defaultImport = potentialDefault;
      }
    }
  }

  return {
    original: trimmed,
    source,
    defaultImport,
    namedImports,
    namespaceImport,
    isTypeOnly,
    sideEffectOnly: false,
  };
}

function classifyImportSource(source: string): 'builtin' | 'external' | 'internal' | 'relative' {
  if (source.startsWith('.')) return 'relative';
  if (source.startsWith('@/') || source.startsWith('~/')) return 'internal';
  const builtins = new Set([
    'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'events', 'stream',
    'crypto', 'buffer', 'child_process', 'cluster', 'net', 'tls', 'dgram',
    'readline', 'repl', 'vm', 'zlib', 'assert', 'querystring', 'string_decoder',
    'timers', 'tty', 'worker_threads', 'perf_hooks',
  ]);
  const base = source.split('/')[0];
  if (builtins.has(base) || source.startsWith('node:')) return 'builtin';
  return 'external';
}

function reconstructImport(parsed: ParsedImport): string {
  if (parsed.sideEffectOnly) {
    return `import '${parsed.source}';`;
  }

  const typePrefix = parsed.isTypeOnly ? 'type ' : '';
  const parts: string[] = [];

  if (parsed.defaultImport) parts.push(parsed.defaultImport);
  if (parsed.namespaceImport) parts.push(`* as ${parsed.namespaceImport}`);
  if (parsed.namedImports.length > 0) {
    parts.push(`{ ${parsed.namedImports.join(', ')} }`);
  }

  return `import ${typePrefix}${parts.join(', ')} from '${parsed.source}';`;
}

export function organizeImports(code: string): string {
  const lines = code.split('\n');
  let importStart = -1;
  let importEnd = -1;
  const parsedImports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
      if (importStart === -1) importStart = i;
      importEnd = i;
      const parsed = parseImportLine(trimmed);
      if (parsed) parsedImports.push(parsed);
    } else if (importStart !== -1 && trimmed !== '' && !trimmed.startsWith('//')) {
      break;
    }
  }

  if (parsedImports.length === 0) return code;

  // Deduplicate: merge named imports from the same source
  const mergedMap = new Map<string, ParsedImport>();
  for (const imp of parsedImports) {
    const key = `${imp.isTypeOnly ? 'type:' : ''}${imp.source}`;
    const existing = mergedMap.get(key);
    if (existing && !imp.sideEffectOnly) {
      if (imp.defaultImport && !existing.defaultImport) {
        existing.defaultImport = imp.defaultImport;
      }
      if (imp.namespaceImport && !existing.namespaceImport) {
        existing.namespaceImport = imp.namespaceImport;
      }
      const nameSet = new Set([...existing.namedImports, ...imp.namedImports]);
      existing.namedImports = [...nameSet].sort((a, b) => a.localeCompare(b));
    } else {
      mergedMap.set(key, { ...imp, namedImports: [...imp.namedImports] });
    }
  }

  const merged = [...mergedMap.values()];

  // Group by category
  const groups: Record<string, ParsedImport[]> = {
    builtin: [],
    external: [],
    internal: [],
    relative: [],
  };

  for (const imp of merged) {
    const cat = classifyImportSource(imp.source);
    groups[cat].push(imp);
  }

  // Sort within each group alphabetically by source
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.source.localeCompare(b.source));
  }

  // Reconstruct import block
  const orderedGroups = ['builtin', 'external', 'internal', 'relative'];
  const importLines: string[] = [];
  let addedGroup = false;

  for (const groupKey of orderedGroups) {
    const group = groups[groupKey];
    if (group.length === 0) continue;
    if (addedGroup) importLines.push('');
    for (const imp of group) {
      importLines.push(reconstructImport(imp));
    }
    addedGroup = true;
  }

  // Replace original import block
  const before = lines.slice(0, importStart);
  const after = lines.slice(importEnd + 1);
  const result = [...before, ...importLines, ...after].join('\n');

  return result;
}

const organizeImportsAction: RefactoringAction = {
  id: 'organize-imports',
  label: 'Organize Imports',
  description: 'Sort, group, and deduplicate import statements',

  canApply(code: string, _selection: TextSelection): boolean {
    return /^import\s/m.test(code);
  },

  apply(code: string, _selection: TextSelection): RefactoringResult {
    return { code: organizeImports(code) };
  },
};

// ─── 9. Convert String ───────────────────────────────────────────────────────

const convertString: RefactoringAction = {
  id: 'convert-string',
  label: 'Convert String',
  description: 'Toggle between template literal, single quotes, and double quotes',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return /^(['"`])[\s\S]*\1$/.test(text);
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const text = getSelectedText(code, selection).trim();
    const quote = text[0];
    const inner = text.slice(1, -1);

    let result: string;
    if (quote === "'") {
      // single → double
      const escaped = inner.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"');
      result = `"${escaped}"`;
    } else if (quote === '"') {
      // double → template
      const unescaped = inner.replace(/\\"/g, '"');
      result = `\`${unescaped}\``;
    } else {
      // template → single
      const escaped = inner.replace(/(?<!\\)'/g, "\\'");
      result = `'${escaped}'`;
    }

    return {
      code: code.slice(0, selection.start) + result + code.slice(selection.end),
    };
  },
};

// ─── 10. Wrap in Try-Catch ───────────────────────────────────────────────────

const wrapInTryCatch: RefactoringAction = {
  id: 'wrap-try-catch',
  label: 'Wrap in Try-Catch',
  description: 'Wrap selected code in a try-catch block',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    return text.length > 0;
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const selected = getSelectedText(code, selection);
    const indent = getIndentAtOffset(code, selection.start);
    const innerIndent = indent + '  ';

    const indentedBody = selected
      .split('\n')
      .map((line) => (line.trim() ? `${innerIndent}${line.trimStart()}` : line))
      .join('\n');

    const tryCatch = [
      `${indent}try {`,
      indentedBody,
      `${indent}} catch (error) {`,
      `${innerIndent}console.error(error);`,
      `${indent}}`,
    ].join('\n');

    return {
      code: code.slice(0, selection.start) + tryCatch + code.slice(selection.end),
    };
  },
};

// ─── 11. Convert Ternary ─────────────────────────────────────────────────────

const convertTernary: RefactoringAction = {
  id: 'convert-ternary',
  label: 'Convert Ternary',
  description: 'Convert between if-else and ternary expression',

  canApply(code: string, selection: TextSelection): boolean {
    const text = getSelectedText(code, selection).trim();
    const isIfElse = /^if\s*\(/.test(text) && /\belse\b/.test(text);
    const isTernary = /\?[\s\S]+:/.test(text) && !/^if\s*\(/.test(text);
    return isIfElse || isTernary;
  },

  apply(code: string, selection: TextSelection): RefactoringResult {
    const text = getSelectedText(code, selection).trim();
    const indent = getIndentAtOffset(code, selection.start);

    // If-else → ternary
    const ifElseMatch = text.match(
      /^if\s*\((.+?)\)\s*\{\s*(?:return\s+)?(.+?)\s*;?\s*\}\s*else\s*\{\s*(?:return\s+)?(.+?)\s*;?\s*\}$/s
    );
    if (ifElseMatch) {
      const [, condition, consequent, alternate] = ifElseMatch;
      const hasReturn = /return\s/.test(text);
      const ternary = `${condition.trim()} ? ${consequent.trim()} : ${alternate.trim()}`;
      const result = hasReturn
        ? `${indent}return ${ternary};`
        : `${indent}${ternary};`;
      return {
        code: code.slice(0, selection.start) + result + code.slice(selection.end),
      };
    }

    // Ternary → if-else
    const ternaryMatch = text.match(
      /^(?:(return)\s+)?(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)\s*;?\s*$/s
    );
    if (ternaryMatch) {
      const [, returnKw, condition, consequent, alternate] = ternaryMatch;
      const retPrefix = returnKw ? 'return ' : '';
      const ifElse = [
        `${indent}if (${condition.trim()}) {`,
        `${indent}  ${retPrefix}${consequent.trim()};`,
        `${indent}} else {`,
        `${indent}  ${retPrefix}${alternate.trim()};`,
        `${indent}}`,
      ].join('\n');
      return {
        code: code.slice(0, selection.start) + ifElse + code.slice(selection.end),
      };
    }

    return { code };
  },
};

// ─── Registry & Public API ───────────────────────────────────────────────────

const allRefactorings: RefactoringAction[] = [
  extractFunction,
  extractVariable,
  renameSymbol,
  inlineVariable,
  convertFunction,
  toggleBraces,
  toggleAsync,
  organizeImportsAction,
  convertString,
  wrapInTryCatch,
  convertTernary,
];

/**
 * Returns all refactoring actions that can be applied to the given code
 * at the given selection range.
 */
export function getAvailableRefactorings(
  code: string,
  selection: TextSelection
): RefactoringAction[] {
  return allRefactorings.filter((action) => {
    try {
      return action.canApply(code, selection);
    } catch {
      return false;
    }
  });
}

/**
 * Look up a specific refactoring by its id.
 */
export function getRefactoringById(id: string): RefactoringAction | undefined {
  return allRefactorings.find((r) => r.id === id);
}

/**
 * Apply a refactoring by id. Returns null if the refactoring is not found
 * or cannot be applied.
 */
export function applyRefactoring(
  id: string,
  code: string,
  selection: TextSelection
): RefactoringResult | null {
  const action = getRefactoringById(id);
  if (!action || !action.canApply(code, selection)) return null;
  return action.apply(code, selection);
}
