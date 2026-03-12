/**
 * AI-powered Code Actions Provider
 *
 * Provides intelligent code suggestions, fixes, refactoring, and generation
 * capabilities powered by AI. This module implements the kind of smart code
 * actions that make an AI-native editor powerful: quick fixes, refactoring,
 * docstring generation, test generation, code explanation, optimization,
 * type annotation inference, pattern conversion, interface extraction, and
 * inline code review.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type AICodeActionKind = 'quickfix' | 'refactor' | 'source' | 'generate' | 'optimize'

export interface TextEdit {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

export interface ReviewComment {
  line: number
  severity: 'info' | 'warning' | 'error' | 'suggestion'
  message: string
  suggestedFix?: string
}

export interface CodeContext {
  file: string
  language: string
  selection: string
  surroundingCode: string
  diagnostics: DiagnosticInfo[]
  imports: string[]
}

export interface DiagnosticInfo {
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  line: number
  column: number
  endLine?: number
  endColumn?: number
  code?: string | number
  source?: string
}

export interface AICodeActionResult {
  edits: TextEdit[]
  importsToAdd: string[]
  message: string
}

export interface AICodeAction {
  id: string
  title: string
  kind: AICodeActionKind
  isPreferred: boolean
  diagnostics: DiagnosticInfo[]
  execute: () => Promise<AICodeActionResult>
}

// ── Prompt Templates ───────────────────────────────────────────────────────

const PROMPT_QUICK_FIX = `You are an expert programmer. Given the following diagnostic error and the surrounding code, provide a corrected version of the code that fixes the issue. Return ONLY the fixed code, no explanations.

Language: {{language}}
Diagnostic: {{diagnostic}}

Code:
\`\`\`
{{code}}
\`\`\`

Fixed code:`

const PROMPT_REFACTOR = `You are an expert software engineer. Analyze the following code and suggest a clean refactoring. Improve readability, reduce complexity, and follow best practices for the language. Return ONLY the refactored code.

Language: {{language}}

Code:
\`\`\`
{{code}}
\`\`\`

Refactored code:`

const PROMPT_GENERATE_DOCSTRING = `You are a documentation expert. Generate a comprehensive docstring/JSDoc comment for the following function or class. Include parameter descriptions, return type, throws clauses if applicable, and a brief summary. Use the standard documentation format for the language.

Language: {{language}}

Code:
\`\`\`
{{code}}
\`\`\`

Docstring (return ONLY the docstring comment, nothing else):`

const PROMPT_GENERATE_TESTS = `You are a testing expert. Generate comprehensive unit tests for the following code. Cover happy paths, edge cases, and error scenarios. Use the specified testing framework conventions.

Language: {{language}}
Testing Framework: {{framework}}

Code:
\`\`\`
{{code}}
\`\`\`

Unit tests:`

const PROMPT_EXPLAIN_CODE = `You are a patient programming instructor. Explain the following code by adding clear inline comments. Each comment should explain what the next line or block does and why. Do not change the code itself, only add comments.

Language: {{language}}

Code:
\`\`\`
{{code}}
\`\`\`

Code with inline explanation comments:`

const PROMPT_OPTIMIZE = `You are a performance optimization expert. Analyze the following code and suggest an optimized version. Focus on algorithmic improvements, reducing unnecessary allocations, minimizing I/O, and leveraging language-specific optimizations. Return the optimized code followed by a brief explanation of what was improved.

Language: {{language}}

Code:
\`\`\`
{{code}}
\`\`\`

Return your response in the following format:
---CODE---
<optimized code here>
---EXPLANATION---
<brief explanation of improvements>`

const PROMPT_ADD_TYPES = `You are a TypeScript expert. Analyze the following code and add proper TypeScript type annotations to all variables, function parameters, return types, and any other places where types can be inferred. Use precise types rather than 'any' where possible. Return ONLY the annotated code.

Code:
\`\`\`
{{code}}
\`\`\`

Fully typed code:`

const PROMPT_CONVERT_CLASS_TO_FUNCTIONAL = `You are a React expert. Convert the following class component to a functional component using hooks. Preserve all existing behavior, lifecycle methods (converted to useEffect), state (converted to useState), and refs (converted to useRef). Return ONLY the converted code.

Code:
\`\`\`
{{code}}
\`\`\`

Functional component:`

const PROMPT_CONVERT_FUNCTIONAL_TO_CLASS = `You are a React expert. Convert the following functional component to a class component. Convert hooks to lifecycle methods and class state. Preserve all existing behavior. Return ONLY the converted code.

Code:
\`\`\`
{{code}}
\`\`\`

Class component:`

const PROMPT_CONVERT_CALLBACK_TO_PROMISE = `You are a JavaScript expert. Convert the following callback-based code to use Promises. Preserve all error handling and edge cases. Return ONLY the converted code.

Code:
\`\`\`
{{code}}
\`\`\`

Promise-based code:`

const PROMPT_CONVERT_PROMISE_TO_ASYNC = `You are a JavaScript expert. Convert the following Promise-based code to use async/await syntax. Preserve all error handling. Return ONLY the converted code.

Code:
\`\`\`
{{code}}
\`\`\`

Async/await code:`

const PROMPT_CONVERT_ASYNC_TO_CALLBACK = `You are a JavaScript expert. Convert the following async/await code to use callbacks. Preserve all error handling. Return ONLY the converted code.

Code:
\`\`\`
{{code}}
\`\`\`

Callback-based code:`

const PROMPT_GENERATE_INTERFACE = `You are a TypeScript expert. Analyze the following object usage patterns and extract a TypeScript interface that accurately describes the shape of the object. Infer precise types from the usage context. Return ONLY the interface definition.

Object usage:
\`\`\`
{{code}}
\`\`\`

TypeScript interface:`

const PROMPT_IMPLEMENT_INTERFACE = `You are a TypeScript expert. Generate a complete stub implementation for the following TypeScript interface. Provide reasonable default values and TODO comments where meaningful implementation is needed. Return ONLY the implementation code.

Interface:
\`\`\`
{{code}}
\`\`\`

Implementation:`

const PROMPT_CODE_REVIEW = `You are a senior code reviewer. Review the following code thoroughly. For each issue found, provide the line number, severity (info/warning/error/suggestion), a clear message, and optionally a suggested fix. Focus on bugs, security issues, performance problems, and best practice violations.

Language: {{language}}

Code (line numbers included):
\`\`\`
{{code}}
\`\`\`

Return your review as a JSON array of objects with this shape:
[{"line": number, "severity": "info"|"warning"|"error"|"suggestion", "message": "string", "suggestedFix": "string or null"}]

Review:`

// ── Helpers ────────────────────────────────────────────────────────────────

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}

async function callAI(prompt: string): Promise<string> {
  try {
    const result = await (window as any).api?.aiGenerate?.(prompt)
    if (typeof result === 'string') {
      return result.trim()
    }
    return result?.text?.trim() ?? result?.content?.trim() ?? ''
  } catch (err) {
    console.error('[AI Code Actions] AI generation failed:', err)
    throw new Error(`AI generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function extractCodeBlock(text: string): string {
  const fenceMatch = text.match(/```[\w]*\n([\s\S]*?)```/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  return text.trim()
}

function parseLineNumber(lineStr: string): number {
  const num = parseInt(lineStr, 10)
  return isNaN(num) ? 1 : num
}

function numberLines(code: string): string {
  return code
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
}

function detectPatternType(code: string): 'class-component' | 'functional-component' | 'callback' | 'promise' | 'async-await' | 'unknown' {
  const trimmed = code.trim()

  if (/class\s+\w+\s+extends\s+(React\.)?Component/.test(trimmed)) {
    return 'class-component'
  }
  if (/(?:function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)|[^=])\s*=>)/.test(trimmed) &&
      /(?:useState|useEffect|useRef|useMemo|useCallback)/.test(trimmed)) {
    return 'functional-component'
  }
  if (/async\s+(?:function|\([^)]*\)\s*=>|\w+\s*=>)/.test(trimmed) || /\bawait\b/.test(trimmed)) {
    return 'async-await'
  }
  if (/\.then\s*\(/.test(trimmed) || /new\s+Promise/.test(trimmed)) {
    return 'promise'
  }
  if (/(?:callback|cb|done|next)\s*\(/.test(trimmed) || /function\s*\([^)]*,\s*(?:callback|cb|done|next)\)/.test(trimmed)) {
    return 'callback'
  }
  return 'unknown'
}

function computeEditsFromNewCode(
  originalCode: string,
  newCode: string,
  startLine: number
): TextEdit[] {
  const originalLines = originalCode.split('\n')
  const newLines = newCode.split('\n')

  return [
    {
      startLine,
      startColumn: 1,
      endLine: startLine + originalLines.length - 1,
      endColumn: (originalLines[originalLines.length - 1]?.length ?? 0) + 1,
      newText: newLines.join('\n'),
    },
  ]
}

function extractImportsFromCode(code: string): string[] {
  const importRegex = /^import\s+.*$/gm
  const matches = code.match(importRegex)
  return matches ?? []
}

// ── Core AI Action Functions ───────────────────────────────────────────────

/**
 * Suggest a fix for a given diagnostic using AI analysis.
 */
