/**
 * Orion CLI - AI-Powered Performance Analysis
 * Analyzes code for performance bottlenecks, complexity, and memory issues.
 *
 * Usage:
 *   orion benchmark src/utils.ts        # Analyze file for performance issues
 *   orion benchmark --memory            # Memory usage analysis
 *   orion benchmark --complexity        # Time complexity analysis
 */

import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  loadProjectContext,
} from '../utils.js';
import {
  createStreamHandler,
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { readStdin } from '../stdin.js';
import { commandHeader, badge, table as uiTable, divider, palette } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const BENCHMARK_GENERAL_PROMPT = `You are Orion, an expert performance analyst. Analyze the provided source code for performance issues and optimization opportunities.

You MUST structure your response with these exact sections and table format:

## Performance Summary

| Area | Status | Impact |
|------|--------|--------|
| Time Complexity | <rating: Optimal/Acceptable/Needs Work/Critical> | <brief impact> |
| Memory Usage | <rating> | <brief impact> |
| I/O Efficiency | <rating> | <brief impact> |
| Concurrency | <rating> | <brief impact> |

## Bottlenecks Found

For each bottleneck:
### <number>. <title>
- **Severity:** Critical / High / Medium / Low
- **Location:** function/line reference
- **Current complexity:** O(n^2), O(n log n), etc.
- **Issue:** What's slow and why
- **Optimized code:**
\`\`\`
<show optimized version>
\`\`\`
- **Expected improvement:** e.g., "2-10x faster for large datasets"

## Optimization Recommendations

Ordered by impact (highest first):
1. <recommendation with code example>
2. <recommendation with code example>
...

## Overall Performance Score: <1-10>/10

Use markdown formatting. Be specific with Big-O analysis and quantified improvements.`;

const BENCHMARK_MEMORY_PROMPT = `You are Orion, an expert memory analysis specialist. Analyze the provided source code specifically for memory-related issues.

You MUST structure your response with these exact sections and table format:

## Memory Analysis Summary

| Category | Status | Details |
|----------|--------|---------|
| Memory Leaks | <None/Potential/Confirmed> | <details> |
| Allocation Patterns | <Optimal/Acceptable/Excessive> | <details> |
| Data Structure Choice | <Optimal/Suboptimal> | <details> |
| Garbage Collection | <Friendly/Problematic> | <details> |

## Memory Issues Found

For each issue:
### <number>. <title>
- **Type:** Leak / Excessive Allocation / Unbounded Growth / Retained Reference
- **Location:** function/line reference
- **Issue:** Detailed description
- **Memory impact:** Estimated memory waste
- **Fix:**
\`\`\`
<corrected code>
\`\`\`

## Memory Optimization Tips

1. <specific tip with code example>
2. <specific tip with code example>
...

## Estimated Memory Profile
- **Baseline:** estimated memory at startup
- **Under load:** estimated memory with typical usage
- **Worst case:** maximum possible memory consumption

Use markdown formatting. Focus on practical, actionable findings.`;

const BENCHMARK_COMPLEXITY_PROMPT = `You are Orion, an expert algorithm complexity analyst. Analyze the provided source code specifically for time and space complexity.

You MUST structure your response with these exact sections and table format:

## Complexity Analysis

| Function/Method | Time Complexity | Space Complexity | Notes |
|-----------------|----------------|-----------------|-------|
| <name> | O(...) | O(...) | <brief note> |
| <name> | O(...) | O(...) | <brief note> |
...

## Detailed Analysis

For each non-trivial function:
### <function_name>
- **Time:** O(...) — explain how you derived this
- **Space:** O(...) — explain auxiliary space usage
- **Best case:** O(...)
- **Average case:** O(...)
- **Worst case:** O(...)
- **Bottleneck:** identify the dominant operation

## Complexity Improvements

For functions with suboptimal complexity:
### <function_name>: O(current) -> O(improved)
- **Strategy:** explain the algorithmic improvement
- **Optimized code:**
\`\`\`
<show improved implementation>
\`\`\`
- **Trade-offs:** what you gain vs. what you sacrifice

## Overall Complexity Score: <1-10>/10

Use markdown formatting. Be rigorous with Big-O derivations.`;

// ─── Output Rendering ────────────────────────────────────────────────────────

function renderBenchmarkOutput(text: string): void {
  const lines = text.split('\n');
  const buffer: string[] = [];

  function flushBuffer(): void {
    if (buffer.length > 0) {
      const block = buffer.join('\n');
      if (block.trim()) {
        console.log(renderMarkdown(block));
      }
      buffer.length = 0;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Highlight severity keywords in bottleneck listings
    if (trimmed.includes('**Severity:** Critical') || trimmed.includes('**Severity:** critical')) {
      flushBuffer();
      console.log(`  ${badge('CRITICAL', '#DC2626')} ${palette.red(trimmed.replace(/\*\*Severity:\*\*\s*Critical/i, '').trim())}`);
    } else if (trimmed.includes('**Severity:** High') || trimmed.includes('**Severity:** high')) {
      flushBuffer();
      console.log(`  ${badge('HIGH', '#F59E0B')} ${palette.yellow(trimmed.replace(/\*\*Severity:\*\*\s*High/i, '').trim())}`);
    } else {
      buffer.push(line);
    }
  }

  flushBuffer();
}

// ─── Command Modes ───────────────────────────────────────────────────────────

async function benchmarkFile(
  filePath: string,
  mode: 'general' | 'memory' | 'complexity'
): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  const modeLabels: Record<string, string> = {
    general: 'Performance Analysis',
    memory: 'Memory Analysis',
    complexity: 'Complexity Analysis',
  };

  const modeBadges: Record<string, string> = {
    general: 'PERF',
    memory: 'MEMORY',
    complexity: 'O(n)',
  };

  console.log(commandHeader('Orion Benchmark', [
    ['File', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Mode', modeLabels[mode]],
  ]));
  console.log();

  const spinnerMessages: Record<string, string> = {
    general: 'Analyzing performance characteristics...',
    memory: 'Scanning for memory issues...',
    complexity: 'Computing time & space complexity...',
  };

  const spinner = startSpinner(spinnerMessages[mode]);

  const prompts: Record<string, string> = {
    general: BENCHMARK_GENERAL_PROMPT,
    memory: BENCHMARK_MEMORY_PROMPT,
    complexity: BENCHMARK_COMPLEXITY_PROMPT,
  };

  try {
    const projectContext = loadProjectContext();
    const systemPrompt = prompts[mode];
    const fullSystemPrompt = projectContext
      ? systemPrompt + '\n\nProject context:\n' + projectContext
      : systemPrompt;

    const userMessage = `Analyze this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        spinner.stop();
        console.log();
        renderBenchmarkOutput(text);
        console.log();
      },
      onError(error: Error) {
        spinner.fail(colors.error(error.message));
      },
    });
  } catch (err: any) {
    spinner.stop();
    printCommandError(err, 'benchmark', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

async function benchmarkStdin(
  content: string,
  mode: 'general' | 'memory' | 'complexity'
): Promise<void> {
  const lineCount = content.split('\n').length;

  const modeLabels: Record<string, string> = {
    general: 'Performance Analysis',
    memory: 'Memory Analysis',
    complexity: 'Complexity Analysis',
  };

  console.log(commandHeader('Orion Benchmark', [
    ['Source', 'piped input'],
    ['Lines', String(lineCount)],
    ['Mode', modeLabels[mode]],
  ]));
  console.log();

  const spinner = startSpinner('Analyzing performance...');

  const prompts: Record<string, string> = {
    general: BENCHMARK_GENERAL_PROMPT,
    memory: BENCHMARK_MEMORY_PROMPT,
    complexity: BENCHMARK_COMPLEXITY_PROMPT,
  };

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const projectContext = loadProjectContext();
    const systemPrompt = prompts[mode];
    const fullSystemPrompt = projectContext
      ? systemPrompt + '\n\nProject context:\n' + projectContext
      : systemPrompt;

    const userMessage = `Analyze this code for performance:\n\n\`\`\`\n${content}\n\`\`\``;

    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'benchmark', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Exported Command ────────────────────────────────────────────────────────

export async function benchmarkCommand(
  file?: string,
  options?: { memory?: boolean; complexity?: boolean }
): Promise<void> {
  // Determine analysis mode
  let mode: 'general' | 'memory' | 'complexity' = 'general';
  if (options?.memory) mode = 'memory';
  if (options?.complexity) mode = 'complexity';

  if (file) {
    await benchmarkFile(file, mode);
  } else {
    // Check for piped input
    const stdinData = await readStdin();
    if (stdinData) {
      await benchmarkStdin(stdinData, mode);
    } else {
      console.log();
      console.log(`  ${colors.error('Please provide a file path or pipe content via stdin.')}`);
      console.log();
      console.log(`  ${palette.violet.bold('Usage:')}`);
      console.log(`  ${palette.dim('  orion benchmark src/utils.ts        # Analyze file for performance issues')}`);
      console.log(`  ${palette.dim('  orion benchmark src/utils.ts --memory      # Memory usage analysis')}`);
      console.log(`  ${palette.dim('  orion benchmark src/utils.ts --complexity  # Time complexity analysis')}`);
      console.log(`  ${palette.dim('  cat file.ts | orion benchmark              # Pipe content for analysis')}`);
      console.log();
      process.exit(1);
    }
  }
}
