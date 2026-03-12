// Task Runner System - VS Code-style task execution
// Parses tasks.json, runs npm scripts, makefiles, and more

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskGroup = 'build' | 'test' | 'clean' | 'deploy' | 'none';

export type TaskStatus = 'running' | 'success' | 'failed' | 'cancelled';

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface ProblemPattern {
  regexp: string;
  file?: number;
  line?: number;
  column?: number;
  severity?: number;
  message?: number;
}

export interface ProblemMatcher {
  owner: string;
  pattern: ProblemPattern;
  background?: {
    activeOnStart?: boolean;
    beginsPattern?: string;
    endsPattern?: string;
  };
}

export interface TaskPresentation {
  reveal?: 'always' | 'silent' | 'never';
  echo?: boolean;
  focus?: boolean;
  panel?: 'shared' | 'dedicated' | 'new';
  showReuseMessage?: boolean;
  clear?: boolean;
}

export interface TaskDefinition {
  label: string;
  type: string;
  command?: string;
  args?: string[];
  group?: TaskGroup | { kind: TaskGroup; isDefault?: boolean };
  dependsOn?: string | string[];
  isBackground?: boolean;
  problemMatcher?: string | ProblemMatcher | (string | ProblemMatcher)[];
  presentation?: TaskPresentation;
  env?: Record<string, string>;
  cwd?: string;
  shell?: {
    executable?: string;
    args?: string[];
  };
  options?: {
    env?: Record<string, string>;
    cwd?: string;
    shell?: { executable?: string; args?: string[] };
  };
  runOptions?: {
    instanceLimit?: number;
    reevaluateOnRerun?: boolean;
  };
}

export interface TaskExecution {
  id: string;
  task: TaskDefinition;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string[];
  pid?: number;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: ProblemSeverity;
  message: string;
  owner: string;
}

export interface TaskProvider {
  type: string;
  provideTasks(): TaskDefinition[];
}

export interface TasksJsonSchema {
  version: string;
  tasks: TaskDefinition[];
  inputs?: Array<{
    id: string;
    type: string;
    description?: string;
    default?: string;
  }>;
}

// ─── Built-in Problem Matchers ───────────────────────────────────────────────

