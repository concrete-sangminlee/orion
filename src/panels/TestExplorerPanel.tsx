import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Play,
  RotateCw,
  ChevronRight,
  ChevronDown,
  Circle,
  CheckCircle2,
  XCircle,
  Loader2,
  Filter,
  FileText,
  FolderOpen,
  Clock,
  Bug,
  Search,
  SkipForward,
  Eye,
  EyeOff,
  BarChart3,
  FileCode,
  ExternalLink,
  Hash,
  Shield,
  Settings,
  RefreshCw,
  Trash2,
  ChevronUp,
  AlertTriangle,
  History,
  Zap,
  Tag,
  Terminal,
  Copy,
  X,
  Minus,
  Square,
  StepForward,
  ArrowDown,
  ArrowUp,
  Layers,
  Target,
  Pause,
  TrendingUp,
  Activity,
  ArrowUpDown,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════════ */

type TestStatus = 'idle' | 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'errored'

type TestFramework = 'jest' | 'vitest' | 'mocha' | 'pytest' | 'gotest'

type FilterMode = 'all' | 'passed' | 'failed' | 'skipped' | 'running'
type SortMode = 'name' | 'status' | 'duration' | 'recent'
type GroupMode = 'file' | 'suite' | 'flat'

interface TestOutput {
  stdout: string
  stderr: string
  assertionMessage?: string
  expected?: string
  actual?: string
  diff?: string
}

interface TestHistoryEntry {
  runId: string
  timestamp: number
  status: TestStatus
  duration?: number
}

interface TestCase {
  id: string
  name: string
  fullName: string
  status: TestStatus
  duration?: number
  output?: TestOutput
  tags: string[]
  line?: number
  column?: number
  history: TestHistoryEntry[]
  isFlaky: boolean
  retryCount: number
}

interface TestSuite {
  id: string
  name: string
  filePath: string
  framework: TestFramework
  status: TestStatus
  duration?: number
  expanded: boolean
  tests: TestCase[]
  coverage?: SuiteCoverage
  children: TestSuite[]
  depth: number
}

interface SuiteCoverage {
  linePct: number
  branchPct: number
  functionPct: number
  statementPct: number
  coveredLines: number
  totalLines: number
}

interface CoverageData {
  overall: number
  linePct: number
  branchPct: number
  functionPct: number
  files: CoverageFile[]
}

interface CoverageFile {
  path: string
  name: string
  linePct: number
  branchPct: number
  functionPct: number
  coveredLines: number
  totalLines: number
}

interface TestRunSummary {
  runId: string
  timestamp: number
  total: number
  passed: number
  failed: number
  skipped: number
  errored: number
  duration: number
}

interface FrameworkConfig {
  framework: TestFramework
  label: string
  command: string
  configFile: string
  watchFlag: string
  color: string
}

/* ══════════════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════════════ */

const FRAMEWORK_CONFIGS: FrameworkConfig[] = [
  { framework: 'jest', label: 'Jest', command: 'npx jest', configFile: 'jest.config.js', watchFlag: '--watch', color: 'var(--accent-red, #f85149)' },
  { framework: 'vitest', label: 'Vitest', command: 'npx vitest', configFile: 'vitest.config.ts', watchFlag: '--watch', color: 'var(--accent-green, #3fb950)' },
  { framework: 'mocha', label: 'Mocha', command: 'npx mocha', configFile: '.mocharc.yml', watchFlag: '--watch', color: 'var(--accent-yellow, #d29922)' },
  { framework: 'pytest', label: 'Pytest', command: 'python -m pytest', configFile: 'pytest.ini', watchFlag: '-f', color: 'var(--accent-blue, #388bfd)' },
  { framework: 'gotest', label: 'Go Test', command: 'go test', configFile: 'go.mod', watchFlag: '', color: 'var(--accent-cyan, #39d3ee)' },
]

const MAX_HISTORY_ENTRIES = 20

const STATUS_PRIORITY: Record<TestStatus, number> = {
  errored: 0,
  failed: 1,
  running: 2,
  queued: 3,
  skipped: 4,
  passed: 5,
  idle: 6,
}

/* ══════════════════════════════════════════════════════════════════
   Simulated Test Data
   ══════════════════════════════════════════════════════════════════ */

function makeTest(id: string, name: string, tags: string[] = [], line?: number): TestCase {
  return {
    id,
    name,
    fullName: name,
    status: 'idle',
    tags,
    line,
    history: [],
    isFlaky: false,
    retryCount: 0,
  }
}

