/**
 * AI prompt template system.
 * Provides structured prompts for code generation, refactoring,
 * documentation, testing, and review with context injection.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface PromptTemplate {
  id: string
  name: string
  description: string
  category: PromptCategory
  template: string
  variables: TemplateVariable[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  stop?: string[]
  icon?: string
}

export type PromptCategory =
  | 'generate'
  | 'refactor'
  | 'explain'
  | 'test'
  | 'fix'
  | 'document'
  | 'review'
  | 'optimize'
  | 'translate'
  | 'custom'

export interface TemplateVariable {
  name: string
  description: string
  required: boolean
  type: 'string' | 'code' | 'file' | 'selection' | 'language'
  default?: string
}

export interface PromptContext {
  selectedCode?: string
  fileContent?: string
  filePath?: string
  language?: string
  cursorLine?: number
  diagnostics?: string[]
  gitDiff?: string
  terminalOutput?: string
  imports?: string[]
  projectType?: string
  customVars?: Record<string, string>
}

export interface CompiledPrompt {
  system: string
  user: string
  maxTokens: number
  temperature: number
  stop?: string[]
}

/* ── Template Registry ────────────────────────────────── */

const templates: Map<string, PromptTemplate> = new Map()

export function registerTemplate(template: PromptTemplate): void {
  templates.set(template.id, template)
}

export function getTemplate(id: string): PromptTemplate | undefined {
  return templates.get(id)
}

export function getAllTemplates(): PromptTemplate[] {
  return [...templates.values()]
}

export function getTemplatesByCategory(category: PromptCategory): PromptTemplate[] {
  return getAllTemplates().filter(t => t.category === category)
}

export function searchTemplates(query: string): PromptTemplate[] {
  const lower = query.toLowerCase()
  return getAllTemplates().filter(t =>
    t.name.toLowerCase().includes(lower) ||
    t.description.toLowerCase().includes(lower) ||
    t.category.toLowerCase().includes(lower)
  )
}

/* ── Template Compilation ─────────────────────────────── */