export async function suggestFix(
  diagnostic: string,
  code: string,
  language: string
): Promise<TextEdit[]> {
  const prompt = fillTemplate(PROMPT_QUICK_FIX, { diagnostic, code, language })
  const response = await callAI(prompt)
  const fixedCode = extractCodeBlock(response)

  return computeEditsFromNewCode(code, fixedCode, 1)
}

/**
 * Generate a docstring for a function or class.
 */
export async function generateDocstring(
  code: string,
  language: string
): Promise<string> {
  const prompt = fillTemplate(PROMPT_GENERATE_DOCSTRING, { code, language })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Generate unit tests for the provided code.
 */
export async function generateTests(
  code: string,
  language: string,
  framework: string = 'jest'
): Promise<string> {
  const prompt = fillTemplate(PROMPT_GENERATE_TESTS, { code, language, framework })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Generate inline explanation comments for the provided code.
 */
export async function explainCode(
  code: string,
  language: string
): Promise<string> {
  const prompt = fillTemplate(PROMPT_EXPLAIN_CODE, { code, language })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Suggest performance optimizations for the provided code.
 */
export async function optimizeCode(
  code: string,
  language: string
): Promise<{ code: string; explanation: string }> {
  const prompt = fillTemplate(PROMPT_OPTIMIZE, { code, language })
  const response = await callAI(prompt)

  const codeSplit = response.split('---CODE---')
  const explSplit = response.split('---EXPLANATION---')

  let optimizedCode = code
  let explanation = 'No specific optimizations found.'

  if (codeSplit.length > 1) {
    const afterCode = codeSplit[1]
    const codeSection = afterCode.split('---EXPLANATION---')[0]
    optimizedCode = extractCodeBlock(codeSection)
  }

  if (explSplit.length > 1) {
    explanation = explSplit[1].trim()
  }

  return { code: optimizedCode, explanation }
}

/**
 * Add TypeScript type annotations to the provided code.
 */
export async function addTypeAnnotations(code: string): Promise<string> {
  const prompt = fillTemplate(PROMPT_ADD_TYPES, { code })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Extract a TypeScript interface from object usage patterns.
 */
export async function generateInterface(objectUsage: string): Promise<string> {
  const prompt = fillTemplate(PROMPT_GENERATE_INTERFACE, { code: objectUsage })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Generate a stub implementation for a TypeScript interface.
 */
export async function implementInterface(interfaceCode: string): Promise<string> {
  const prompt = fillTemplate(PROMPT_IMPLEMENT_INTERFACE, { code: interfaceCode })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Perform an AI-powered code review with inline comments.
 */
export async function reviewCode(
  code: string,
  language: string
): Promise<ReviewComment[]> {
  const numberedCode = numberLines(code)
  const prompt = fillTemplate(PROMPT_CODE_REVIEW, { code: numberedCode, language })
  const response = await callAI(prompt)

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return []
    }
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.map((item: any) => ({
      line: parseLineNumber(String(item.line ?? 1)),
      severity: (['info', 'warning', 'error', 'suggestion'].includes(item.severity)
        ? item.severity
        : 'info') as ReviewComment['severity'],
      message: String(item.message ?? ''),
      suggestedFix: item.suggestedFix ? String(item.suggestedFix) : undefined,
    }))
  } catch {
    console.warn('[AI Code Actions] Failed to parse review response as JSON')
    return []
  }
}

/**
 * Convert code between patterns (class/functional component, callback/promise/async).
 */
export async function convertPattern(
  code: string,
  targetPattern: 'class-component' | 'functional-component' | 'callback' | 'promise' | 'async-await'
): Promise<string> {
  const currentPattern = detectPatternType(code)

  let template: string
  if (targetPattern === 'functional-component' && currentPattern === 'class-component') {
    template = PROMPT_CONVERT_CLASS_TO_FUNCTIONAL
  } else if (targetPattern === 'class-component' && currentPattern === 'functional-component') {
    template = PROMPT_CONVERT_FUNCTIONAL_TO_CLASS
  } else if (targetPattern === 'promise' && currentPattern === 'callback') {
    template = PROMPT_CONVERT_CALLBACK_TO_PROMISE
  } else if (targetPattern === 'async-await' && (currentPattern === 'promise' || currentPattern === 'callback')) {
    template = PROMPT_CONVERT_PROMISE_TO_ASYNC
  } else if (targetPattern === 'callback' && (currentPattern === 'async-await' || currentPattern === 'promise')) {
    template = PROMPT_CONVERT_ASYNC_TO_CALLBACK
  } else {
    // Fallback: use the refactor prompt with a conversion hint
    template = PROMPT_REFACTOR
  }

  const prompt = fillTemplate(template, { code })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

/**
 * Refactor code using AI for improved quality and readability.
 */
export async function refactorCode(
  code: string,
  language: string
): Promise<string> {
  const prompt = fillTemplate(PROMPT_REFACTOR, { code, language })
  const response = await callAI(prompt)
  return extractCodeBlock(response)
}

// ── Main Code Actions Provider ─────────────────────────────────────────────

/**
 * Get all available AI code actions for a given code context.
 * This is the primary entry point that assembles the complete list of
 * applicable AI-powered actions based on the current selection and diagnostics.
 */
export async function getAICodeActions(context: CodeContext): Promise<AICodeAction[]> {
  const { file, language, selection, surroundingCode, diagnostics, imports } = context
  const actions: AICodeAction[] = []

  const selectionOrSurrounding = selection || surroundingCode
  if (!selectionOrSurrounding) {
    return actions
  }

  // ── Quick Fix actions for each diagnostic ──
  for (const diag of diagnostics) {
    actions.push({
      id: `ai-quickfix-${diag.line}-${diag.code ?? 'unknown'}`,
      title: `AI Fix: ${truncate(diag.message, 60)}`,
      kind: 'quickfix',
      isPreferred: true,
      diagnostics: [diag],
      execute: async () => {
        const edits = await suggestFix(diag.message, surroundingCode, language)
        return {
          edits,
          importsToAdd: [],
          message: `Applied AI fix for: ${diag.message}`,
        }
      },
    })
  }

  // ── Refactor ──
  actions.push({
    id: 'ai-refactor',
    title: 'AI Refactor: Improve Code Quality',
    kind: 'refactor',
    isPreferred: false,
    diagnostics: [],
    execute: async () => {
      const refactored = await refactorCode(selectionOrSurrounding, language)
      const edits = computeEditsFromNewCode(selectionOrSurrounding, refactored, 1)
      const newImports = extractImportsFromCode(refactored).filter(
        (imp) => !imports.includes(imp)
      )
      return {
        edits,
        importsToAdd: newImports,
        message: 'Code refactored by AI.',
      }
    },
  })

  // ── Generate Docstring ──
  if (isFunctionLike(selectionOrSurrounding)) {
    actions.push({
      id: 'ai-generate-docstring',
      title: 'AI: Generate Docstring',
      kind: 'generate',
      isPreferred: false,
      diagnostics: [],
      execute: async () => {
        const docstring = await generateDocstring(selectionOrSurrounding, language)
        return {
          edits: [
            {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 1,
              newText: docstring + '\n',
            },
          ],
          importsToAdd: [],
          message: 'Docstring generated.',
        }
      },
    })
  }

  // ── Generate Unit Tests ──
  actions.push({
    id: 'ai-generate-tests',
    title: 'AI: Generate Unit Tests',
    kind: 'generate',
    isPreferred: false,
    diagnostics: [],
    execute: async () => {
      const framework = inferTestFramework(file, imports)
      const tests = await generateTests(selectionOrSurrounding, language, framework)
      return {
        edits: [],
        importsToAdd: [],
        message: tests,
      }
    },
  })

  // ── Explain Code ──
  actions.push({
    id: 'ai-explain-code',
    title: 'AI: Explain Code',
    kind: 'source',
    isPreferred: false,
    diagnostics: [],
    execute: async () => {
      const explained = await explainCode(selectionOrSurrounding, language)
      const edits = computeEditsFromNewCode(selectionOrSurrounding, explained, 1)
      return {
        edits,
        importsToAdd: [],
        message: 'Inline explanation comments added.',
      }
    },
  })

  // ── Optimize Code ──
  actions.push({
    id: 'ai-optimize-code',
    title: 'AI: Optimize Performance',
    kind: 'optimize',
    isPreferred: false,
    diagnostics: [],
    execute: async () => {
      const result = await optimizeCode(selectionOrSurrounding, language)
      const edits = computeEditsFromNewCode(selectionOrSurrounding, result.code, 1)
      return {
        edits,
        importsToAdd: [],
        message: `Optimization applied: ${result.explanation}`,
      }
    },
  })

  // ── Add Type Annotations (TypeScript only) ──
  if (isTypeScriptLike(language)) {
    actions.push({
      id: 'ai-add-types',
      title: 'AI: Add Type Annotations',
      kind: 'source',
      isPreferred: false,
      diagnostics: [],
      execute: async () => {
        const typed = await addTypeAnnotations(selectionOrSurrounding)
        const edits = computeEditsFromNewCode(selectionOrSurrounding, typed, 1)
        const newImports = extractImportsFromCode(typed).filter(
          (imp) => !imports.includes(imp)
        )
        return {
          edits,
          importsToAdd: newImports,
          message: 'Type annotations added.',
        }
      },
    })
  }

  // ── Convert Patterns ──
  const patternType = detectPatternType(selectionOrSurrounding)
  const conversionActions = getPatternConversions(patternType)
  for (const conversion of conversionActions) {
    actions.push({
      id: `ai-convert-${conversion.target}`,
      title: `AI: Convert to ${conversion.label}`,
      kind: 'refactor',
      isPreferred: false,
      diagnostics: [],
      execute: async () => {
        const converted = await convertPattern(selectionOrSurrounding, conversion.target)
        const edits = computeEditsFromNewCode(selectionOrSurrounding, converted, 1)
        const newImports = extractImportsFromCode(converted).filter(
          (imp) => !imports.includes(imp)
        )
        return {
          edits,
          importsToAdd: newImports,
          message: `Converted to ${conversion.label}.`,
        }
      },
    })
  }

  // ── Generate Interface ──
  if (isTypeScriptLike(language) && hasObjectLiteral(selectionOrSurrounding)) {
    actions.push({
      id: 'ai-generate-interface',
      title: 'AI: Extract Interface',
      kind: 'generate',
      isPreferred: false,
      diagnostics: [],
      execute: async () => {
        const iface = await generateInterface(selectionOrSurrounding)
        return {
          edits: [
            {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 1,
              newText: iface + '\n\n',
            },
          ],
          importsToAdd: [],
          message: 'Interface extracted from object usage.',
        }
      },
    })
  }

  // ── Implement Interface ──
  if (isTypeScriptLike(language) && hasInterfaceDeclaration(selectionOrSurrounding)) {
    actions.push({
      id: 'ai-implement-interface',
      title: 'AI: Implement Interface',
      kind: 'generate',
      isPreferred: false,
      diagnostics: [],
      execute: async () => {
        const impl = await implementInterface(selectionOrSurrounding)
        const lastLine = selectionOrSurrounding.split('\n').length
        return {
          edits: [
            {
              startLine: lastLine,
              startColumn: Number.MAX_SAFE_INTEGER,
              endLine: lastLine,
              endColumn: Number.MAX_SAFE_INTEGER,
              newText: '\n\n' + impl,
            },
          ],
          importsToAdd: [],
          message: 'Interface implementation generated.',
        }
      },
    })
  }

  // ── AI Code Review ──
  actions.push({
    id: 'ai-code-review',
    title: 'AI: Review Code',
    kind: 'source',
    isPreferred: false,
    diagnostics: [],
    execute: async () => {
      const comments = await reviewCode(selectionOrSurrounding, language)
      const edits: TextEdit[] = []

      // Convert review comments into inline comment edits, inserted above each flagged line
      for (const comment of comments.reverse()) {
        const prefix = comment.severity === 'error'
          ? '// [AI REVIEW ERROR]'
          : comment.severity === 'warning'
            ? '// [AI REVIEW WARNING]'
            : comment.severity === 'suggestion'
              ? '// [AI REVIEW SUGGESTION]'
              : '// [AI REVIEW]'

        let commentText = `${prefix} ${comment.message}`
        if (comment.suggestedFix) {
          commentText += `\n// Suggested fix: ${comment.suggestedFix}`
        }

        edits.push({
          startLine: comment.line,
          startColumn: 1,
          endLine: comment.line,
          endColumn: 1,
          newText: commentText + '\n',
        })
      }

      return {
        edits,
        importsToAdd: [],
        message: `Code review complete: ${comments.length} comment(s) added.`,
      }
    },
  })

  return actions
}

// ── Detection Helpers ──────────────────────────────────────────────────────

function isFunctionLike(code: string): boolean {
  return /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?(?:get|set|static)?\s*\w+\s*\([^)]*\)\s*\{)/.test(code)
}

function isTypeScriptLike(language: string): boolean {
  return ['typescript', 'typescriptreact', 'tsx', 'ts'].includes(language.toLowerCase())
}

function hasObjectLiteral(code: string): boolean {
  return /(?:const|let|var)\s+\w+\s*(?::\s*\w+)?\s*=\s*\{/.test(code) ||
    /\w+\.\w+\s*[=!]/.test(code)
}

function hasInterfaceDeclaration(code: string): boolean {
  return /(?:export\s+)?interface\s+\w+/.test(code) ||
    /(?:export\s+)?type\s+\w+\s*=\s*\{/.test(code)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

function inferTestFramework(file: string, imports: string[]): string {
  const importStr = imports.join('\n')
  if (importStr.includes('vitest') || file.includes('.vitest')) return 'vitest'
  if (importStr.includes('mocha') || importStr.includes('chai')) return 'mocha'
  if (importStr.includes('@testing-library')) return 'jest with @testing-library'
  return 'jest'
}

interface PatternConversion {
  target: 'class-component' | 'functional-component' | 'callback' | 'promise' | 'async-await'
  label: string
}

function getPatternConversions(
  current: ReturnType<typeof detectPatternType>
): PatternConversion[] {
  switch (current) {
    case 'class-component':
      return [{ target: 'functional-component', label: 'Functional Component' }]
    case 'functional-component':
      return [{ target: 'class-component', label: 'Class Component' }]
    case 'callback':
      return [
        { target: 'promise', label: 'Promise' },
        { target: 'async-await', label: 'Async/Await' },
      ]
    case 'promise':
      return [
        { target: 'async-await', label: 'Async/Await' },
        { target: 'callback', label: 'Callback' },
      ]
    case 'async-await':
      return [
        { target: 'promise', label: 'Promise' },
        { target: 'callback', label: 'Callback' },
      ]
    default:
      return []
  }
}
