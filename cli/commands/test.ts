/**
 * Orion CLI - Test Command
 * Run project tests with AI-powered failure analysis and test generation.
 *
 * Usage:
 *   orion test                         # Auto-detect & run tests, AI analyzes failures
 *   orion test --generate src/auth.ts  # Generate tests for a file
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  readFileContent,
  writeFileContent,
  fileExists,
  loadProjectContext,
  getCurrentDirectoryContext,
  detectLanguage,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import {
  createStreamHandler,
  createSilentStreamHandler,
  readAndValidateFile,
  printFileInfo,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import { commandHeader, diffBlock, divider, palette, statusLine, box } from '../ui.js';
import { createBackup } from '../backup.js';
import inquirer from 'inquirer';

// ─── Prompts ────────────────────────────────────────────────────────────────

const TEST_ANALYSIS_PROMPT = `You are Orion, an expert developer assistant specializing in testing.

Analyze the test output and provide:
1. **Failed Tests**: List each failing test with a brief explanation
2. **Root Cause**: Why the tests are failing (e.g., logic error, API change, missing mock)
3. **Fix**: Specific code changes to fix each failing test
4. **Summary**: One-line overall assessment

Be concise, reference specific test names and line numbers when available.
Focus on actionable fixes the developer can apply immediately.`;

const TEST_GENERATE_PROMPT = `You are Orion, an expert test engineer. Generate comprehensive tests for the provided source file.

Rules:
- Detect the language and use the appropriate testing framework:
  - TypeScript/JavaScript: use vitest or jest (prefer vitest if unsure)
  - Python: use pytest
  - Rust: use built-in #[test] modules
  - Go: use testing package
  - Java: use JUnit 5
- Cover all exported functions/classes/methods
- Include edge cases, error handling, and boundary conditions
- Use descriptive test names that explain the expected behavior
- Include necessary imports and mocks
- Output ONLY the test file content, no explanation before or after
- Do NOT wrap the output in markdown code fences`;

// ─── Test Runner Detection ──────────────────────────────────────────────────

interface TestRunner {
  name: string;
  command: string;
  language: string;
  testDir?: string;
}

function detectTestRunner(): TestRunner | null {
  const cwd = process.cwd();

  // Node.js projects (package.json)
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const devDeps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };

      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        // Detect specific test runner from script or dependencies
        if (devDeps.vitest || scripts.test.includes('vitest')) {
          return { name: 'Vitest', command: 'npx vitest run', language: 'typescript' };
        }
        if (devDeps.jest || scripts.test.includes('jest')) {
          return { name: 'Jest', command: 'npx jest', language: 'typescript' };
        }
        if (devDeps.mocha || scripts.test.includes('mocha')) {
          return { name: 'Mocha', command: 'npx mocha', language: 'typescript' };
        }
        // Fallback to npm test
        return { name: 'npm test', command: 'npm test', language: 'typescript' };
      }

      // Check for test runner in devDeps even without test script
      if (devDeps.vitest) return { name: 'Vitest', command: 'npx vitest run', language: 'typescript' };
      if (devDeps.jest) return { name: 'Jest', command: 'npx jest', language: 'typescript' };
      if (devDeps.mocha) return { name: 'Mocha', command: 'npx mocha', language: 'typescript' };

      // Default for Node projects
      return { name: 'npm test', command: 'npm test', language: 'typescript' };
    } catch { /* ignore parse errors */ }
  }

  // Python projects
  if (fs.existsSync(path.join(cwd, 'pytest.ini'))
      || fs.existsSync(path.join(cwd, 'setup.py'))
      || fs.existsSync(path.join(cwd, 'pyproject.toml'))
      || fs.existsSync(path.join(cwd, 'requirements.txt'))) {

    // Check for pytest in pyproject.toml or requirements
    const hasPytest = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt'].some(f => {
      const fp = path.join(cwd, f);
      if (fs.existsSync(fp)) {
        try {
          return fs.readFileSync(fp, 'utf-8').includes('pytest');
        } catch { return false; }
      }
      return false;
    });

    if (hasPytest || fs.existsSync(path.join(cwd, 'pytest.ini'))) {
      return { name: 'pytest', command: 'python -m pytest -v', language: 'python', testDir: 'tests' };
    }

    return { name: 'unittest', command: 'python -m unittest discover', language: 'python', testDir: 'tests' };
  }

  // Rust projects
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { name: 'cargo test', command: 'cargo test', language: 'rust' };
  }

  // Go projects
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return { name: 'go test', command: 'go test ./...', language: 'go', testDir: '.' };
  }

  // Java projects (Maven)
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
    return { name: 'Maven', command: 'mvn test', language: 'java' };
  }

  // Java projects (Gradle)
  if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) {
    // cmd.exe cannot run `./gradlew`; the wrapper ships gradlew.bat for Windows.
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    return { name: 'Gradle', command: `${wrapper} test`, language: 'java' };
  }

  return null;
}