function generateSuites(): TestSuite[] {
  return [
    {
      id: 'suite-auth',
      name: 'Authentication',
      filePath: 'src/services/__tests__/auth.test.ts',
      framework: 'vitest',
      status: 'idle',
      expanded: true,
      depth: 0,
      children: [],
      coverage: { linePct: 92.1, branchPct: 85.0, functionPct: 95.0, statementPct: 91.4, coveredLines: 184, totalLines: 200 },
      tests: [
        makeTest('auth-1', 'should login with valid credentials', ['auth', 'integration'], 15),
        makeTest('auth-2', 'should reject invalid password', ['auth', 'validation'], 32),
        makeTest('auth-3', 'should handle token refresh', ['auth', 'token'], 48),
        makeTest('auth-4', 'should logout and clear session', ['auth', 'session'], 65),
        makeTest('auth-5', 'should enforce rate limiting', ['auth', 'security', 'slow'], 82),
        makeTest('auth-6', 'should validate JWT structure', ['auth', 'token', 'validation'], 98),
        makeTest('auth-7', 'should handle concurrent login attempts', ['auth', 'concurrency'], 115),
      ],
    },
    {
      id: 'suite-editor',
      name: 'EditorStore',
      filePath: 'src/store/__tests__/editor.spec.ts',
      framework: 'vitest',
      status: 'idle',
      expanded: true,
      depth: 0,
      children: [],
      coverage: { linePct: 85.3, branchPct: 78.2, functionPct: 90.0, statementPct: 84.1, coveredLines: 256, totalLines: 300 },
      tests: [
        makeTest('editor-1', 'should open a file in a new tab', ['editor', 'tabs'], 12),
        makeTest('editor-2', 'should switch active tab', ['editor', 'tabs'], 28),
        makeTest('editor-3', 'should close tab and select neighbor', ['editor', 'tabs'], 45),
        makeTest('editor-4', 'should mark tab as modified on edit', ['editor', 'modified'], 62),
        makeTest('editor-5', 'should handle split editor groups', ['editor', 'split'], 78),
        makeTest('editor-6', 'should persist editor state to storage', ['editor', 'persistence'], 95),
        makeTest('editor-7', 'should undo/redo correctly', ['editor', 'history'], 112),
        makeTest('editor-8', 'should handle large files efficiently', ['editor', 'performance', 'slow'], 130),
      ],
    },
    {
      id: 'suite-fileops',
      name: 'FileOperations',
      filePath: 'src/services/__tests__/fileOps.test.ts',
      framework: 'jest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 78.0, branchPct: 72.5, functionPct: 82.0, statementPct: 76.8, coveredLines: 156, totalLines: 200 },
      tests: [
        makeTest('file-1', 'should read file contents', ['io', 'read'], 10),
        makeTest('file-2', 'should write file with encoding', ['io', 'write'], 25),
        makeTest('file-3', 'should create directory recursively', ['io', 'fs'], 40),
        makeTest('file-4', 'should delete file safely', ['io', 'delete'], 55),
        makeTest('file-5', 'should watch file for changes', ['io', 'watch', 'slow'], 70),
        makeTest('file-6', 'should handle symlinks', ['io', 'fs'], 88),
      ],
    },
    {
      id: 'suite-tabbar',
      name: 'TabBar',
      filePath: 'src/components/__tests__/TabBar.test.tsx',
      framework: 'vitest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 66.7, branchPct: 60.0, functionPct: 75.0, statementPct: 65.2, coveredLines: 100, totalLines: 150 },
      tests: [
        makeTest('tab-1', 'should render all open tabs', ['ui', 'render'], 8),
        makeTest('tab-2', 'should highlight active tab', ['ui', 'state'], 22),
        makeTest('tab-3', 'should show modified indicator', ['ui', 'modified'], 38),
        makeTest('tab-4', 'should close tab on middle click', ['ui', 'events'], 52),
        makeTest('tab-5', 'should support drag-and-drop reorder', ['ui', 'dnd', 'slow'], 68),
      ],
    },
    {
      id: 'suite-search',
      name: 'SearchService',
      filePath: 'src/services/__tests__/search.spec.ts',
      framework: 'jest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 71.4, branchPct: 65.0, functionPct: 80.0, statementPct: 70.0, coveredLines: 100, totalLines: 140 },
      tests: [
        makeTest('search-1', 'should find exact text matches', ['search'], 10),
        makeTest('search-2', 'should support regex patterns', ['search', 'regex'], 28),
        makeTest('search-3', 'should respect .gitignore exclusions', ['search', 'git'], 45),
        makeTest('search-4', 'should handle case-insensitive search', ['search'], 62),
        makeTest('search-5', 'should search with glob patterns', ['search', 'glob'], 78),
      ],
    },
    {
      id: 'suite-terminal',
      name: 'TerminalManager',
      filePath: 'src/services/__tests__/terminal.test.ts',
      framework: 'mocha',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 55.0, branchPct: 48.0, functionPct: 60.0, statementPct: 53.5, coveredLines: 55, totalLines: 100 },
      tests: [
        makeTest('term-1', 'should spawn shell process', ['terminal', 'spawn'], 5),
        makeTest('term-2', 'should write data to PTY', ['terminal', 'io'], 20),
        makeTest('term-3', 'should resize terminal', ['terminal', 'resize'], 38),
        makeTest('term-4', 'should handle ANSI escape codes', ['terminal', 'ansi'], 52),
      ],
    },
    {
      id: 'suite-config',
      name: 'ConfigParser',
      filePath: 'src/utils/__tests__/config.test.ts',
      framework: 'vitest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 62.5, branchPct: 55.0, functionPct: 70.0, statementPct: 60.8, coveredLines: 50, totalLines: 80 },
      tests: [
        makeTest('cfg-1', 'should parse JSON config', ['config', 'parse'], 8),
        makeTest('cfg-2', 'should merge user and default settings', ['config', 'merge'], 25),
        makeTest('cfg-3', 'should validate schema constraints', ['config', 'validation'], 42),
        makeTest('cfg-4', 'should handle missing config file gracefully', ['config', 'error'], 58),
      ],
    },
    {
      id: 'suite-api',
      name: 'APIClient',
      filePath: 'src/services/__tests__/api.test.ts',
      framework: 'jest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 81.2, branchPct: 74.0, functionPct: 88.0, statementPct: 79.5, coveredLines: 130, totalLines: 160 },
      tests: [
        makeTest('api-1', 'should send GET request', ['api', 'http'], 12),
        makeTest('api-2', 'should send POST with JSON body', ['api', 'http'], 30),
        makeTest('api-3', 'should handle 404 responses', ['api', 'errors'], 48),
        makeTest('api-4', 'should retry on network failure', ['api', 'retry', 'slow'], 65),
        makeTest('api-5', 'should respect timeout config', ['api', 'timeout'], 82),
        makeTest('api-6', 'should attach auth headers', ['api', 'auth'], 100),
      ],
    },
    {
      id: 'suite-git',
      name: 'GitIntegration',
      filePath: 'src/services/__tests__/git.test.ts',
      framework: 'vitest',
      status: 'idle',
      expanded: false,
      depth: 0,
      children: [],
      coverage: { linePct: 73.6, branchPct: 68.0, functionPct: 78.0, statementPct: 72.0, coveredLines: 110, totalLines: 150 },
      tests: [
        makeTest('git-1', 'should detect repository root', ['git'], 10),
        makeTest('git-2', 'should parse git status output', ['git', 'parse'], 28),
        makeTest('git-3', 'should stage files', ['git', 'staging'], 45),
        makeTest('git-4', 'should create commit', ['git', 'commit'], 62),
        makeTest('git-5', 'should handle merge conflicts', ['git', 'merge'], 80),
      ],
    },
  ]
}

function generateCoverage(): CoverageData {
  return {
    overall: 74.2,
    linePct: 74.2,
    branchPct: 67.3,
    functionPct: 79.8,
    files: [
      { path: 'src/services/auth.ts', name: 'auth.ts', linePct: 92.1, branchPct: 85.0, functionPct: 95.0, coveredLines: 184, totalLines: 200 },
      { path: 'src/store/editor.ts', name: 'editor.ts', linePct: 85.3, branchPct: 78.2, functionPct: 90.0, coveredLines: 256, totalLines: 300 },
      { path: 'src/services/fileOps.ts', name: 'fileOps.ts', linePct: 78.0, branchPct: 72.5, functionPct: 82.0, coveredLines: 156, totalLines: 200 },
      { path: 'src/services/api.ts', name: 'api.ts', linePct: 81.2, branchPct: 74.0, functionPct: 88.0, coveredLines: 130, totalLines: 160 },
      { path: 'src/components/TabBar.tsx', name: 'TabBar.tsx', linePct: 66.7, branchPct: 60.0, functionPct: 75.0, coveredLines: 100, totalLines: 150 },
      { path: 'src/services/search.ts', name: 'search.ts', linePct: 71.4, branchPct: 65.0, functionPct: 80.0, coveredLines: 100, totalLines: 140 },
      { path: 'src/services/git.ts', name: 'git.ts', linePct: 73.6, branchPct: 68.0, functionPct: 78.0, coveredLines: 110, totalLines: 150 },
      { path: 'src/services/terminal.ts', name: 'terminal.ts', linePct: 55.0, branchPct: 48.0, functionPct: 60.0, coveredLines: 55, totalLines: 100 },
      { path: 'src/utils/config.ts', name: 'config.ts', linePct: 62.5, branchPct: 55.0, functionPct: 70.0, coveredLines: 50, totalLines: 80 },
    ],
  }
}

/* ══════════════════════════════════════════════════════════════════
   Test Runner Simulation
   ══════════════════════════════════════════════════════════════════ */

function generateErrorOutput(testName: string, filePath: string): TestOutput {
  const line = Math.floor(10 + Math.random() * 200)
  const col = Math.floor(1 + Math.random() * 40)
  const errors = [
    { msg: 'AssertionError: expected true to be false', expected: 'true', actual: 'false' },
    { msg: `TypeError: Cannot read properties of undefined (reading 'id')`, expected: undefined, actual: undefined },
    { msg: 'Error: Timeout - Async callback was not invoked within 5000ms', expected: undefined, actual: undefined },
    { msg: 'expect(received).toBe(expected)\n\nExpected: 200\nReceived: 401', expected: '200', actual: '401' },
    { msg: 'Error: connect ECONNREFUSED 127.0.0.1:3000', expected: undefined, actual: undefined },
    { msg: 'ReferenceError: mockService is not defined', expected: undefined, actual: undefined },
  ]
  const err = errors[Math.floor(Math.random() * errors.length)]
  const stack = [
    `    at Object.<anonymous> (${filePath}:${line}:${col})`,
    `    at Promise.then.completed (node_modules/jest-circus/build/utils.js:298:28)`,
    `    at new Promise (<anonymous>)`,
    `    at callAsyncCircusFn (node_modules/jest-circus/build/utils.js:231:10)`,
  ].join('\n')

  return {
    stdout: `  ${testName}\n`,
    stderr: `${err.msg}\n\n${stack}`,
    assertionMessage: err.msg,
    expected: err.expected ?? (testName.includes('login') ? '{ status: 200, token: "abc123" }' : '"expected value"'),
    actual: err.actual ?? (testName.includes('login') ? '{ status: 401, error: "Unauthorized" }' : '"actual value"'),
    diff: err.expected ? `- Expected\n+ Received\n\n- ${err.expected}\n+ ${err.actual}` : undefined,
  }
}