const BUILTIN_PROBLEM_MATCHERS: Record<string, ProblemMatcher> = {
  '$tsc': {
    owner: 'typescript',
    pattern: {
      regexp: '^(.+)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+TS(\\d+):\\s+(.+)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      message: 6,
    },
  },
  '$tsc-watch': {
    owner: 'typescript',
    pattern: {
      regexp: '^(.+)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+TS(\\d+):\\s+(.+)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      message: 6,
    },
    background: {
      activeOnStart: true,
      beginsPattern: '^\\s*\\d{1,2}:\\d{2}:\\d{2}\\s+(AM|PM)\\s+-\\s+File change detected',
      endsPattern: '^\\s*\\d{1,2}:\\d{2}:\\d{2}\\s+(AM|PM)\\s+-\\s+Compilation complete',
    },
  },
  '$eslint-compact': {
    owner: 'eslint',
    pattern: {
      regexp: '^(.+):\\s+line\\s+(\\d+),\\s+col\\s+(\\d+),\\s+(Error|Warning)\\s+-\\s+(.+)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      message: 5,
    },
  },
  '$gcc': {
    owner: 'gcc',
    pattern: {
      regexp: '^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      message: 5,
    },
  },
  '$rustc': {
    owner: 'rustc',
    pattern: {
      regexp: '^(error|warning)\\[E\\d+\\]:\\s+(.+)\\s+-->\\s+(.+):(\\d+):(\\d+)$',
      severity: 1,
      message: 2,
      file: 3,
      line: 4,
      column: 5,
    },
  },
  '$go': {
    owner: 'go',
    pattern: {
      regexp: '^(.+):(\\d+):(\\d+):\\s+(.+)$',
      file: 1,
      line: 2,
      column: 3,
      message: 4,
    },
  },
  '$python': {
    owner: 'python',
    pattern: {
      regexp: '^\\s*File\\s+"(.+)",\\s+line\\s+(\\d+)',
      file: 1,
      line: 2,
    },
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

let nextExecutionId = 1;
const runningTasks: Map<string, TaskExecution> = new Map();
const taskHistory: TaskExecution[] = [];
const MAX_HISTORY = 50;

// ─── Built-in Task Providers ─────────────────────────────────────────────────

function createNpmProvider(packageJson: any, manager: 'npm' | 'yarn' | 'pnpm'): TaskProvider {
  return {
    type: manager,
    provideTasks(): TaskDefinition[] {
      if (!packageJson?.scripts) return [];
      return Object.keys(packageJson.scripts).map((scriptName) => {
        const group = inferGroupFromScript(scriptName);
        return {
          label: `${manager}: ${scriptName}`,
          type: manager,
          command: manager,
          args: ['run', scriptName],
          group,
          problemMatcher: [],
        };
      });
    },
  };
}

function createMakeProvider(makefileContent: string): TaskProvider {
  return {
    type: 'make',
    provideTasks(): TaskDefinition[] {
      const targets: TaskDefinition[] = [];
      const targetRegex = /^([a-zA-Z_][\w-]*):/gm;
      let match: RegExpExecArray | null;

      while ((match = targetRegex.exec(makefileContent)) !== null) {
        const target = match[1];
        if (target.startsWith('.')) continue; // skip special targets
        targets.push({
          label: `make: ${target}`,
          type: 'make',
          command: 'make',
          args: [target],
          group: inferGroupFromScript(target),
          problemMatcher: '$gcc',
        });
      }
      return targets;
    },
  };
}

function createCargoProvider(): TaskProvider {
  return {
    type: 'cargo',
    provideTasks(): TaskDefinition[] {
      const commands = ['build', 'check', 'test', 'run', 'clean', 'clippy', 'fmt'];
      return commands.map((cmd) => {
        let group: TaskGroup = 'none';
        if (cmd === 'build' || cmd === 'check') group = 'build';
        else if (cmd === 'test') group = 'test';
        else if (cmd === 'clean') group = 'clean';

        return {
          label: `cargo: ${cmd}`,
          type: 'cargo',
          command: 'cargo',
          args: [cmd],
          group,
          problemMatcher: '$rustc',
        };
      });
    },
  };
}

function createGoProvider(): TaskProvider {
  return {
    type: 'go',
    provideTasks(): TaskDefinition[] {
      return [
        { label: 'go: build', type: 'go', command: 'go', args: ['build', './...'], group: 'build', problemMatcher: '$go' },
        { label: 'go: test', type: 'go', command: 'go', args: ['test', './...'], group: 'test', problemMatcher: '$go' },
        { label: 'go: vet', type: 'go', command: 'go', args: ['vet', './...'], group: 'build', problemMatcher: '$go' },
        { label: 'go: clean', type: 'go', command: 'go', args: ['clean'], group: 'clean' },
        { label: 'go: run', type: 'go', command: 'go', args: ['run', '.'], group: 'none' },
      ];
    },
  };
}

function createPythonProvider(): TaskProvider {
  return {
    type: 'python',
    provideTasks(): TaskDefinition[] {
      return [
        { label: 'python: run', type: 'python', command: 'python', args: ['main.py'], group: 'none', problemMatcher: '$python' },
        { label: 'python: test (pytest)', type: 'python', command: 'python', args: ['-m', 'pytest'], group: 'test', problemMatcher: '$python' },
        { label: 'python: test (unittest)', type: 'python', command: 'python', args: ['-m', 'unittest', 'discover'], group: 'test', problemMatcher: '$python' },
        { label: 'python: lint (pylint)', type: 'python', command: 'python', args: ['-m', 'pylint', '.'], group: 'none' },
      ];
    },
  };
}

function createGradleProvider(): TaskProvider {
  return {
    type: 'gradle',
    provideTasks(): TaskDefinition[] {
      const commands = ['build', 'test', 'clean', 'assemble', 'check', 'run'];
      return commands.map((cmd) => {
        let group: TaskGroup = 'none';
        if (cmd === 'build' || cmd === 'assemble' || cmd === 'check') group = 'build';
        else if (cmd === 'test') group = 'test';
        else if (cmd === 'clean') group = 'clean';

        return {
          label: `gradle: ${cmd}`,
          type: 'gradle',
          command: './gradlew',
          args: [cmd],
          group,
        };
      });
    },
  };
}

function createDotnetProvider(): TaskProvider {
  return {
    type: 'dotnet',
    provideTasks(): TaskDefinition[] {
      return [
        { label: 'dotnet: build', type: 'dotnet', command: 'dotnet', args: ['build'], group: 'build' },
        { label: 'dotnet: test', type: 'dotnet', command: 'dotnet', args: ['test'], group: 'test' },
        { label: 'dotnet: clean', type: 'dotnet', command: 'dotnet', args: ['clean'], group: 'clean' },
        { label: 'dotnet: run', type: 'dotnet', command: 'dotnet', args: ['run'], group: 'none' },
        { label: 'dotnet: publish', type: 'dotnet', command: 'dotnet', args: ['publish'], group: 'deploy' },
      ];
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferGroupFromScript(name: string): TaskGroup {
  const lower = name.toLowerCase();
  if (/^(build|compile|bundle|webpack|tsc|make)/.test(lower)) return 'build';
  if (/^(test|spec|jest|mocha|vitest|check)/.test(lower)) return 'test';
  if (/^(clean|purge|reset)/.test(lower)) return 'clean';
  if (/^(deploy|publish|release|push)/.test(lower)) return 'deploy';
  return 'none';
}

function generateExecutionId(): string {
  return `task-exec-${nextExecutionId++}-${Date.now()}`;
}

function resolveGroupKind(group: TaskDefinition['group']): TaskGroup {
  if (!group) return 'none';
  if (typeof group === 'string') return group;
  return group.kind;
}

function resolveProblemMatcher(
  ref: string | ProblemMatcher | (string | ProblemMatcher)[] | undefined
): ProblemMatcher[] {
  if (!ref) return [];
  const refs = Array.isArray(ref) ? ref : [ref];
  return refs.map((r) => {
    if (typeof r === 'string') {
      return BUILTIN_PROBLEM_MATCHERS[r] ?? { owner: r, pattern: { regexp: '' } };
    }
    return r;
  });
}

function buildCommand(task: TaskDefinition): string {
  const cmd = task.command ?? '';
  const args = task.args ?? [];
  const escapedArgs = args.map((a) => (a.includes(' ') ? `"${a}"` : a));
  return [cmd, ...escapedArgs].join(' ');
}

function addToHistory(execution: TaskExecution): void {
  taskHistory.unshift(execution);
  if (taskHistory.length > MAX_HISTORY) {
    taskHistory.pop();
  }
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Parse a tasks.json string into an array of TaskDefinitions.
 */
export function parseTasksJson(content: string): TaskDefinition[] {
  try {
    // Strip comments (JSON with Comments support, like VS Code)
    const stripped = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const parsed: TasksJsonSchema = JSON.parse(stripped);

    if (parsed.version !== '2.0.0') {
      console.warn(`tasks.json version "${parsed.version}" may not be fully supported`);
    }

    if (!Array.isArray(parsed.tasks)) {
      return [];
    }

    return parsed.tasks.map((task) => ({
      label: task.label ?? 'Unnamed Task',
      type: task.type ?? 'shell',
      command: task.command,
      args: task.args,
      group: task.group,
      dependsOn: task.dependsOn,
      isBackground: task.isBackground ?? false,
      problemMatcher: task.problemMatcher,
      presentation: task.presentation,
      env: task.env ?? task.options?.env,
      cwd: task.cwd ?? task.options?.cwd,
      shell: task.shell ?? task.options?.shell,
      runOptions: task.runOptions,
    }));
  } catch (err) {
    console.error('Failed to parse tasks.json:', err);
    return [];
  }
}

/**
 * Auto-detect tasks from workspace files and package.json.
 */
export function detectTasks(files: string[], packageJson?: any): TaskDefinition[] {
  const detected: TaskDefinition[] = [];
  const fileSet = new Set(files.map((f) => f.toLowerCase().replace(/\\/g, '/')));
  const basenames = new Set(files.map((f) => {
    const parts = f.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1].toLowerCase();
  }));

  // npm / yarn / pnpm
  if (packageJson) {
    const hasYarnLock = basenames.has('yarn.lock');
    const hasPnpmLock = basenames.has('pnpm-lock.yaml');

    let manager: 'npm' | 'yarn' | 'pnpm' = 'npm';
    if (hasPnpmLock) manager = 'pnpm';
    else if (hasYarnLock) manager = 'yarn';

    detected.push(...createNpmProvider(packageJson, manager).provideTasks());
  }

  // Makefile
  if (basenames.has('makefile') || basenames.has('gnumakefile')) {
    // We cannot read the file here, but provide a generic make target
    detected.push(
      { label: 'make: all', type: 'make', command: 'make', args: ['all'], group: 'build', problemMatcher: '$gcc' },
      { label: 'make: clean', type: 'make', command: 'make', args: ['clean'], group: 'clean', problemMatcher: '$gcc' },
      { label: 'make: test', type: 'make', command: 'make', args: ['test'], group: 'test', problemMatcher: '$gcc' },
    );
  }

  // Cargo (Rust)
  if (basenames.has('cargo.toml')) {
    detected.push(...createCargoProvider().provideTasks());
  }

  // Go
  if (basenames.has('go.mod')) {
    detected.push(...createGoProvider().provideTasks());
  }

  // Python
  if (basenames.has('setup.py') || basenames.has('pyproject.toml') || basenames.has('requirements.txt')) {
    detected.push(...createPythonProvider().provideTasks());
  }

  // Gradle
  if (basenames.has('build.gradle') || basenames.has('build.gradle.kts') || basenames.has('gradlew')) {
    detected.push(...createGradleProvider().provideTasks());
  }

  // .NET
  const hasCsproj = files.some((f) => f.toLowerCase().endsWith('.csproj'));
  const hasFsproj = files.some((f) => f.toLowerCase().endsWith('.fsproj'));
  if (hasCsproj || hasFsproj || basenames.has('program.cs') || basenames.has('global.json')) {
    detected.push(...createDotnetProvider().provideTasks());
  }

  return detected;
}

/**
 * Execute a task, resolving dependencies first.
 * Returns a TaskExecution that tracks the running process.
 */
export function runTask(task: TaskDefinition, cwd: string): TaskExecution {
  const executionId = generateExecutionId();
  const execution: TaskExecution = {
    id: executionId,
    task,
    status: 'running',
    startTime: Date.now(),
    output: [],
  };

  runningTasks.set(executionId, execution);

  // Resolve dependencies
  const deps = task.dependsOn
    ? (Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn])
    : [];

  if (deps.length > 0) {
    execution.output.push(`[task-runner] Resolving ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'}...`);
    // In a real implementation, we would recursively run dependent tasks.
    // Here we record them for simulation.
    for (const dep of deps) {
      execution.output.push(`[task-runner] Dependency: "${dep}"`);
    }
  }

  const fullCommand = buildCommand(task);
  const effectiveCwd = task.cwd ?? task.options?.cwd ?? cwd;

  execution.output.push(`[task-runner] > ${fullCommand}`);
  execution.output.push(`[task-runner] cwd: ${effectiveCwd}`);

  if (task.env || task.options?.env) {
    const env = { ...task.options?.env, ...task.env };
    const envKeys = Object.keys(env);
    if (envKeys.length > 0) {
      execution.output.push(`[task-runner] env: ${envKeys.join(', ')}`);
    }
  }

  if (task.isBackground) {
    execution.output.push('[task-runner] Running as background task');
  }

  // Simulate async task completion for non-background tasks
  // In a real implementation this would spawn a child process
  if (!task.isBackground) {
    setTimeout(() => {
      completeExecution(executionId, 0, ['[task-runner] Process exited with code 0']);
    }, 100);
  }

  return execution;
}

function completeExecution(executionId: string, exitCode: number, additionalOutput: string[]): void {
  const execution = runningTasks.get(executionId);
  if (!execution) return;

  execution.exitCode = exitCode;
  execution.endTime = Date.now();
  execution.status = exitCode === 0 ? 'success' : 'failed';
  execution.output.push(...additionalOutput);

  runningTasks.delete(executionId);
  addToHistory(execution);
}

/**
 * Cancel a running task by execution ID.
 */
export function cancelTask(executionId: string): void {
  const execution = runningTasks.get(executionId);
  if (!execution) return;

  execution.status = 'cancelled';
  execution.endTime = Date.now();
  execution.output.push('[task-runner] Task cancelled by user');

  runningTasks.delete(executionId);
  addToHistory(execution);
}

/**
 * Get all currently running task executions.
 */
export function getRunningTasks(): TaskExecution[] {
  return Array.from(runningTasks.values());
}

/**
 * Get the task execution history (most recent first).
 */
export function getTaskHistory(): TaskExecution[] {
  return [...taskHistory];
}

/**
 * Get all tasks in the 'build' group.
 */
export function getBuildTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  return tasks.filter((t) => resolveGroupKind(t.group) === 'build');
}

/**
 * Get all tasks in the 'test' group.
 */
export function getTestTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  return tasks.filter((t) => resolveGroupKind(t.group) === 'test');
}

/**
 * Get the default task for a given group, if one is marked as default.
 */
export function getDefaultTask(tasks: TaskDefinition[], group: TaskGroup): TaskDefinition | undefined {
  return tasks.find((t) => {
    if (typeof t.group === 'object' && t.group.kind === group && t.group.isDefault) {
      return true;
    }
    return false;
  });
}

/**
 * Parse compiler/linter output using a problem matcher, returning diagnostics.
 */
export function parseOutput(output: string, matcher: ProblemMatcher): Diagnostic[] {
  const resolved = typeof matcher === 'string'
    ? BUILTIN_PROBLEM_MATCHERS[matcher as string]
    : matcher;

  if (!resolved?.pattern?.regexp) return [];

  const regex = new RegExp(resolved.pattern.regexp, 'gm');
  const diagnostics: Diagnostic[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(output)) !== null) {
    const fileIdx = resolved.pattern.file;
    const lineIdx = resolved.pattern.line;
    const colIdx = resolved.pattern.column;
    const sevIdx = resolved.pattern.severity;
    const msgIdx = resolved.pattern.message;

    const file = fileIdx != null ? (match[fileIdx] ?? '') : '';
    const line = lineIdx != null ? parseInt(match[lineIdx] ?? '0', 10) : 0;
    const column = colIdx != null ? parseInt(match[colIdx] ?? '0', 10) : 0;
    const rawSeverity = sevIdx != null ? (match[sevIdx] ?? '').toLowerCase() : 'error';
    const message = msgIdx != null ? (match[msgIdx] ?? '') : match[0];

    let severity: ProblemSeverity = 'error';
    if (rawSeverity === 'warning' || rawSeverity === 'warn') severity = 'warning';
    else if (rawSeverity === 'info' || rawSeverity === 'hint' || rawSeverity === 'note') severity = 'info';

    diagnostics.push({
      file,
      line,
      column,
      severity,
      message: message.trim(),
      owner: resolved.owner,
    });
  }

  return diagnostics;
}

/**
 * Resolve a problem matcher reference string to its definition.
 */
export function resolveMatcher(ref: string): ProblemMatcher | undefined {
  return BUILTIN_PROBLEM_MATCHERS[ref];
}

/**
 * Get all registered built-in problem matcher names.
 */
export function getBuiltinMatcherNames(): string[] {
  return Object.keys(BUILTIN_PROBLEM_MATCHERS);
}

/**
 * Clear task history.
 */
export function clearTaskHistory(): void {
  taskHistory.length = 0;
}

/**
 * Find a task by label from an array of task definitions.
 */
export function findTaskByLabel(tasks: TaskDefinition[], label: string): TaskDefinition | undefined {
  return tasks.find((t) => t.label === label);
}

/**
 * Validate a task definition for required fields.
 */
export function validateTask(task: TaskDefinition): string[] {
  const errors: string[] = [];
  if (!task.label) errors.push('Task must have a label');
  if (!task.type) errors.push('Task must have a type');
  if (task.type === 'shell' && !task.command) {
    errors.push('Shell tasks must have a command');
  }
  if (task.type === 'process' && !task.command) {
    errors.push('Process tasks must have a command');
  }
  if (task.dependsOn) {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn];
    for (const dep of deps) {
      if (typeof dep !== 'string' || dep.trim() === '') {
        errors.push(`Invalid dependency: "${dep}"`);
      }
    }
  }
  return errors;
}

/**
 * Build a flat ordered list of tasks respecting dependsOn for execution order.
 * Returns tasks in the order they should be executed (dependencies first).
 */
export function resolveTaskOrder(
  tasks: TaskDefinition[],
  rootLabel: string
): TaskDefinition[] {
  const taskMap = new Map<string, TaskDefinition>();
  for (const t of tasks) {
    taskMap.set(t.label, t);
  }

  const visited = new Set<string>();
  const ordered: TaskDefinition[] = [];

  function visit(label: string): void {
    if (visited.has(label)) return;
    visited.add(label);

    const task = taskMap.get(label);
    if (!task) return;

    const deps = task.dependsOn
      ? (Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn])
      : [];

    for (const dep of deps) {
      visit(dep);
    }

    ordered.push(task);
  }

  visit(rootLabel);
  return ordered;
}