// ─── Test File Path Generator ───────────────────────────────────────────────

function generateTestFilePath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const ext = parsed.ext;
  const language = detectLanguage(sourcePath);

  switch (language) {
    case 'typescript':
    case 'javascript': {
      // src/auth.ts -> src/auth.test.ts or __tests__/auth.test.ts
      const testExt = ext.replace(/^\.([jt]s)x?$/, '.test.$1');
      // Place next to source file
      return path.join(parsed.dir, `${parsed.name}${testExt}`);
    }
    case 'python': {
      // src/auth.py -> tests/test_auth.py
      const testsDir = path.join(process.cwd(), 'tests');
      return path.join(testsDir, `test_${parsed.name}${ext}`);
    }
    case 'rust': {
      // Tests go inline in Rust, but for separate test files:
      // src/auth.rs -> tests/auth_test.rs
      const testsDir = path.join(process.cwd(), 'tests');
      return path.join(testsDir, `${parsed.name}_test${ext}`);
    }
    case 'go': {
      // src/auth.go -> src/auth_test.go
      return path.join(parsed.dir, `${parsed.name}_test${ext}`);
    }
    case 'java': {
      // src/main/java/.../Auth.java -> src/test/java/.../AuthTest.java
      const javaTestPath = parsed.dir.replace(
        /src[/\\]main[/\\]java/,
        'src/test/java'
      );
      return path.join(javaTestPath, `${parsed.name}Test${ext}`);
    }
    default: {
      return path.join(parsed.dir, `${parsed.name}.test${ext}`);
    }
  }
}

// ─── Run Tests ──────────────────────────────────────────────────────────────

interface TestResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

function runTests(command: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : '/bin/sh';
    const shellFlag = isWindows ? '/c' : '-c';

    const child = spawn(shell, [shellFlag, command], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code: number | null) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        duration: Date.now() - startTime,
      });
    });

    child.on('error', (err: Error) => {
      resolve({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: 1,
        duration: Date.now() - startTime,
      });
    });
  });
}

// ─── Test Generation ────────────────────────────────────────────────────────

async function generateTests(sourceFilePath: string): Promise<void> {
  const file = readAndValidateFile(sourceFilePath);
  if (!file) {
    process.exit(1);
  }

  const testPath = generateTestFilePath(sourceFilePath);
  const relativeTestPath = path.relative(process.cwd(), testPath);

  console.log(commandHeader('Orion Test Generator', [
    ['Source', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Output', colors.file(relativeTestPath)],
  ]));

  // Check if test file already exists
  if (fs.existsSync(testPath)) {
    const pipelineOpts = getPipelineOptions();

    if (!pipelineOpts.yes) {
      const answer = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `Test file already exists at ${relativeTestPath}. Overwrite?`,
        default: false,
      }]);

      if (!answer.overwrite) {
        printInfo('Aborted. Existing test file unchanged.');
        console.log();
        return;
      }
    }
  }

  const spinner = startSpinner('Generating tests...');

  try {
    const projectContext = loadProjectContext();
    const dirContext = getCurrentDirectoryContext();

    const userMessage = [
      `Generate tests for this ${file.language} file.`,
      `File path: ${file.resolvedPath}`,
      `Project context:\n${dirContext}`,
      `\nSource code:\n\`\`\`${file.language}\n${file.content}\n\`\`\``,
    ].join('\n');

    const fullPrompt = projectContext
      ? TEST_GENERATE_PROMPT + '\n\nProject context:\n' + projectContext
      : TEST_GENERATE_PROMPT;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Tests generated');
    await askAI(fullPrompt, userMessage, callbacks, { requireComplete: true });

    let testContent = getResponse();

    // Clean up potential code fences
    if (testContent.startsWith('```')) {
      const lines = testContent.split('\n');
      lines.shift(); // Remove opening fence
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop(); // Remove closing fence
      }
      testContent = lines.join('\n');
    }

    if (!testContent.trim()) {
      throw new Error('The AI returned an empty test file. Nothing was written.');
    }

    const pipelineOpts = getPipelineOptions();
    const testFileExists = fs.existsSync(testPath);

    if (pipelineOpts.dryRun) {
      if (!pipelineOpts.quiet) {
        console.log();
        console.log(diffBlock(testFileExists ? fs.readFileSync(testPath, 'utf-8') : '', testContent, relativeTestPath));
      }
      printInfo('Dry run: no files were modified.');
      jsonOutput('test_generate', { source: file.resolvedPath, testFile: testPath, dryRun: true });
      return;
    }

    // An existing test file is only replaced once `orion undo` can bring it back.
    if (testFileExists) {
      createBackup(testPath);
    }

    // Ensure output directory exists
    const testDir = path.dirname(testPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    writeFileContent(testPath, testContent);

    console.log();
    printSuccess(`Test file created: ${colors.file(relativeTestPath)}`);
    console.log();
    console.log(`  ${palette.dim('Run tests with:')} ${colors.command(`orion test`)}`);
    console.log();

    jsonOutput('test_generate', {
      source: file.resolvedPath,
      testFile: testPath,
      language: file.language,
    });
  } catch (err: any) {
    stopSpinner(spinner, err.message, false);
    printError(`Test generation failed: ${err.message}`);
    printInfo('Run `orion config` to check your AI provider settings.');
    console.log();
    process.exit(1);
  }
}