function generatePassOutput(testName: string): TestOutput {
  return {
    stdout: `  \u2713 ${testName}\n`,
    stderr: '',
  }
}

let runIdCounter = 0

async function simulateTestRun(
  suites: TestSuite[],
  testFilter?: (test: TestCase) => boolean,
  onUpdate?: (suites: TestSuite[]) => void,
  signal?: AbortSignal,
): Promise<TestSuite[]> {
  const runId = `run-${++runIdCounter}`
  const results = suites.map((s) => ({
    ...s,
    tests: s.tests.map((t) => ({ ...t })),
  }))

  // Queue matching tests
  for (const suite of results) {
    let hasMatch = false
    for (const test of suite.tests) {
      if (!testFilter || testFilter(test)) {
        test.status = 'queued' as TestStatus
        hasMatch = true
      }
    }
    if (hasMatch) {
      suite.status = 'queued'
      suite.expanded = true
    }
  }
  onUpdate?.([...results.map((s) => ({ ...s, tests: [...s.tests] }))])

  for (const suite of results) {
    if (suite.status !== 'queued') continue
    if (signal?.aborted) break

    suite.status = 'running'
    const suiteStart = Date.now()

    for (const test of suite.tests) {
      if (test.status !== 'queued') continue
      if (signal?.aborted) break

      test.status = 'running'
      onUpdate?.([...results.map((s) => ({ ...s, tests: [...s.tests] }))])

      await new Promise((r) => setTimeout(r, 60 + Math.random() * 220))

      const roll = Math.random()
      const duration = Math.floor(5 + Math.random() * 200)
      test.duration = duration

      if (roll < 0.62) {
        test.status = 'passed'
        test.output = generatePassOutput(test.name)
      } else if (roll < 0.82) {
        test.status = 'failed'
        test.duration = Math.floor(30 + Math.random() * 350)
        test.output = generateErrorOutput(test.name, suite.filePath)
      } else if (roll < 0.92) {
        test.status = 'skipped'
        test.duration = undefined
        test.output = { stdout: `  - ${test.name} (skipped)\n`, stderr: '' }
      } else {
        test.status = 'errored'
        test.duration = Math.floor(10 + Math.random() * 50)
        test.output = {
          stdout: '',
          stderr: `Error: Test setup failed\n    at beforeEach (${suite.filePath}:5:10)`,
          assertionMessage: 'Test setup failed',
        }
      }

      // Update history
      test.history = [
        { runId, timestamp: Date.now(), status: test.status, duration: test.duration },
        ...test.history.slice(0, MAX_HISTORY_ENTRIES - 1),
      ]

      // Detect flakiness: if recent history has mixed pass/fail results
      if (test.history.length >= 3) {
        const recent = test.history.slice(0, 5)
        const statuses = new Set(recent.map((h) => h.status).filter((s) => s !== 'skipped'))
        test.isFlaky = statuses.size > 1
      }

      onUpdate?.([...results.map((s) => ({ ...s, tests: [...s.tests] }))])
    }

    suite.duration = Date.now() - suiteStart
    const testStatuses = suite.tests.filter((t) => testFilter ? testFilter(t) || t.status !== 'idle' : true)
    if (testStatuses.some((t) => t.status === 'failed' || t.status === 'errored')) {
      suite.status = 'failed'
    } else if (testStatuses.every((t) => t.status === 'passed' || t.status === 'skipped' || t.status === 'idle')) {
      suite.status = testStatuses.some((t) => t.status === 'passed') ? 'passed' : 'skipped'
    }
    onUpdate?.([...results.map((s) => ({ ...s, tests: [...s.tests] }))])
  }

  return results
}

/* ══════════════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════════════ */

function getFrameworkConfig(fw: TestFramework): FrameworkConfig {
  return FRAMEWORK_CONFIGS.find((c) => c.framework === fw) ?? FRAMEWORK_CONFIGS[0]
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function coverageColor(pct: number): string {
  if (pct >= 80) return 'var(--accent-green, #3fb950)'
  if (pct >= 60) return 'var(--accent-yellow, #d29922)'
  return 'var(--accent-red, #f85149)'
}

function statusColor(status: TestStatus): string {
  switch (status) {
    case 'passed': return 'var(--accent-green, #3fb950)'
    case 'failed': return 'var(--accent-red, #f85149)'
    case 'errored': return 'var(--accent-orange, #db6d28)'
    case 'skipped': return 'var(--accent-yellow, #d29922)'
    case 'running': return 'var(--accent-blue, #388bfd)'
    case 'queued': return 'var(--text-muted, #8b949e)'
    default: return 'var(--text-muted, #8b949e)'
  }
}

function getAllTags(suites: TestSuite[]): string[] {
  const tags = new Set<string>()
  for (const suite of suites) {
    for (const test of suite.tests) {
      for (const tag of test.tags) {
        tags.add(tag)
      }
    }
  }
  return Array.from(tags).sort()
}

function countByStatus(suites: TestSuite[]): Record<TestStatus, number> {
  const counts: Record<TestStatus, number> = { idle: 0, queued: 0, running: 0, passed: 0, failed: 0, skipped: 0, errored: 0 }
  for (const suite of suites) {
    for (const test of suite.tests) {
      counts[test.status]++
    }
  }
  return counts
}

function totalTests(suites: TestSuite[]): number {
  return suites.reduce((acc, s) => acc + s.tests.length, 0)
}

/* ══════════════════════════════════════════════════════════════════
   Styles (CSS-variable driven)
   ══════════════════════════════════════════════════════════════════ */

const S = {
  panel: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--bg-secondary, #1e1e1e)',
    color: 'var(--text-primary, #cccccc)',
    overflow: 'hidden',
    fontSize: 12,
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: '1px solid var(--border, #333)',
    gap: 4,
    flexShrink: 0,
    background: 'var(--bg-secondary, #1e1e1e)',
  },
  toolbarGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  toolbarDivider: {
    width: 1,
    height: 16,
    background: 'var(--border, #333)',
    margin: '0 4px',
    flexShrink: 0,
  },
  searchContainer: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    background: 'var(--bg-primary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: 3,
    padding: '0 6px',
    gap: 4,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: '3px 0',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary, #cccccc)',
    fontSize: 11,
    fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
    outline: 'none',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderBottom: '1px solid var(--border, #333)',
    gap: 4,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  filterChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border, #333)',
    transition: 'all 0.15s',
    userSelect: 'none' as const,
    background: 'none',
  },
  treeContainer: {
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
  },
  suiteRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '4px 8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-primary, #cccccc)',
    fontSize: 12,
    cursor: 'pointer',
    gap: 4,
    userSelect: 'none' as const,
    textAlign: 'left' as const,
  },
  testRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '3px 8px 3px 36px',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary, #999)',
    fontSize: 11,
    cursor: 'pointer',
    gap: 6,
    userSelect: 'none' as const,
    textAlign: 'left' as const,
  },
  outputBlock: {
    margin: '0 8px 4px 36px',
    padding: '6px 10px',
    background: 'var(--bg-primary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: '0 4px 4px 0',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    lineHeight: 1.5,
    overflow: 'auto',
    maxHeight: 240,
  },
  errorBlock: {
    margin: '0 8px 4px 36px',
    padding: '6px 10px',
    background: 'var(--bg-primary, #1a1a1a)',
    border: '1px solid var(--accent-red, #f85149)',
    borderLeft: '3px solid var(--accent-red, #f85149)',
    borderRadius: '0 4px 4px 0',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    lineHeight: 1.5,
    overflow: 'auto',
    maxHeight: 240,
  },
  diffContainer: {
    marginTop: 6,
    borderRadius: 3,
    overflow: 'hidden',
    border: '1px solid var(--border, #333)',
  },
  diffHeader: {
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.3px',
    textTransform: 'uppercase' as const,
  },
  diffLine: {
    padding: '2px 8px',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  coverageBar: {
    height: 6,
    borderRadius: 3,
    background: 'var(--bg-tertiary, #2a2a2a)',
    overflow: 'hidden',
    flex: 1,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderTop: '1px solid var(--border, #333)',
    fontSize: 11,
    color: 'var(--text-muted, #666)',
    flexShrink: 0,
    gap: 8,
    background: 'var(--bg-secondary, #1e1e1e)',
    flexWrap: 'wrap' as const,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 16,
    padding: '0 5px',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--text-muted, #666)',
    borderBottom: '1px solid var(--border, #333)',
    background: 'var(--bg-tertiary, #2a2a2a)',
    gap: 6,
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  tagBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 5px',
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 600,
    background: 'var(--bg-tertiary, #2a2a2a)',
    color: 'var(--text-muted, #666)',
    border: '1px solid var(--border, #333)',
  },
  dropdownOverlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 999,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: 2,
    background: 'var(--bg-primary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: 1000,
    minWidth: 180,
    maxHeight: 300,
    overflow: 'auto',
    padding: '4px 0',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '5px 12px',
    background: 'none',
    border: 'none',
    color: 'var(--text-primary, #cccccc)',
    fontSize: 12,
    cursor: 'pointer',
    gap: 8,
    textAlign: 'left' as const,
  },
} as const

