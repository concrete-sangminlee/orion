/**
 * Test runner integration for the IDE.
 * Supports Jest, Vitest, Mocha, pytest, and Go test frameworks.
 */

/* ── Types ─────────────────────────────────────────────── */

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped' | 'error'

export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'pytest' | 'go-test' | 'cargo-test' | 'unknown'

export interface TestItem {
  id: string
  name: string
  fullName: string
  file: string
  line: number
  type: 'suite' | 'test'
  children: TestItem[]
  status: TestStatus
  duration?: number
  error?: TestError
  tags?: string[]
}

export interface TestError {
  message: string
  stack?: string
  expected?: string
  actual?: string
  diff?: string
}

export interface TestRunResult {
  framework: TestFramework
  timestamp: number
  duration: number
  total: number
  passed: number
  failed: number
  skipped: number
  errors: number
  suites: TestItem[]
  coverage?: CoverageReport
}

export interface CoverageReport {
  lines: CoverageMetric
  branches: CoverageMetric
  functions: CoverageMetric
  statements: CoverageMetric
  files: FileCoverage[]
}

export interface CoverageMetric {
  total: number
  covered: number
  percentage: number
}

export interface FileCoverage {
  file: string
  lines: CoverageMetric
  branches: CoverageMetric
  functions: CoverageMetric
  statements: CoverageMetric
  uncoveredLines: number[]
}

export interface TestConfig {
  framework: TestFramework
  configFile?: string
  testDir?: string
  pattern?: string
  env?: Record<string, string>
  args?: string[]
  watch?: boolean
  coverage?: boolean
  bail?: boolean
  timeout?: number
  parallel?: boolean
}

export interface TestWatcher {
  id: string
  config: TestConfig
  status: 'watching' | 'running' | 'stopped'
  lastRun?: TestRunResult
}

/* ── Framework Detection ──────────────────────────────── */

export function detectTestFramework(files: string[], packageJson?: any): TestFramework {
  // Check package.json devDependencies
  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies }

  if (deps?.vitest) return 'vitest'
  if (deps?.jest || deps?.['@jest/core']) return 'jest'
  if (deps?.mocha) return 'mocha'

  // Check config files
  const hasFile = (pattern: string) => files.some(f => f.includes(pattern))

  if (hasFile('vitest.config')) return 'vitest'
  if (hasFile('jest.config')) return 'jest'
  if (hasFile('.mocharc')) return 'mocha'
  if (hasFile('pytest.ini') || hasFile('pyproject.toml') || hasFile('conftest.py')) return 'pytest'
  if (hasFile('go.mod')) return 'go-test'
  if (hasFile('Cargo.toml')) return 'cargo-test'

  // Check file extensions for test files
  if (files.some(f => f.match(/\.test\.(ts|tsx|js|jsx)$/))) return 'jest'
  if (files.some(f => f.match(/test_.*\.py$/) || f.match(/_test\.py$/))) return 'pytest'
  if (files.some(f => f.match(/_test\.go$/))) return 'go-test'

  return 'unknown'
}

/* ── Test Command Builders ────────────────────────────── */

export function buildTestCommand(config: TestConfig): { command: string; args: string[] } {
  switch (config.framework) {
    case 'vitest':
      return buildVitestCommand(config)
    case 'jest':
      return buildJestCommand(config)
    case 'mocha':
      return buildMochaCommand(config)
    case 'pytest':
      return buildPytestCommand(config)
    case 'go-test':
      return buildGoTestCommand(config)
    case 'cargo-test':
      return buildCargoTestCommand(config)
    default:
      return { command: 'echo', args: ['No test framework detected'] }
  }
}

function buildVitestCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = ['vitest']

  if (!config.watch) args.push('run')
  if (config.coverage) args.push('--coverage')
  if (config.bail) args.push('--bail', '1')
  if (config.pattern) args.push(config.pattern)
  if (config.configFile) args.push('--config', config.configFile)
  if (config.timeout) args.push('--test-timeout', config.timeout.toString())
  args.push('--reporter', 'json')
  if (config.args) args.push(...config.args)

  return { command: 'npx', args }
}

function buildJestCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = ['jest']

  if (config.watch) args.push('--watch')
  if (config.coverage) args.push('--coverage')
  if (config.bail) args.push('--bail')
  if (config.pattern) args.push('--testPathPattern', config.pattern)
  if (config.configFile) args.push('--config', config.configFile)
  if (config.timeout) args.push('--testTimeout', config.timeout.toString())
  if (config.parallel === false) args.push('--runInBand')
  args.push('--json', '--outputFile=test-results.json')
  if (config.args) args.push(...config.args)

  return { command: 'npx', args }
}

function buildMochaCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = ['mocha']

  if (config.watch) args.push('--watch')
  if (config.bail) args.push('--bail')
  if (config.pattern) args.push(config.pattern)
  if (config.timeout) args.push('--timeout', config.timeout.toString())
  if (config.parallel) args.push('--parallel')
  args.push('--reporter', 'json')
  if (config.args) args.push(...config.args)

  return { command: 'npx', args }
}

function buildPytestCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = []

  if (config.coverage) args.push('--cov', '--cov-report=json')
  if (config.bail) args.push('-x')
  if (config.pattern) args.push('-k', config.pattern)
  if (config.testDir) args.push(config.testDir)
  if (config.timeout) args.push('--timeout', config.timeout.toString())
  if (config.parallel) args.push('-n', 'auto')
  args.push('--tb=short', '-v', '--json-report')
  if (config.args) args.push(...config.args)

  return { command: 'pytest', args }
}

function buildGoTestCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = ['test']

  if (config.coverage) args.push('-cover', '-coverprofile=coverage.out')
  if (config.bail) args.push('-failfast')
  if (config.pattern) args.push('-run', config.pattern)
  if (config.timeout) args.push('-timeout', `${config.timeout}ms`)
  if (config.parallel) args.push('-parallel', '4')
  args.push('-v', '-json')
  args.push(config.testDir || './...')
  if (config.args) args.push(...config.args)

  return { command: 'go', args }
}

function buildCargoTestCommand(config: TestConfig): { command: string; args: string[] } {
  const args: string[] = ['test']

  if (config.pattern) args.push(config.pattern)
  args.push('--', '--format', 'json', '-Z', 'unstable-options')
  if (config.args) args.push(...config.args)

  return { command: 'cargo', args }
}

/* ── Test Result Parsers ──────────────────────────────── */

export function parseJestResults(json: any): TestRunResult {
  const suites: TestItem[] = (json.testResults || []).map((suite: any, si: number) => {
    const tests: TestItem[] = (suite.testResults || suite.assertionResults || []).map((t: any, ti: number) => ({
      id: `${si}-${ti}`,
      name: t.title || t.fullName || 'unknown',
      fullName: t.ancestorTitles ? [...t.ancestorTitles, t.title].join(' > ') : t.title,
      file: suite.testFilePath || suite.name || '',
      line: t.location?.line || 0,
      type: 'test' as const,
      children: [],
      status: mapJestStatus(t.status),
      duration: t.duration,
      error: t.failureMessages?.length ? {
        message: t.failureMessages[0],
        stack: t.failureDetails?.[0]?.stack,
        expected: t.failureDetails?.[0]?.expected,
        actual: t.failureDetails?.[0]?.actual,
      } : undefined,
    }))

    return {
      id: `suite-${si}`,
      name: suite.testFilePath?.split(/[/\\]/).pop() || `Suite ${si}`,
      fullName: suite.testFilePath || '',
      file: suite.testFilePath || '',
      line: 0,
      type: 'suite' as const,
      children: tests,
      status: suite.status === 'passed' ? 'passed' as const : 'failed' as const,
      duration: suite.endTime - suite.startTime,
    }
  })

  return {
    framework: 'jest',
    timestamp: json.startTime || Date.now(),
    duration: suites.reduce((sum, s) => sum + (s.duration || 0), 0),
    total: json.numTotalTests || 0,
    passed: json.numPassedTests || 0,
    failed: json.numFailedTests || 0,
    skipped: json.numPendingTests || 0,
    errors: json.numRuntimeErrorTestSuites || 0,
    suites,
  }
}