// ─── Main Command ───────────────────────────────────────────────────────────

export async function testCommand(options: { generate?: string } = {}): Promise<void> {
  // Test generation mode
  if (options.generate) {
    await generateTests(options.generate);
    return;
  }

  // Test run mode: auto-detect and run
  const runner = detectTestRunner();

  if (!runner) {
    console.log(commandHeader('Orion Test'));
    console.log();
    printError('Could not detect a test runner for this project.');
    console.log();
    console.log(`  ${palette.dim('Supported projects:')}`);
    console.log(`    ${palette.dim('\u2022')} Node.js ${palette.dim('(npm test, vitest, jest, mocha)')}`);
    console.log(`    ${palette.dim('\u2022')} Python  ${palette.dim('(pytest, unittest)')}`);
    console.log(`    ${palette.dim('\u2022')} Rust    ${palette.dim('(cargo test)')}`);
    console.log(`    ${palette.dim('\u2022')} Go      ${palette.dim('(go test)')}`);
    console.log(`    ${palette.dim('\u2022')} Java    ${palette.dim('(maven, gradle)')}`);
    console.log();
    printInfo('Make sure you are in a project root directory.');
    console.log();
    process.exit(1);
  }

  console.log(commandHeader('Orion Test', [
    ['Runner', `${runner.name} ${palette.dim(`(${runner.language})`)}`],
    ['Command', colors.command(runner.command)],
  ]));
  console.log();

  // Run the tests
  const result = await runTests(runner.command);
  console.log();

  const durationStr = `${(result.duration / 1000).toFixed(1)}s`;

  if (result.exitCode === 0) {
    // All tests passed
    console.log(statusLine('\u2713', `All tests passed ${palette.dim(`(${durationStr})`)}`));
    console.log();
    jsonOutput('test_result', {
      runner: runner.name,
      command: runner.command,
      exitCode: 0,
      duration: durationStr,
      success: true,
    });
    return;
  }

  // Tests failed - analyze with AI
  console.log(statusLine('\u2717', `Tests failed with exit code ${result.exitCode} ${palette.dim(`(${durationStr})`)}`));
  console.log();

  const spinner = startSpinner('Analyzing test failures with AI...');

  try {
    const projectContext = loadProjectContext();
    const dirContext = getCurrentDirectoryContext();

    const testOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');

    // Truncate if too long
    const maxOutput = 4000;
    const truncatedOutput = testOutput.length > maxOutput
      ? '... (truncated)\n' + testOutput.slice(-maxOutput)
      : testOutput;

    const userMessage = [
      `Test runner: ${runner.name}`,
      `Command: ${runner.command}`,
      `Exit code: ${result.exitCode}`,
      `Language: ${runner.language}`,
      `Working directory:\n${dirContext}`,
      `\nTest output:\n\`\`\`\n${truncatedOutput}\n\`\`\``,
    ].join('\n');

    const fullPrompt = projectContext
      ? TEST_ANALYSIS_PROMPT + '\n\nProject context:\n' + projectContext
      : TEST_ANALYSIS_PROMPT;

    const { callbacks } = createStreamHandler(spinner, {
      label: 'AI Diagnosis',
      markdown: true,
    });

    await askAI(fullPrompt, userMessage, callbacks);
    console.log();

    jsonOutput('test_result', {
      runner: runner.name,
      command: runner.command,
      exitCode: result.exitCode,
      duration: durationStr,
      success: false,
    });

    // Failing tests must fail the process for scripts and CI. exitCode (not
    // exit()) lets the JSON line and update notice flush first.
    process.exitCode = result.exitCode || 1;
  } catch (err: any) {
    stopSpinner(spinner, err.message, false);
    printError(`AI analysis failed: ${err.message}`);
    printInfo('Run `orion config` to check your AI provider settings.');
    console.log();
    process.exit(1);
  }
}
