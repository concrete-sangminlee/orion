# Contributing to Orion IDE

Thank you for your interest in contributing to Orion! This guide will help you get started.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Project Structure](#project-structure)
- [Adding a New CLI Command](#adding-a-new-cli-command)
- [Adding an IPC Channel (Desktop IDE)](#adding-an-ipc-channel-desktop-ide)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)

## Development Environment Setup

### Prerequisites

- **Node.js** >= 22.12.0 (we recommend using [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm))
- **npm** >= 9.0.0
- **Git**

### Getting Started

1. **Fork the repository** on GitHub.

2. **Clone your fork:**
   ```bash
   git clone https://github.com/<your-username>/orion.git
   cd orion
   ```

3. **Install dependencies:**
   ```bash
   npm ci
   ```

4. **Build the CLI:**
   ```bash
   npm run cli:build
   ```

5. **Run the checks:**
   ```bash
   npm run typecheck   # renderer, electron, and CLI projects
   npm test -- --run   # all test suites
   ```

6. **Start the development server** (for the Electron IDE):
   ```bash
   npm run dev
   ```

### Environment Variables

To use AI features locally, configure at least one provider:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for Claude models |
| `OPENAI_API_KEY` | API key for GPT models |
| `OLLAMA_HOST` | Host URL for local Ollama instance (default: `http://localhost:11434`) |

## Project Structure

```
orion/
  cli/              # CLI source code (TypeScript)
    commands/       # Individual command implementations
    index.ts        # CLI entry point
  src/              # Electron IDE source code
  dist-cli/         # Built CLI output (generated)
  dist-electron/    # Built Electron output (generated)
  tests/            # Test files
```

## Adding an IPC Channel (Desktop IDE)

Every renderer ↔ main-process channel is declared once in
[`shared/ipc-contract.ts`](shared/ipc-contract.ts). The compiler then checks
the main handler, the preload method, and every renderer call against it.

1. **Declare it** in `IpcInvokeContract` (request/response), `IpcSendContract`
   (fire-and-forget), or `IpcEventContract` (main → renderer push), and add it
   to the matching `IPC_*_CHANNELS` list in `shared/ipc-channels.ts` — the
   compiler rejects the list until it matches the contract exactly.
2. **Implement it** in `electron/ipc/*.ts` with `handle()` / `listen()` /
   `emit()` from `electron/ipc/typed-ipc.ts` — never raw `ipcMain` or
   `webContents.send`. Treat every argument as untrusted: declare it `unknown`
   in the handler and validate it (see the `*-guard.ts` modules).
3. **Expose it** in `electron/preload-api.ts`. `window.api` in the renderer is
   typed from that object, so do not edit `src/types/electron.d.ts`.
4. **Use it** through `window.api` only. `window.electron`,
   `window.electronAPI`, and `(window as any).api` are rejected by
   `src/__tests__/ipc-bridge-usage.test.ts` for any module the app can load.

`electron/preload-api.test.ts` and `electron/ipc/ipc-registration.test.ts`
fail if a channel is declared but not exposed, registered, or emitted.

`npm run audit:reachability` lists renderer modules that `src/main.tsx` never
imports. Code there is type-checked but never ships, so wire a module into
the app before fixing or extending it.

## Adding a New CLI Command

Follow these steps to add a new command to the Orion CLI:

### Step 1: Create the Command File

Create a new TypeScript file in `cli/commands/`:

```typescript
// cli/commands/my-command.ts
import { Command } from 'commander';

export function registerMyCommand(program: Command): void {
  program
    .command('my-command')
    .description('Brief description of what this command does')
    .option('-f, --flag <value>', 'description of the flag')
    .action(async (options) => {
      // Command implementation
    });
}
```

### Step 2: Register the Command

Import and register your command in the CLI entry point so it becomes available.

### Step 3: Add Tests

Create a corresponding test file:

```typescript
// tests/cli/my-command.test.ts
import { describe, it, expect } from 'vitest';

describe('my-command', () => {
  it('should do the expected thing', () => {
    // Test implementation
  });
});
```

### Step 4: Build and Verify

```bash
npm run cli:build
node dist-cli/index.mjs my-command --help
npm run test:cli
```

## Code Style Guidelines

### General Rules

- **TypeScript** is required for all source files.
- Use **ES modules** (`import`/`export`), not CommonJS (`require`).
- Target **Node.js 22.12+** -- avoid APIs unavailable in the supported runtime.
- Prefer `async`/`await` over raw promises or callbacks.
- Use meaningful variable and function names.
- Keep functions focused: each function should do one thing well.

### Formatting

- Use **2-space indentation**.
- Use **single quotes** for strings.
- Include **trailing commas** in multi-line structures.
- Add **semicolons** at the end of statements.

### File Organization

- One command per file in `cli/commands/`.
- Group related utilities into shared modules.
- Keep imports sorted: external packages first, then local modules.

### Error Handling

- Always handle errors gracefully in CLI commands.
- Provide clear, actionable error messages to the user.
- Use `process.exit(1)` for fatal errors, not thrown exceptions at the top level.

## Testing Requirements

### What to Test

- **All new CLI commands** must have corresponding tests.
- **Bug fixes** must include a regression test.
- **Edge cases**: empty input, invalid arguments, missing API keys.

### Running Tests

```bash
# Run all CLI tests
npm run test:cli

# Run tests in watch mode
npm run test -- --watch

# Run a specific test file
npx vitest run tests/cli/my-command.test.ts
```

### Test Guidelines

- Use `describe` blocks to group related tests.
- Use clear `it` descriptions that explain the expected behavior.
- Mock external services (AI providers, network calls).
- Tests must pass on all supported platforms (Linux, macOS, Windows) and Node.js 22.12+.

## Pull Request Process

### Before Submitting

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** and commit with clear messages:
   ```bash
   git commit -m "feat: add my-command for doing X"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for refactoring
   - `test:` for adding or updating tests
   - `chore:` for maintenance tasks

3. **Ensure all checks pass:**
   ```bash
   npm run cli:build
   npm run test:cli
   ```

4. **Push your branch:**
   ```bash
   git push origin feature/my-feature
   ```

### Submitting the PR

1. Open a pull request against the `main` branch.
2. Fill out the PR template completely.
3. Link any related issues.
4. Wait for CI checks to pass.

### Review Process

- A maintainer will review your PR, usually within a few days.
- Address any requested changes by pushing new commits to your branch.
- Once approved, a maintainer will merge your PR.

### After Merge

- Delete your feature branch.
- Pull the latest `main` to keep your fork up to date.

## Questions?

If you have questions or need help, feel free to:

- Open a [Discussion](https://github.com/concrete-sangminlee/orion/discussions)
- File an [Issue](https://github.com/concrete-sangminlee/orion/issues)

Thank you for helping make Orion better!