export function parseVitestResults(json: any): TestRunResult {
  const suites: TestItem[] = (json.testResults || []).map((suite: any, si: number) => {
    const flatTests = flattenVitestTests(suite.tasks || [], suite.name || '', si)
    return {
      id: `suite-${si}`,
      name: suite.name?.split(/[/\\]/).pop() || `Suite ${si}`,
      fullName: suite.name || '',
      file: suite.name || '',
      line: 0,
      type: 'suite' as const,
      children: flatTests,
      status: suite.state === 'pass' ? 'passed' as const : 'failed' as const,
      duration: suite.duration,
    }
  })

  const allTests = suites.flatMap(s => s.children)
  return {
    framework: 'vitest',
    timestamp: Date.now(),
    duration: json.duration || 0,
    total: allTests.length,
    passed: allTests.filter(t => t.status === 'passed').length,
    failed: allTests.filter(t => t.status === 'failed').length,
    skipped: allTests.filter(t => t.status === 'skipped').length,
    errors: 0,
    suites,
  }
}

function flattenVitestTests(tasks: any[], file: string, suiteIdx: number): TestItem[] {
  const items: TestItem[] = []
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    if (task.type === 'test') {
      items.push({
        id: `${suiteIdx}-${i}`,
        name: task.name,
        fullName: task.name,
        file,
        line: task.location?.line || 0,
        type: 'test',
        children: [],
        status: task.result?.state === 'pass' ? 'passed' : task.result?.state === 'skip' ? 'skipped' : 'failed',
        duration: task.result?.duration,
        error: task.result?.errors?.[0] ? { message: task.result.errors[0].message, stack: task.result.errors[0].stack } : undefined,
      })
    } else if (task.type === 'suite' && task.tasks) {
      items.push(...flattenVitestTests(task.tasks, file, suiteIdx))
    }
  }
  return items
}

export function parsePytestResults(json: any): TestRunResult {
  const tests: TestItem[] = (json.tests || []).map((t: any, i: number) => ({
    id: `test-${i}`,
    name: t.nodeid?.split('::').pop() || t.name || `test_${i}`,
    fullName: t.nodeid || '',
    file: t.nodeid?.split('::')[0] || '',
    line: t.lineno || 0,
    type: 'test' as const,
    children: [],
    status: t.outcome === 'passed' ? 'passed' as const : t.outcome === 'skipped' ? 'skipped' as const : 'failed' as const,
    duration: t.duration,
    error: t.call?.longrepr ? { message: t.call.longrepr } : undefined,
  }))

  // Group by file
  const fileGroups = new Map<string, TestItem[]>()
  for (const test of tests) {
    const group = fileGroups.get(test.file) || []
    group.push(test)
    fileGroups.set(test.file, group)
  }

  const suites: TestItem[] = [...fileGroups.entries()].map(([file, items], i) => ({
    id: `suite-${i}`,
    name: file.split(/[/\\]/).pop() || file,
    fullName: file,
    file,
    line: 0,
    type: 'suite' as const,
    children: items,
    status: items.every(t => t.status === 'passed') ? 'passed' as const : 'failed' as const,
  }))

  return {
    framework: 'pytest',
    timestamp: Date.now(),
    duration: json.duration || 0,
    total: tests.length,
    passed: tests.filter(t => t.status === 'passed').length,
    failed: tests.filter(t => t.status === 'failed').length,
    skipped: tests.filter(t => t.status === 'skipped').length,
    errors: 0,
    suites,
  }
}