/* ══════════════════════════════════════════════════════════════════
   Sub-Components
   ══════════════════════════════════════════════════════════════════ */

function IconBtn({
  icon: Icon,
  title,
  onClick,
  size = 14,
  disabled = false,
  color,
  active = false,
}: {
  icon: typeof Play
  title: string
  onClick?: () => void
  size?: number
  disabled?: boolean
  color?: string
  active?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? 'var(--bg-tertiary, #2a2a2a)' : hovered ? 'var(--bg-hover, #ffffff10)' : 'none',
        border: 'none',
        color: disabled ? 'var(--text-disabled, #555)' : color ?? 'var(--text-secondary, #999)',
        cursor: disabled ? 'default' : 'pointer',
        padding: 4,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, opacity 0.12s',
      }}
    >
      <Icon size={size} />
    </button>
  )
}

function StatusIcon({ status, size = 14 }: { status: TestStatus; size?: number }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={size} style={{ color: statusColor('passed'), flexShrink: 0 }} />
    case 'failed':
      return <XCircle size={size} style={{ color: statusColor('failed'), flexShrink: 0 }} />
    case 'errored':
      return <AlertTriangle size={size} style={{ color: statusColor('errored'), flexShrink: 0 }} />
    case 'skipped':
      return <Minus size={size} style={{ color: statusColor('skipped'), flexShrink: 0 }} />
    case 'running':
      return <Loader2 size={size} style={{ color: statusColor('running'), flexShrink: 0, animation: 'spin 1s linear infinite' }} />
    case 'queued':
      return <Clock size={size} style={{ color: statusColor('queued'), flexShrink: 0 }} />
    default:
      return <Circle size={size} style={{ color: statusColor('idle'), flexShrink: 0 }} />
  }
}