export function compilePrompt(
  template: PromptTemplate,
  context: PromptContext
): CompiledPrompt {
  let userPrompt = template.template
  const vars: Record<string, string> = {
    SELECTED_CODE: context.selectedCode || '',
    FILE_CONTENT: context.fileContent || '',
    FILE_PATH: context.filePath || '',
    LANGUAGE: context.language || 'unknown',
    CURSOR_LINE: String(context.cursorLine || 1),
    DIAGNOSTICS: context.diagnostics?.join('\n') || '',
    GIT_DIFF: context.gitDiff || '',
    TERMINAL_OUTPUT: context.terminalOutput || '',
    IMPORTS: context.imports?.join('\n') || '',
    PROJECT_TYPE: context.projectType || '',
    ...context.customVars,
  }

  for (const [key, value] of Object.entries(vars)) {
    userPrompt = userPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  const systemPrompt = template.systemPrompt || DEFAULT_SYSTEM_PROMPT

  return {
    system: systemPrompt,
    user: userPrompt,
    maxTokens: template.maxTokens || 4096,
    temperature: template.temperature ?? 0.7,
    stop: template.stop,
  }
}

/* ── Fill-in-the-Middle (FIM) ─────────────────────────── */

export interface FIMContext {
  prefix: string
  suffix: string
  language: string
  filePath: string
  maxPrefixTokens: number
  maxSuffixTokens: number
}

export function buildFIMPrompt(ctx: FIMContext, provider: 'anthropic' | 'openai' | 'ollama'): string {
  const truncatedPrefix = truncateFromStart(ctx.prefix, ctx.maxPrefixTokens * 4)
  const truncatedSuffix = truncateFromEnd(ctx.suffix, ctx.maxSuffixTokens * 4)

  switch (provider) {
    case 'anthropic':
      return `You are a code completion assistant. Complete the code at the cursor position.

File: ${ctx.filePath}
Language: ${ctx.language}

Code before cursor:
\`\`\`${ctx.language}
${truncatedPrefix}
\`\`\`

Code after cursor:
\`\`\`${ctx.language}
${truncatedSuffix}
\`\`\`

Write ONLY the code that goes at the cursor position. Do not include the surrounding code. Do not use markdown formatting.`

    case 'openai':
      return `<|fim_prefix|>${truncatedPrefix}<|fim_suffix|>${truncatedSuffix}<|fim_middle|>`

    case 'ollama':
      return `<PRE> ${truncatedPrefix} <SUF>${truncatedSuffix} <MID>`

    default:
      return truncatedPrefix
  }
}

function truncateFromStart(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(-maxChars)
}

function truncateFromEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

/* ── Default System Prompts ───────────────────────────── */

const DEFAULT_SYSTEM_PROMPT = `You are an expert software engineer and coding assistant integrated into the Orion IDE. Follow these guidelines:
- Write clean, idiomatic, production-quality code
- Follow the existing code style and conventions in the project
- Be concise and focused in your responses
- When generating code, include only the relevant code without unnecessary explanations
- Handle edge cases and error scenarios
- Use modern language features and best practices
- Respect the project's existing patterns and architecture`

const CODE_REVIEW_SYSTEM = `You are an expert code reviewer. Review the given code for:
- Bugs and logical errors
- Security vulnerabilities (OWASP Top 10)
- Performance issues
- Code style and readability
- Best practices violations
- Potential edge cases
- Test coverage gaps
Be specific about issues and suggest concrete fixes.`

const TEST_GENERATION_SYSTEM = `You are a testing expert. Generate comprehensive tests that:
- Cover happy paths and edge cases
- Test error handling
- Use descriptive test names
- Follow the testing framework conventions of the project
- Include setup and teardown when needed
- Mock external dependencies appropriately
- Aim for high code coverage`

/* ── Built-in Templates ───────────────────────────────── */

registerTemplate({
  id: 'explain-code',
  name: 'Explain Code',
  description: 'Explain what the selected code does',
  category: 'explain',
  icon: '💡',
  template: `Explain the following {{LANGUAGE}} code. Include:
1. What it does (high-level overview)
2. How it works (step by step)
3. Key design decisions
4. Any potential issues or improvements

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\``,
  variables: [
    { name: 'SELECTED_CODE', description: 'The code to explain', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
  ],
  temperature: 0.3,
})

registerTemplate({
  id: 'generate-function',
  name: 'Generate Function',
  description: 'Generate a function from a description',
  category: 'generate',
  icon: '⚡',
  template: `Generate a {{LANGUAGE}} function based on this description:

{{DESCRIPTION}}

Context (current file):
\`\`\`{{LANGUAGE}}
{{FILE_CONTENT}}
\`\`\`

Requirements:
- Follow the existing code style
- Include TypeScript types if applicable
- Handle edge cases
- Add a brief JSDoc comment

Respond with ONLY the function code.`,
  variables: [
    { name: 'DESCRIPTION', description: 'What the function should do', required: true, type: 'string' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
    { name: 'FILE_CONTENT', description: 'Current file content', required: false, type: 'file' },
  ],
  temperature: 0.5,
})

registerTemplate({
  id: 'fix-bug',
  name: 'Fix Bug',
  description: 'Identify and fix a bug in the code',
  category: 'fix',
  icon: '🐛',
  template: `There's a bug in this {{LANGUAGE}} code. Fix it.

Code:
\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

{{#DIAGNOSTICS}}
Diagnostic errors:
{{DIAGNOSTICS}}
{{/DIAGNOSTICS}}

{{#TERMINAL_OUTPUT}}
Error output:
\`\`\`
{{TERMINAL_OUTPUT}}
\`\`\`
{{/TERMINAL_OUTPUT}}

Respond with:
1. What the bug is
2. The fixed code
3. Brief explanation of the fix`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code with the bug', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
    { name: 'DIAGNOSTICS', description: 'Error diagnostics', required: false, type: 'string' },
    { name: 'TERMINAL_OUTPUT', description: 'Error output', required: false, type: 'string' },
  ],
  temperature: 0.3,
})

registerTemplate({
  id: 'generate-tests',
  name: 'Generate Tests',
  description: 'Generate unit tests for the selected code',
  category: 'test',
  icon: '🧪',
  systemPrompt: TEST_GENERATION_SYSTEM,
  template: `Generate comprehensive unit tests for this {{LANGUAGE}} code:

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

Use the testing framework that matches the project (Vitest/Jest for TS/JS, pytest for Python, etc.)

Include tests for:
- Normal operation (happy path)
- Edge cases
- Error handling
- Boundary values`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to test', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
  ],
  temperature: 0.4,
})

registerTemplate({
  id: 'code-review',
  name: 'Code Review',
  description: 'Review code for bugs, security, and style',
  category: 'review',
  icon: '🔍',
  systemPrompt: CODE_REVIEW_SYSTEM,
  template: `Review this {{LANGUAGE}} code:

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

File: {{FILE_PATH}}

Provide:
1. **Issues** (bugs, security, performance) - with severity
2. **Suggestions** for improvement
3. **Positives** - what's done well
4. **Summary** rating (1-5 stars)`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to review', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
    { name: 'FILE_PATH', description: 'File path', required: false, type: 'string' },
  ],
  temperature: 0.3,
})