export function parseGoTestResults(lines: string[]): TestRunResult {
  const tests: TestItem[] = []
  let totalDuration = 0

  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      if (event.Action === 'pass' || event.Action === 'fail' || event.Action === 'skip') {
        if (event.Test) {
          tests.push({
            id: `${event.Package}/${event.Test}`,
            name: event.Test,
            fullName: `${event.Package}/${event.Test}`,
            file: event.Package || '',
            line: 0,
            type: 'test',
            children: [],
            status: event.Action === 'pass' ? 'passed' : event.Action === 'skip' ? 'skipped' : 'failed',
            duration: event.Elapsed ? event.Elapsed * 1000 : undefined,
          })
        }
        if (!event.Test && event.Elapsed) {
          totalDuration += event.Elapsed * 1000
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  const packageGroups = new Map<string, TestItem[]>()
  for (const test of tests) {
    const group = packageGroups.get(test.file) || []
    group.push(test)
    packageGroups.set(test.file, group)
  }

  const suites: TestItem[] = [...packageGroups.entries()].map(([pkg, items], i) => ({
    id: `suite-${i}`,
    name: pkg.split('/').pop() || pkg,
    fullName: pkg,
    file: pkg,
    line: 0,
    type: 'suite' as const,
    children: items,
    status: items.every(t => t.status === 'passed') ? 'passed' as const : 'failed' as const,
  }))

  return {
    framework: 'go-test',
    timestamp: Date.now(),
    duration: totalDuration,
    total: tests.length,
    passed: tests.filter(t => t.status === 'passed').length,
    failed: tests.filter(t => t.status === 'failed').length,
    skipped: tests.filter(t => t.status === 'skipped').length,
    errors: 0,
    suites,
  }
}

/* ── Coverage Parser ──────────────────────────────────── */

export function parseCoverageReport(json: any): CoverageReport | undefined {
  if (!json?.total) return undefined

  const parseMetric = (m: any): CoverageMetric => ({
    total: m?.total || 0,
    covered: m?.covered || 0,
    percentage: m?.pct ?? (m?.total ? Math.round((m.covered / m.total) * 100) : 0),
  })

  const files: FileCoverage[] = Object.entries(json)
    .filter(([key]) => key !== 'total')
    .map(([file, data]: [string, any]) => ({
      file,
      lines: parseMetric(data?.lines),
      branches: parseMetric(data?.branches),
      functions: parseMetric(data?.functions),
      statements: parseMetric(data?.statements),
      uncoveredLines: data?.linesCovered
        ? Object.entries(data.linesCovered).filter(([, v]) => v === 0).map(([k]) => parseInt(k))
        : [],
    }))

  return {
    lines: parseMetric(json.total?.lines),
    branches: parseMetric(json.total?.branches),
    functions: parseMetric(json.total?.functions),
    statements: parseMetric(json.total?.statements),
    files,
  }
}

/* ── Helpers ──────────────────────────────────────────── */

function mapJestStatus(status: string): TestStatus {
  switch (status) {
    case 'passed': return 'passed'
    case 'failed': return 'failed'
    case 'pending':
    case 'skipped':
    case 'todo':
      return 'skipped'
    default: return 'idle'
  }
}

export function getTestSummary(result: TestRunResult): string {
  const parts: string[] = []
  if (result.passed > 0) parts.push(`${result.passed} passed`)
  if (result.failed > 0) parts.push(`${result.failed} failed`)
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
  if (result.errors > 0) parts.push(`${result.errors} errors`)
  return `${parts.join(', ')} (${result.total} total) in ${(result.duration / 1000).toFixed(2)}s`
}

export function getTestIcon(status: TestStatus): string {
  switch (status) {
    case 'passed': return '✓'
    case 'failed': return '✗'
    case 'skipped': return '○'
    case 'running': return '◉'
    case 'error': return '⚠'
    default: return '·'
  }
}

export function findTestFile(sourceFile: string): string[] {
  const name = sourceFile.replace(/\.[^.]+$/, '')
  const ext = sourceFile.match(/\.[^.]+$/)?.[0] || '.ts'

  return [
    `${name}.test${ext}`,
    `${name}.spec${ext}`,
    `${name}_test${ext}`,
    `__tests__/${sourceFile.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '')}.test${ext}`,
    `tests/${sourceFile.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '')}.test${ext}`,
  ]
}

export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(path)
    || /test_.*\.py$/.test(path)
    || /_test\.(py|go)$/.test(path)
    || path.includes('__tests__/')
}