function CoverageBarInline({ pct, width = 60 }: { pct: number; width?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <div style={{ ...S.coverageBar, width, flex: 'none' }}>
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            background: coverageColor(pct),
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: coverageColor(pct), fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function FrameworkBadge({ framework }: { framework: TestFramework }) {
  const config = getFrameworkConfig(framework)
  return (
    <span
      style={{
        ...S.badge,
        background: `${config.color}20`,
        color: config.color,
        fontSize: 9,
        padding: '0 4px',
        height: 14,
        minWidth: 'auto',
      }}
    >
      {config.label}
    </span>
  )
}

function FlakyBadge() {
  return (
    <span
      title="Flaky test - inconsistent results across recent runs"
      style={{
        ...S.badge,
        background: 'var(--accent-orange, #db6d28)20',
        color: 'var(--accent-orange, #db6d28)',
        fontSize: 9,
        padding: '0 4px',
        height: 14,
        minWidth: 'auto',
        gap: 2,
      }}
    >
      <Zap size={8} />
      Flaky
    </span>
  )
}

function TestHistoryBar({ history }: { history: TestHistoryEntry[] }) {
  if (history.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} title="Recent run history">
      {history.slice(0, 10).reverse().map((entry, i) => (
        <div
          key={i}
          style={{
            ...S.historyDot,
            background: statusColor(entry.status),
            opacity: 0.5 + (i / 10) * 0.5,
          }}
          title={`${entry.status} - ${entry.duration ? formatDuration(entry.duration) : 'n/a'}`}
        />
      ))}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Test Output Viewer
   ══════════════════════════════════════════════════════════════════ */

function TestOutputViewer({ test, status }: { test: TestCase; status: TestStatus }) {
  const output = test.output
  if (!output) return null

  const isError = status === 'failed' || status === 'errored'

  return (
    <div style={isError ? S.errorBlock : S.outputBlock}>
      {/* Assertion message */}
      {output.assertionMessage && (
        <div style={{ color: statusColor('failed'), marginBottom: 4, fontWeight: 600 }}>
          {output.assertionMessage}
        </div>
      )}

      {/* Stdout */}
      {output.stdout && (
        <div style={{ color: 'var(--text-secondary, #999)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {output.stdout}
        </div>
      )}

      {/* Stderr */}
      {output.stderr && (
        <div style={{ color: 'var(--accent-red, #f85149)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.85 }}>
          {output.stderr}
        </div>
      )}

      {/* Expected vs Actual diff */}
      {(output.expected || output.actual) && (
        <div style={S.diffContainer}>
          <div
            style={{
              ...S.diffHeader,
              background: 'rgba(63, 185, 80, 0.1)',
              color: 'var(--accent-green, #3fb950)',
            }}
          >
            Expected
          </div>
          <div
            style={{
              ...S.diffLine,
              background: 'rgba(63, 185, 80, 0.05)',
              color: 'var(--accent-green, #3fb950)',
            }}
          >
            {output.expected ?? 'undefined'}
          </div>
          <div
            style={{
              ...S.diffHeader,
              background: 'rgba(248, 81, 73, 0.1)',
              color: 'var(--accent-red, #f85149)',
            }}
          >
            Received
          </div>
          <div
            style={{
              ...S.diffLine,
              background: 'rgba(248, 81, 73, 0.05)',
              color: 'var(--accent-red, #f85149)',
            }}
          >
            {output.actual ?? 'undefined'}
          </div>
        </div>
      )}

      {/* Diff output when no structured expected/actual */}
      {output.diff && !output.expected && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted, #666)', marginBottom: 2 }}>DIFF</div>
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary, #999)' }}>
            {output.diff.split('\n').map((line, i) => (
              <div
                key={i}
                style={{
                  color: line.startsWith('-') ? 'var(--accent-red, #f85149)' : line.startsWith('+') ? 'var(--accent-green, #3fb950)' : undefined,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duration */}
      {test.duration !== undefined && (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted, #666)' }}>
          <Clock size={9} style={{ verticalAlign: 'middle', marginRight: 3 }} />
          {formatDuration(test.duration)}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Coverage Section
   ══════════════════════════════════════════════════════════════════ */

function CoverageSummarySection({
  coverage,
  expanded,
  onToggle,
}: {
  coverage: CoverageData
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <div style={S.sectionHeader} onClick={onToggle}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <BarChart3 size={12} />
        <span style={{ flex: 1 }}>Coverage</span>
        <CoverageBarInline pct={coverage.overall} width={50} />
      </div>
      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {/* Summary metrics row */}
          <div style={{ display: 'flex', padding: '4px 14px', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Lines', pct: coverage.linePct },
              { label: 'Branches', pct: coverage.branchPct },
              { label: 'Functions', pct: coverage.functionPct },
            ].map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted, #666)' }}>{m.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: coverageColor(m.pct) }}>{m.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          {/* Per-file coverage rows */}
          {coverage.files.map((file) => (
            <div
              key={file.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 14px 3px 24px',
                gap: 6,
                fontSize: 11,
                cursor: 'pointer',
              }}
              title={`${file.path} - ${file.coveredLines}/${file.totalLines} lines`}
            >
              <FileCode size={12} style={{ color: 'var(--text-muted, #666)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <CoverageBarInline pct={file.linePct} width={40} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Run History Section
   ══════════════════════════════════════════════════════════════════ */

function RunHistorySection({
  history,
  expanded,
  onToggle,
}: {
  history: TestRunSummary[]
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <div style={S.sectionHeader} onClick={onToggle}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} />
        <span style={{ flex: 1 }}>Run History</span>
        <span style={{ fontSize: 10, fontWeight: 400 }}>{history.length} runs</span>
      </div>
      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {history.length === 0 ? (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted, #666)' }}>
              No test runs yet
            </div>
          ) : (
            history.slice(0, 10).map((run) => (
              <div
                key={run.runId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 14px',
                  gap: 8,
                  fontSize: 11,
                  borderBottom: '1px solid var(--border, #333)08',
                }}
              >
                <StatusIcon status={run.failed > 0 ? 'failed' : run.errored > 0 ? 'errored' : 'passed'} size={12} />
                <span style={{ flex: 1, color: 'var(--text-secondary, #999)' }}>
                  {new Date(run.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ color: statusColor('passed'), fontSize: 10 }}>{run.passed}</span>
                <span style={{ color: 'var(--text-muted, #666)', fontSize: 10 }}>/</span>
                <span style={{ color: statusColor('failed'), fontSize: 10 }}>{run.failed}</span>
                <span style={{ color: 'var(--text-muted, #666)', fontSize: 10 }}>/</span>
                <span style={{ color: statusColor('skipped'), fontSize: 10 }}>{run.skipped}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted, #666)', minWidth: 40, textAlign: 'right' }}>
                  {formatDuration(run.duration)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Framework Selector Dropdown
   ══════════════════════════════════════════════════════════════════ */

function FrameworkSelector({
  selected,
  onSelect,
}: {
  selected: TestFramework
  onSelect: (fw: TestFramework) => void
}) {
  const [open, setOpen] = useState(false)
  const config = getFrameworkConfig(selected)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          ...S.filterChip,
          background: `${config.color}15`,
          borderColor: `${config.color}40`,
          color: config.color,
        }}
      >
        <Settings size={10} />
        {config.label}
        <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div style={S.dropdownOverlay} onClick={() => setOpen(false)} />
          <div style={S.dropdown}>
            {FRAMEWORK_CONFIGS.map((fw) => (
              <button
                key={fw.framework}
                style={{
                  ...S.dropdownItem,
                  background: fw.framework === selected ? 'var(--bg-tertiary, #2a2a2a)' : undefined,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #ffffff10)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = fw.framework === selected ? 'var(--bg-tertiary, #2a2a2a)' : 'none' }}
                onClick={() => {
                  onSelect(fw.framework)
                  setOpen(false)
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: fw.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{fw.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted, #666)' }}>{fw.command}</span>
                {fw.framework === selected && <CheckCircle2 size={12} style={{ color: fw.color }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Tag Filter Dropdown
   ══════════════════════════════════════════════════════════════════ */

function TagFilterDropdown({
  allTags,
  selectedTags,
  onToggleTag,
}: {
  allTags: string[]
  selectedTags: Set<string>
  onToggleTag: (tag: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          ...S.filterChip,
          background: selectedTags.size > 0 ? 'var(--accent, #388bfd)15' : 'none',
          borderColor: selectedTags.size > 0 ? 'var(--accent, #388bfd)40' : undefined,
          color: selectedTags.size > 0 ? 'var(--accent, #388bfd)' : 'var(--text-muted, #666)',
        }}
      >
        <Tag size={10} />
        Tags{selectedTags.size > 0 ? ` (${selectedTags.size})` : ''}
        <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div style={S.dropdownOverlay} onClick={() => setOpen(false)} />
          <div style={S.dropdown}>
            {selectedTags.size > 0 && (
              <button
                style={{ ...S.dropdownItem, color: 'var(--accent-red, #f85149)', borderBottom: '1px solid var(--border, #333)', marginBottom: 2 }}
                onClick={() => {
                  selectedTags.forEach((t) => onToggleTag(t))
                  setOpen(false)
                }}
              >
                <X size={12} />
                Clear all tags
              </button>
            )}
            {allTags.map((tag) => (
              <button
                key={tag}
                style={{
                  ...S.dropdownItem,
                  background: selectedTags.has(tag) ? 'var(--bg-tertiary, #2a2a2a)' : undefined,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #ffffff10)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selectedTags.has(tag) ? 'var(--bg-tertiary, #2a2a2a)' : 'none' }}
                onClick={() => onToggleTag(tag)}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: '1px solid var(--border, #333)',
                    background: selectedTags.has(tag) ? 'var(--accent, #388bfd)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 10,
                    color: '#fff',
                  }}
                >
                  {selectedTags.has(tag) ? '\u2713' : ''}
                </span>
                <span style={{ flex: 1 }}>{tag}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════ */

export default function TestExplorerPanel() {
  /* ── State ── */
  const [suites, setSuites] = useState<TestSuite[]>(() => generateSuites())
  const [coverage, setCoverage] = useState<CoverageData>(() => generateCoverage())
  const [runHistory, setRunHistory] = useState<TestRunSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [groupMode, setGroupMode] = useState<GroupMode>('file')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [watchMode, setWatchMode] = useState(false)
  const [showCoverage, setShowCoverage] = useState(true)
  const [coverageExpanded, setCoverageExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [selectedFramework, setSelectedFramework] = useState<TestFramework>('vitest')
  const [autoExpandFailed, setAutoExpandFailed] = useState(true)
  const [showFilterBar, setShowFilterBar] = useState(true)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const suitesRef = useRef(suites)
  suitesRef.current = suites
  const treeRef = useRef<HTMLDivElement>(null)
  const watchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const allTags = useMemo(() => getAllTags(suites), [suites])
  const counts = useMemo(() => countByStatus(suites), [suites])
  const total = useMemo(() => totalTests(suites), [suites])

  /* ── Keyframe animation for spinner ── */
  const spinStyle = useMemo(
    () => `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`,
    [],
  )

  /* ── Filtered & sorted suites ── */
  const filteredSuites = useMemo(() => {
    let result = suites.map((suite) => {
      let tests = suite.tests

      // Text search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        tests = tests.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.fullName.toLowerCase().includes(q) ||
            t.tags.some((tag) => tag.toLowerCase().includes(q)),
        )
      }

      // Status filter
      if (filterMode !== 'all') {
        tests = tests.filter((t) => t.status === filterMode)
      }

      // Tag filter
      if (selectedTags.size > 0) {
        tests = tests.filter((t) => t.tags.some((tag) => selectedTags.has(tag)))
      }

      // Sort tests within each suite
      const sorted = [...tests]
      switch (sortMode) {
        case 'name':
          sorted.sort((a, b) => a.name.localeCompare(b.name))
          break
        case 'status':
          sorted.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status])
          break
        case 'duration':
          sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
          break
        case 'recent':
          sorted.sort((a, b) => {
            const aTs = a.history[0]?.timestamp ?? 0
            const bTs = b.history[0]?.timestamp ?? 0
            return bTs - aTs
          })
          break
      }

      return { ...suite, tests: sorted }
    })

    // Filter out empty suites when filters are active
    if (searchQuery || filterMode !== 'all' || selectedTags.size > 0) {
      result = result.filter((s) => s.tests.length > 0)
    }

    return result
  }, [suites, searchQuery, filterMode, selectedTags, sortMode])

  /* ── Flat item list for keyboard navigation ── */
  const flatItems = useMemo(() => {
    const items: Array<{ type: 'suite' | 'test'; suiteId: string; testId?: string }> = []
    for (const suite of filteredSuites) {
      items.push({ type: 'suite', suiteId: suite.id })
      if (suite.expanded) {
        for (const test of suite.tests) {
          items.push({ type: 'test', suiteId: suite.id, testId: test.id })
        }
      }
    }
    return items
  }, [filteredSuites])

  /* ── Callbacks ── */
  const toggleSuiteExpanded = useCallback((suiteId: string) => {
    setSuites((prev) =>
      prev.map((s) => (s.id === suiteId ? { ...s, expanded: !s.expanded } : s)),
    )
  }, [])

  const toggleOutputExpanded = useCallback((testId: string) => {
    setExpandedOutputs((prev) => {
      const next = new Set(prev)
      if (next.has(testId)) next.delete(testId)
      else next.add(testId)
      return next
    })
  }, [])

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])

  /* ── Run tests ── */
  const runTests = useCallback(
    async (filter?: (test: TestCase) => boolean) => {
      if (isRunning) return
      setIsRunning(true)
      abortRef.current = new AbortController()

      const startTime = Date.now()
      const results = await simulateTestRun(suitesRef.current, filter, setSuites, abortRef.current.signal)

      setSuites(results)
      setIsRunning(false)

      // Auto-expand failed test outputs
      if (autoExpandFailed) {
        const failedIds = new Set<string>()
        for (const suite of results) {
          for (const test of suite.tests) {
            if (test.status === 'failed' || test.status === 'errored') {
              failedIds.add(test.id)
            }
          }
        }
        setExpandedOutputs((prev) => new Set([...prev, ...failedIds]))
      }

      // Record run summary in history
      const c = countByStatus(results)
      const summary: TestRunSummary = {
        runId: `run-${Date.now()}`,
        timestamp: Date.now(),
        total: totalTests(results),
        passed: c.passed,
        failed: c.failed,
        skipped: c.skipped,
        errored: c.errored,
        duration: Date.now() - startTime,
      }
      setRunHistory((prev) => [summary, ...prev.slice(0, 19)])
    },
    [isRunning, autoExpandFailed],
  )

  const runAllTests = useCallback(() => runTests(), [runTests])

  const runFailedTests = useCallback(
    () => runTests((t) => t.status === 'failed' || t.status === 'errored'),
    [runTests],
  )

  const runSuiteTests = useCallback(
    (suiteId: string) => {
      const suite = suitesRef.current.find((s) => s.id === suiteId)
      if (!suite) return
      const testIds = new Set(suite.tests.map((t) => t.id))
      runTests((t) => testIds.has(t.id))
    },
    [runTests],
  )

  const runSingleTest = useCallback(
    (testId: string) => runTests((t) => t.id === testId),
    [runTests],
  )

  const debugTest = useCallback((testId: string) => {
    // In production this would launch a debug session via the debug adapter
    const test = suitesRef.current.flatMap((s) => s.tests).find((t) => t.id === testId)
    if (test) {
      console.log(`[TestExplorer] Debug test: ${test.name}`)
    }
  }, [])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setSuites((prev) =>
      prev.map((s) => ({
        ...s,
        status: s.status === 'running' || s.status === 'queued' ? 'idle' : s.status,
        tests: s.tests.map((t) => ({
          ...t,
          status: t.status === 'running' || t.status === 'queued' ? 'idle' : t.status,
        })),
      })),
    )
  }, [])

  const resetAllTests = useCallback(() => {
    setSuites((prev) =>
      prev.map((s) => ({
        ...s,
        status: 'idle',
        duration: undefined,
        tests: s.tests.map((t) => ({
          ...t,
          status: 'idle',
          duration: undefined,
          output: undefined,
        })),
      })),
    )
    setExpandedOutputs(new Set())
  }, [])

  const expandAll = useCallback(() => {
    setSuites((prev) => prev.map((s) => ({ ...s, expanded: true })))
  }, [])

  const collapseAll = useCallback(() => {
    setSuites((prev) => prev.map((s) => ({ ...s, expanded: false })))
  }, [])

  /* ── Watch mode auto-run ── */
  useEffect(() => {
    if (watchMode && !isRunning) {
      watchIntervalRef.current = setInterval(() => {
        if (!isRunning) {
          runAllTests()
        }
      }, 8000)
    }
    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current)
        watchIntervalRef.current = null
      }
    }
  }, [watchMode, isRunning, runAllTests])

  /* ── Keyboard navigation ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const len = flatItems.length
      if (len === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((prev) => Math.min(prev + 1, len - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'ArrowRight': {
          e.preventDefault()
          const item = flatItems[focusedIndex]
          if (item?.type === 'suite') {
            const suite = filteredSuites.find((s) => s.id === item.suiteId)
            if (suite && !suite.expanded) {
              toggleSuiteExpanded(item.suiteId)
            }
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const item = flatItems[focusedIndex]
          if (item?.type === 'suite') {
            const suite = filteredSuites.find((s) => s.id === item.suiteId)
            if (suite && suite.expanded) {
              toggleSuiteExpanded(item.suiteId)
            }
          } else if (item?.type === 'test') {
            // Navigate up to parent suite
            const parentIdx = flatItems.findIndex(
              (fi) => fi.type === 'suite' && fi.suiteId === item.suiteId,
            )
            if (parentIdx >= 0) setFocusedIndex(parentIdx)
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          const item = flatItems[focusedIndex]
          if (item?.type === 'suite') {
            toggleSuiteExpanded(item.suiteId)
          } else if (item?.type === 'test') {
            toggleOutputExpanded(item.testId!)
          }
          break
        }
        case ' ': {
          e.preventDefault()
          const item = flatItems[focusedIndex]
          if (item?.type === 'test' && item.testId) {
            runSingleTest(item.testId)
          } else if (item?.type === 'suite') {
            runSuiteTests(item.suiteId)
          }
          break
        }
        case 'd':
        case 'D': {
          const item = flatItems[focusedIndex]
          if (item?.type === 'test' && item.testId) {
            e.preventDefault()
            debugTest(item.testId)
          }
          break
        }
        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(len - 1)
          break
        case 'Escape':
          if (isRunning) {
            e.preventDefault()
            cancelRun()
          }
          break
      }
    },
    [flatItems, focusedIndex, filteredSuites, toggleSuiteExpanded, toggleOutputExpanded, runSingleTest, runSuiteTests, debugTest, isRunning, cancelRun],
  )

  /* ── Scroll focused item into view ── */
  useEffect(() => {
    if (focusedIndex >= 0 && treeRef.current) {
      const el = treeRef.current.querySelector(`[data-tree-index="${focusedIndex}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  /* ── Progress calculation ── */
  const progressPct = useMemo(() => {
    if (!isRunning) return 0
    const completed = counts.passed + counts.failed + counts.skipped + counts.errored
    return total > 0 ? (completed / total) * 100 : 0
  }, [isRunning, counts, total])

  /* ── Render ── */
  let treeIndex = 0

  return (
    <div style={S.panel}>
      {/* Inject spin keyframe animation */}
      <style>{spinStyle}</style>

      {/* ── Top Toolbar ── */}
      <div style={S.toolbar}>
        <div style={S.toolbarGroup}>
          {isRunning ? (
            <IconBtn icon={Square} title="Cancel Run (Esc)" onClick={cancelRun} color="var(--accent-red, #f85149)" />
          ) : (
            <IconBtn icon={Play} title="Run All Tests" onClick={runAllTests} color="var(--accent-green, #3fb950)" />
          )}
          <IconBtn
            icon={RotateCw}
            title="Re-run Failed Tests"
            onClick={runFailedTests}
            disabled={isRunning || counts.failed + counts.errored === 0}
          />
          <IconBtn icon={RefreshCw} title="Reset All Tests" onClick={resetAllTests} disabled={isRunning} />
        </div>

        <div style={S.toolbarDivider} />

        {/* Search input */}
        <div style={S.searchContainer}>
          <Search size={12} style={{ color: 'var(--text-muted, #666)', flexShrink: 0 }} />
          <input
            style={S.searchInput}
            placeholder="Filter tests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            spellCheck={false}
          />
          {searchQuery && (
            <IconBtn icon={X} title="Clear search" size={11} onClick={() => setSearchQuery('')} />
          )}
        </div>

        <div style={S.toolbarDivider} />

        <div style={S.toolbarGroup}>
          <IconBtn
            icon={Filter}
            title="Toggle Filter Bar"
            onClick={() => setShowFilterBar(!showFilterBar)}
            active={showFilterBar}
          />
          <IconBtn
            icon={watchMode ? Eye : EyeOff}
            title={watchMode ? 'Disable Watch Mode' : 'Enable Watch Mode'}
            onClick={() => setWatchMode(!watchMode)}
            active={watchMode}
            color={watchMode ? 'var(--accent-green, #3fb950)' : undefined}
          />
          <IconBtn
            icon={BarChart3}
            title={showCoverage ? 'Hide Coverage' : 'Show Coverage'}
            onClick={() => setShowCoverage(!showCoverage)}
            active={showCoverage}
          />
        </div>

        <div style={S.toolbarDivider} />

        <div style={S.toolbarGroup}>
          <IconBtn icon={FolderOpen} title="Expand All Suites" onClick={expandAll} size={13} />
          <IconBtn icon={Minus} title="Collapse All Suites" onClick={collapseAll} size={13} />
        </div>
      </div>

      {/* ── Filter Bar ── */}
      {showFilterBar && (
        <div style={S.filterBar}>
          {/* Status filter chips */}
          {(['all', 'passed', 'failed', 'skipped', 'running'] as FilterMode[]).map((mode) => {
            const active = filterMode === mode
            const modeColors: Record<FilterMode, string> = {
              all: 'var(--text-primary, #cccccc)',
              passed: statusColor('passed'),
              failed: statusColor('failed'),
              skipped: statusColor('skipped'),
              running: statusColor('running'),
            }
            const modeCount: Record<FilterMode, number> = {
              all: total,
              passed: counts.passed,
              failed: counts.failed,
              skipped: counts.skipped,
              running: counts.running + counts.queued,
            }
            return (
              <button
                key={mode}
                style={{
                  ...S.filterChip,
                  background: active ? `${modeColors[mode]}20` : 'none',
                  borderColor: active ? `${modeColors[mode]}50` : 'var(--border, #333)',
                  color: active ? modeColors[mode] : 'var(--text-muted, #666)',
                }}
                onClick={() => setFilterMode(mode)}
              >
                {mode === 'all' ? 'All' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                {modeCount[mode] > 0 && (
                  <span style={{ fontWeight: 400, opacity: 0.8 }}>{modeCount[mode]}</span>
                )}
              </button>
            )
          })}

          <div style={S.toolbarDivider} />

          {/* Tag filter dropdown */}
          <TagFilterDropdown allTags={allTags} selectedTags={selectedTags} onToggleTag={toggleTag} />

          {/* Framework selector dropdown */}
          <FrameworkSelector selected={selectedFramework} onSelect={setSelectedFramework} />

          {/* Sort dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...S.filterChip, color: 'var(--text-muted, #666)' }}
              onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            >
              <ArrowUpDown size={10} />
              {sortMode.charAt(0).toUpperCase() + sortMode.slice(1)}
              <ChevronDown size={9} />
            </button>
            {sortDropdownOpen && (
              <>
                <div style={S.dropdownOverlay} onClick={() => setSortDropdownOpen(false)} />
                <div style={S.dropdown}>
                  {(['name', 'status', 'duration', 'recent'] as SortMode[]).map((mode) => (
                    <button
                      key={mode}
                      style={{
                        ...S.dropdownItem,
                        background: mode === sortMode ? 'var(--bg-tertiary, #2a2a2a)' : undefined,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #ffffff10)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = mode === sortMode ? 'var(--bg-tertiary, #2a2a2a)' : 'none' }}
                      onClick={() => {
                        setSortMode(mode)
                        setSortDropdownOpen(false)
                      }}
                    >
                      {mode === 'name' && <ArrowUpDown size={12} />}
                      {mode === 'status' && <Activity size={12} />}
                      {mode === 'duration' && <Clock size={12} />}
                      {mode === 'recent' && <History size={12} />}
                      <span style={{ flex: 1 }}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                      {mode === sortMode && <CheckCircle2 size={12} style={{ color: 'var(--accent, #388bfd)' }} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Progress Bar (visible during run) ── */}
      {isRunning && (
        <div style={{ height: 2, background: 'var(--bg-tertiary, #2a2a2a)', flexShrink: 0 }}>
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: counts.failed > 0 ? 'var(--accent-red, #f85149)' : 'var(--accent-blue, #388bfd)',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      )}

      {/* ── Watch Mode Banner ── */}
      {watchMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 10px',
            background: 'var(--accent-green, #3fb950)10',
            borderBottom: '1px solid var(--accent-green, #3fb950)30',
            gap: 6,
            fontSize: 11,
            color: 'var(--accent-green, #3fb950)',
            flexShrink: 0,
          }}
        >
          <Eye size={12} />
          <span style={{ fontWeight: 600 }}>Watch Mode Active</span>
          <span style={{ color: 'var(--text-muted, #666)', fontWeight: 400 }}>
            Tests re-run automatically on file changes
          </span>
          <span style={{ flex: 1 }} />
          <button
            style={{
              background: 'none',
              border: '1px solid var(--accent-green, #3fb950)40',
              borderRadius: 3,
              color: 'var(--accent-green, #3fb950)',
              fontSize: 10,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
            onClick={() => setWatchMode(false)}
          >
            Disable
          </button>
        </div>
      )}

      {/* ── Test Tree View ── */}
      <div
        ref={treeRef}
        style={S.treeContainer}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="tree"
        aria-label="Test Explorer"
      >
        {filteredSuites.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 40,
              gap: 8,
              color: 'var(--text-muted, #666)',
            }}
          >
            <Search size={32} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>No tests found</span>
            <span style={{ fontSize: 11 }}>
              {searchQuery
                ? `No tests match "${searchQuery}"`
                : filterMode !== 'all'
                  ? `No ${filterMode} tests`
                  : 'Run tests to get started'}
            </span>
          </div>
        ) : (
          filteredSuites.map((suite) => {
            const suiteIdx = treeIndex++
            return (
              <div key={suite.id} role="treeitem" aria-expanded={suite.expanded}>
                {/* Suite Row */}
                <div
                  data-tree-index={suiteIdx}
                  style={{
                    ...S.suiteRow,
                    background:
                      focusedIndex === suiteIdx
                        ? 'var(--bg-selection, #ffffff15)'
                        : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (focusedIndex !== suiteIdx)
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #ffffff08)'
                  }}
                  onMouseLeave={(e) => {
                    if (focusedIndex !== suiteIdx)
                      (e.currentTarget as HTMLElement).style.background = 'none'
                  }}
                  onClick={() => {
                    toggleSuiteExpanded(suite.id)
                    setFocusedIndex(suiteIdx)
                  }}
                >
                  {suite.expanded ? (
                    <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-muted, #666)' }} />
                  ) : (
                    <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--text-muted, #666)' }} />
                  )}
                  <StatusIcon status={suite.status} size={14} />
                  <FolderOpen size={13} style={{ color: 'var(--accent-yellow, #d29922)', flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                    title={suite.filePath}
                  >
                    {suite.name}
                  </span>
                  <FrameworkBadge framework={suite.framework} />
                  {showCoverage && suite.coverage && (
                    <CoverageBarInline pct={suite.coverage.linePct} width={36} />
                  )}
                  <span style={{ fontSize: 10, color: 'var(--text-muted, #666)', flexShrink: 0 }}>
                    {suite.tests.length}
                  </span>
                  {suite.duration !== undefined && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted, #666)', flexShrink: 0 }}>
                      {formatDuration(suite.duration)}
                    </span>
                  )}
                  {/* Suite action buttons */}
                  <div
                    style={{ display: 'flex', gap: 1, marginLeft: 2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconBtn
                      icon={Play}
                      title={`Run ${suite.name}`}
                      onClick={() => runSuiteTests(suite.id)}
                      size={12}
                      disabled={isRunning}
                      color="var(--accent-green, #3fb950)"
                    />
                    <IconBtn
                      icon={ExternalLink}
                      title={`Open ${suite.filePath}`}
                      onClick={() => console.log(`Open: ${suite.filePath}`)}
                      size={11}
                    />
                  </div>
                </div>

                {/* Test Rows */}
                {suite.expanded &&
                  suite.tests.map((test) => {
                    const testIdx = treeIndex++
                    const outputExpanded = expandedOutputs.has(test.id)
                    const hasOutput = test.output && (test.status === 'failed' || test.status === 'errored' || test.status === 'passed')

                    return (
                      <div key={test.id} role="treeitem">
                        <div
                          data-tree-index={testIdx}
                          style={{
                            ...S.testRow,
                            background:
                              focusedIndex === testIdx
                                ? 'var(--bg-selection, #ffffff15)'
                                : undefined,
                          }}
                          onMouseEnter={(e) => {
                            if (focusedIndex !== testIdx)
                              (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #ffffff08)'
                          }}
                          onMouseLeave={(e) => {
                            if (focusedIndex !== testIdx)
                              (e.currentTarget as HTMLElement).style.background = 'none'
                          }}
                          onClick={() => {
                            setFocusedIndex(testIdx)
                            if (hasOutput) toggleOutputExpanded(test.id)
                          }}
                        >
                          {/* Output expand indicator */}
                          {hasOutput ? (
                            outputExpanded ? (
                              <ChevronDown size={10} style={{ flexShrink: 0, color: 'var(--text-muted, #666)' }} />
                            ) : (
                              <ChevronRight size={10} style={{ flexShrink: 0, color: 'var(--text-muted, #666)' }} />
                            )
                          ) : (
                            <span style={{ width: 10, flexShrink: 0 }} />
                          )}

                          <StatusIcon status={test.status} size={12} />

                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color:
                                test.status === 'failed' || test.status === 'errored'
                                  ? statusColor(test.status)
                                  : undefined,
                            }}
                            title={test.fullName}
                          >
                            {test.name}
                          </span>

                          {/* Flaky badge */}
                          {test.isFlaky && <FlakyBadge />}

                          {/* Tag badges */}
                          {test.tags.length > 0 && (
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              {test.tags.slice(0, 2).map((tag) => (
                                <span key={tag} style={S.tagBadge}>
                                  {tag}
                                </span>
                              ))}
                              {test.tags.length > 2 && (
                                <span style={S.tagBadge}>+{test.tags.length - 2}</span>
                              )}
                            </div>
                          )}

                          {/* History indicator dots */}
                          {test.history.length > 0 && <TestHistoryBar history={test.history} />}

                          {/* Duration */}
                          {test.duration !== undefined && (
                            <span
                              style={{
                                fontSize: 10,
                                color: test.duration > 500 ? 'var(--accent-yellow, #d29922)' : 'var(--text-muted, #666)',
                                flexShrink: 0,
                                minWidth: 32,
                                textAlign: 'right',
                              }}
                            >
                              {formatDuration(test.duration)}
                            </span>
                          )}

                          {/* Test action buttons */}
                          <div
                            style={{ display: 'flex', gap: 1, marginLeft: 2 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconBtn
                              icon={Play}
                              title={`Run "${test.name}"`}
                              onClick={() => runSingleTest(test.id)}
                              size={11}
                              disabled={isRunning}
                              color="var(--accent-green, #3fb950)"
                            />
                            <IconBtn
                              icon={Bug}
                              title={`Debug "${test.name}"`}
                              onClick={() => debugTest(test.id)}
                              size={11}
                              disabled={isRunning}
                              color="var(--accent-orange, #db6d28)"
                            />
                          </div>
                        </div>

                        {/* Expandable test output */}
                        {outputExpanded && hasOutput && (
                          <TestOutputViewer test={test} status={test.status} />
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}

        {/* ── Coverage Section ── */}
        {showCoverage && (
          <CoverageSummarySection
            coverage={coverage}
            expanded={coverageExpanded}
            onToggle={() => setCoverageExpanded(!coverageExpanded)}
          />
        )}

        {/* ── Run History Section ── */}
        <RunHistorySection
          history={runHistory}
          expanded={historyExpanded}
          onToggle={() => setHistoryExpanded(!historyExpanded)}
        />
      </div>

      {/* ── Status Bar ── */}
      <div style={S.statusBar}>
        {/* Test counts by status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary, #999)' }}>
            {total} tests
          </span>
          {counts.passed > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CheckCircle2 size={10} style={{ color: statusColor('passed') }} />
              <span style={{ color: statusColor('passed') }}>{counts.passed}</span>
            </span>
          )}
          {counts.failed > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <XCircle size={10} style={{ color: statusColor('failed') }} />
              <span style={{ color: statusColor('failed') }}>{counts.failed}</span>
            </span>
          )}
          {counts.errored > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <AlertTriangle size={10} style={{ color: statusColor('errored') }} />
              <span style={{ color: statusColor('errored') }}>{counts.errored}</span>
            </span>
          )}
          {counts.skipped > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Minus size={10} style={{ color: statusColor('skipped') }} />
              <span style={{ color: statusColor('skipped') }}>{counts.skipped}</span>
            </span>
          )}
          {(counts.running > 0 || counts.queued > 0) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Loader2 size={10} style={{ color: statusColor('running'), animation: 'spin 1s linear infinite' }} />
              <span style={{ color: statusColor('running') }}>{counts.running + counts.queued}</span>
            </span>
          )}
        </div>

        <span style={{ flex: 1 }} />

        {/* Watch mode indicator */}
        {watchMode && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent-green, #3fb950)' }}>
            <Eye size={10} />
            Watch
          </span>
        )}

        {/* Coverage indicator */}
        {showCoverage && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Shield size={10} style={{ color: coverageColor(coverage.overall) }} />
            <span style={{ color: coverageColor(coverage.overall) }}>
              {coverage.overall.toFixed(1)}%
            </span>
          </span>
        )}

        {/* Active framework */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: getFrameworkConfig(selectedFramework).color,
            }}
          />
          {getFrameworkConfig(selectedFramework).label}
        </span>

        {/* Flaky test count */}
        {(() => {
          const flakyCount = suites.flatMap((s) => s.tests).filter((t) => t.isFlaky).length
          return flakyCount > 0 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent-orange, #db6d28)' }}>
              <Zap size={10} />
              {flakyCount} flaky
            </span>
          ) : null
        })()}

        {/* Run history count */}
        {runHistory.length > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <History size={10} />
            {runHistory.length} runs
          </span>
        )}
      </div>
    </div>
  )
}