registerTemplate({
  id: 'add-documentation',
  name: 'Add Documentation',
  description: 'Generate documentation comments',
  category: 'document',
  icon: '📝',
  template: `Add documentation comments to this {{LANGUAGE}} code. Use the appropriate doc format (JSDoc for TS/JS, docstring for Python, /// for Rust, etc.):

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

Include:
- Description of what each function/class does
- @param descriptions with types
- @returns description
- @throws for error cases
- @example usage where helpful

Respond with the fully documented code.`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to document', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
  ],
  temperature: 0.3,
})

registerTemplate({
  id: 'optimize-performance',
  name: 'Optimize Performance',
  description: 'Suggest performance optimizations',
  category: 'optimize',
  icon: '🚀',
  template: `Optimize the performance of this {{LANGUAGE}} code:

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

Focus on:
- Time complexity improvements
- Memory usage reduction
- Unnecessary allocations
- Caching opportunities
- Algorithmic improvements
- Async/parallel processing opportunities

For each suggestion:
1. Explain the issue
2. Show the optimized code
3. Estimate the improvement`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to optimize', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
  ],
  temperature: 0.4,
})

registerTemplate({
  id: 'refactor-code',
  name: 'Refactor Code',
  description: 'Suggest and apply refactoring improvements',
  category: 'refactor',
  icon: '♻️',
  template: `Refactor this {{LANGUAGE}} code to improve readability, maintainability, and adherence to best practices:

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

Consider:
- SOLID principles
- DRY (Don't Repeat Yourself)
- Meaningful names
- Single responsibility
- Reducing complexity
- Modern language features
- Error handling patterns

Respond with the refactored code and brief explanations for key changes.`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to refactor', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Programming language', required: true, type: 'language' },
  ],
  temperature: 0.4,
})

registerTemplate({
  id: 'translate-code',
  name: 'Translate Code',
  description: 'Convert code from one language to another',
  category: 'translate',
  icon: '🌐',
  template: `Translate this {{LANGUAGE}} code to {{TARGET_LANGUAGE}}:

\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

Requirements:
- Use idiomatic {{TARGET_LANGUAGE}} patterns
- Preserve the same functionality
- Use equivalent libraries/frameworks
- Add type annotations where applicable
- Handle language-specific differences properly`,
  variables: [
    { name: 'SELECTED_CODE', description: 'Code to translate', required: true, type: 'selection' },
    { name: 'LANGUAGE', description: 'Source language', required: true, type: 'language' },
    { name: 'TARGET_LANGUAGE', description: 'Target language', required: true, type: 'string', default: 'Python' },
  ],
  temperature: 0.3,
})

registerTemplate({
  id: 'commit-message',
  name: 'Generate Commit Message',
  description: 'Generate a git commit message from a diff',
  category: 'generate',
  icon: '📋',
  template: `Generate a concise, conventional commit message for this diff:

\`\`\`diff
{{GIT_DIFF}}
\`\`\`

Format: <type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Keep the subject line under 72 characters
- Use imperative mood ("add" not "added")
- Include a brief body if the change is complex

Respond with ONLY the commit message (no markdown formatting).`,
  variables: [
    { name: 'GIT_DIFF', description: 'Git diff output', required: true, type: 'string' },
  ],
  temperature: 0.3,
  maxTokens: 256,
})

registerTemplate({
  id: 'implement-interface',
  name: 'Implement Interface',
  description: 'Generate implementation from a TypeScript interface',
  category: 'generate',
  icon: '🔧',
  template: `Generate a complete implementation for this TypeScript interface/type:

\`\`\`typescript
{{SELECTED_CODE}}
\`\`\`

Requirements:
- Implement all required methods and properties
- Include sensible default values
- Add error handling
- Follow existing code patterns in the file

Context:
\`\`\`typescript
{{FILE_CONTENT}}
\`\`\``,
  variables: [
    { name: 'SELECTED_CODE', description: 'Interface to implement', required: true, type: 'selection' },
    { name: 'FILE_CONTENT', description: 'Current file', required: false, type: 'file' },
  ],
  temperature: 0.4,
})

registerTemplate({
  id: 'regex-helper',
  name: 'Generate Regex',
  description: 'Create a regex pattern from a description',
  category: 'generate',
  icon: '🎯',
  template: `Create a regular expression that matches: {{DESCRIPTION}}

Requirements:
- Provide the regex pattern
- Explain each part of the pattern
- Include test cases showing matches and non-matches
- Use named capture groups where appropriate
- Show usage in {{LANGUAGE}}`,
  variables: [
    { name: 'DESCRIPTION', description: 'What the regex should match', required: true, type: 'string' },
    { name: 'LANGUAGE', description: 'Programming language for examples', required: true, type: 'language' },
  ],
  temperature: 0.3,
})

/* ── Quick Actions (slash commands) ───────────────────── */

export interface QuickAction {
  command: string
  name: string
  description: string
  templateId?: string
  handler?: (input: string, context: PromptContext) => CompiledPrompt
}

export const QUICK_ACTIONS: QuickAction[] = [
  { command: '/explain', name: 'Explain', description: 'Explain selected code', templateId: 'explain-code' },
  { command: '/fix', name: 'Fix', description: 'Fix a bug', templateId: 'fix-bug' },
  { command: '/test', name: 'Test', description: 'Generate tests', templateId: 'generate-tests' },
  { command: '/review', name: 'Review', description: 'Code review', templateId: 'code-review' },
  { command: '/doc', name: 'Document', description: 'Add documentation', templateId: 'add-documentation' },
  { command: '/optimize', name: 'Optimize', description: 'Optimize performance', templateId: 'optimize-performance' },
  { command: '/refactor', name: 'Refactor', description: 'Refactor code', templateId: 'refactor-code' },
  { command: '/translate', name: 'Translate', description: 'Translate to another language', templateId: 'translate-code' },
  { command: '/commit', name: 'Commit Message', description: 'Generate commit message', templateId: 'commit-message' },
  { command: '/implement', name: 'Implement', description: 'Implement interface', templateId: 'implement-interface' },
  { command: '/regex', name: 'Regex', description: 'Generate regex', templateId: 'regex-helper' },
]

export function findQuickAction(input: string): QuickAction | undefined {
  const cmd = input.split(/\s/)[0]?.toLowerCase()
  return QUICK_ACTIONS.find(a => a.command === cmd)
}

export function executeQuickAction(
  action: QuickAction,
  input: string,
  context: PromptContext
): CompiledPrompt | null {
  if (action.handler) {
    return action.handler(input, context)
  }

  if (action.templateId) {
    const template = getTemplate(action.templateId)
    if (template) {
      // Inject any additional input as a custom variable
      const userInput = input.replace(action.command, '').trim()
      const enrichedContext: PromptContext = {
        ...context,
        customVars: {
          ...context.customVars,
          DESCRIPTION: userInput || context.customVars?.DESCRIPTION || '',
          TARGET_LANGUAGE: userInput || 'Python',
        },
      }
      return compilePrompt(template, enrichedContext)
    }
  }

  return null
}
