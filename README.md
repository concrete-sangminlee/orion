<h1 align="center">
  <br>
  <img src="https://raw.githubusercontent.com/concrete-sangminlee/orion/main/public/icon.svg" width="120" alt="Orion">
  <br>
  Orion
  <br>
</h1>

<h3 align="center">AI-Powered Coding Assistant for the Terminal, plus a Desktop IDE</h3>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#cli-commands"><strong>CLI Commands</strong></a> ·
  <a href="#desktop-ide"><strong>Desktop IDE</strong></a> ·
  <a href="#contributing"><strong>Contributing</strong></a>
</p>

<p align="center">
  <a href="https://github.com/concrete-sangminlee/orion/actions"><img src="https://img.shields.io/github/actions/workflow/status/concrete-sangminlee/orion/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/github/license/concrete-sangminlee/orion?style=flat-square&color=22C55E" alt="License">
  <img src="https://img.shields.io/badge/version-2.2.0-7C5CFC?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/commands-71-38BDF8?style=flat-square" alt="Commands">
  <img src="https://img.shields.io/badge/tests-1710%20passing-22C55E?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/platform-Win%20%7C%20Mac%20%7C%20Linux-F59E0B?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20GPT%20%7C%20Ollama-9B59B6?style=flat-square" alt="AI">
  <img src="https://img.shields.io/github/stars/concrete-sangminlee/orion?style=flat-square" alt="Stars">
</p>

---

## What is Orion?

Orion is an **open-source AI coding tool** with two modes:

**CLI** — 71 commands for AI-assisted coding directly in your terminal. Chat with AI, review code, fix bugs, generate tests, search codebases — all from the command line. Switch between Claude, GPT, and local Ollama models mid-conversation.

**Desktop IDE** — A code editor built on Electron and Monaco Editor, with 18 themes, an integrated terminal, a Source Control panel, an AI chat panel, inline AI edit and inline AI completion.

```
  ✦  O R I O N
  ·  AI-Powered Coding Assistant
  ·  v2.2.0 · Linux

  $ orion ask "How do I optimize this React component?" @src/App.tsx

  $ orion fix src/auth.ts --auto    # Fix → Test → Iterate until passing

  $ git diff | orion review         # AI code review from pipe

  $ orion chat                      # Interactive chat with /claude /gpt /ollama
```

---

## Why Orion?

| | Orion |
|---|---|
| **Cross-platform** | Win/Mac/Linux (CI runs on all three) |
| **Built-in AI** | Claude, GPT, Ollama |
| **Local models** | Ollama (free, no API key) |
| **Provider switching** | Hot-switch mid-chat (`/claude` `/gpt` `/ollama` `/switch`) |
| **Auto fix loop** | `orion fix --auto`: fix → test → iterate |
| **File ops in chat** | /read /write /run /ls /cat /cd |
| **Custom commands** | .orion/commands/*.md |
| **Plan mode** | `orion plan` writes an implementation plan |
| **Code generation** | `orion generate` (component, api, model, hook, test, middleware, page, service) for the detected framework |
| **File backup/undo** | Automatic before edit, fix, refactor, migrate, format, `run --fix` and `test --generate` write; `orion undo` restores |
| **Unix pipes** | ask, review, explain, fix, summarize, docs, debug and more read stdin |
| **Web fetch** | `orion fetch URL`, /fetch URL in chat |
| **Natural language shell** | orion shell |
| **TODO scanner** | orion todo --fix |
| **Dependency analysis** | orion deps |
| **Migration** | JS→TS, py2→3, class→hooks, callbacks→async, CommonJS→ESM, Vue Options→Composition API |
| **Health check** | orion doctor |
| **Desktop IDE** | Included |
| **Price** | Free & open source (MIT) |

---

## Install

Orion is not published to the npm registry yet. Install the CLI from a clone:

```bash
git clone https://github.com/concrete-sangminlee/orion.git
cd orion
npm install
npm run cli:build
npm install -g .              # puts `orion` on your PATH
```

---

## Quick Start

```bash
orion tutorial                # Interactive getting-started walkthrough
orion chat                    # AI chat
orion ask "What does this do?" @file.ts   # Quick question
orion status                  # Check setup
```

### Prerequisites

| Requirement | How to install |
|------------|----------------|
| **Node.js 22.12+** | [nodejs.org](https://nodejs.org) |
| **C++ Build Tools** (desktop IDE terminal only) | `node-pty` is an optional dependency. macOS and Windows use its prebuilt binaries; on Linux it compiles: `sudo apt install build-essential python3` |
| **Ollama** (optional) | [ollama.com](https://ollama.com) — `ollama pull llama3.2` |

---

## CLI Commands

### 71 commands organized in 14 categories:

```
Core:       chat · ask · explain · review · fix · edit · commit (7)
Code:       search · diff · pr · run · test · agent · refactor · compare (8)
Generate:   plan · generate · docs · snippet · scaffold · boilerplate (6)
Tools:      shell · todo · fetch · changelog · log · summarize · migrate · deps · format · translate · env (11)
Analysis:   debug · benchmark · security · typecheck · optimize (5)
AI:         learn · pair · context (3)
Safety:     undo · status · doctor · clean (4)
Session:    session · watch · config · init · gui · completions (6)
Git:        hooks · alias · blame (3)
Config:     profile · metrics · history · config-export (4)
Data:       csv · http · diff-files · stats (4)
Insights:   map · cost (2)
Extend:     plugin · api · regex · cron (4)
Help:       tutorial · examples · update · info (4)
```
Total: 71

### Core — AI Coding

```bash
orion chat                          # Interactive AI chat (with file/shell tools)
orion ask "question" @file1 @file2  # Quick question with file context
orion explain src/app.ts            # Explain what code does
orion review src/app.ts             # AI code review with severity levels
orion fix src/app.ts                # Find and fix bugs
orion fix src/app.ts --auto         # Fix → test → iterate until passing
orion edit src/app.ts               # AI-assisted file editing
orion commit                        # Generate AI commit message
```

### Code — Codebase Operations

```bash
orion search "authentication"       # Search codebase + AI analysis
orion diff                          # Review uncommitted changes with AI
orion diff --staged                 # Review staged changes
orion pr                            # Generate PR description from branch
orion pr --review                   # AI reviews all branch changes
orion run "npm test"                # Run command, AI diagnoses errors
orion run "npm run build" --fix     # Run, diagnose, and auto-fix
orion test                          # Run tests, AI analyzes failures
orion test --generate src/auth.ts   # Generate tests for a file
orion agent "task1" "task2" "task3" # Run multiple AI tasks in parallel
orion refactor src/app.ts --simplify  # AI refactoring
orion compare file1.ts file2.ts     # Compare two files with AI
```

### Generate — Code & Docs Generation

```bash
orion plan "Add auth to the app"    # AI implementation plan, saved to .orion/plans/ (no code changes)
orion generate component LoginForm  # Generate code for the detected framework
orion docs src/app.ts               # Generate JSDoc/docstrings
orion docs src/ --readme            # Generate README for directory
orion docs src/app.ts --api         # Generate API documentation
```

### Tools — Dev Automation

```bash
orion shell                         # Natural language -> shell commands
orion todo                          # Scan for TODO/FIXME/HACK comments
orion todo --fix                    # AI suggests fixes for each TODO
orion fetch https://docs.api.com    # Fetch URL content for AI context
orion changelog                     # Generate changelog from git history
orion changelog --days 7            # Last 7 days
orion migrate src/app.js --to typescript  # JS->TS, py2->3, class->hooks
orion deps                          # Analyze dependencies
orion deps --security               # Security audit
orion deps --unused                 # Find unused packages
orion snippet save "name" --file f  # Save code snippet from file
orion snippet list                  # List all saved snippets
orion snippet generate "desc"       # AI-generate a new snippet
orion compare --approach "React vs Vue?" # Compare tech approaches
```

### Analysis — Debug & Security

```bash
orion debug src/app.ts              # Analyze file for potential bugs
orion debug --error "msg"           # Diagnose a specific error
orion debug --stacktrace            # Paste stack trace for analysis
orion benchmark src/app.ts          # Analyze file for performance
orion benchmark --memory src/app.ts # Memory usage analysis
orion benchmark --complexity src/app.ts # Time complexity analysis
orion security src/                 # Scan for security vulnerabilities
orion security --owasp              # OWASP Top 10 audit
orion typecheck src/app.ts          # Analyze types, suggest improvements
orion typecheck src/app.ts --strict # Strict type safety audit
orion typecheck src/app.js --convert # JS to TypeScript conversion
```

### Safety — Backup & Recovery

```bash
orion undo                          # Restore last file from backup
orion undo --list                   # List all backups
orion undo --file src/app.ts        # Undo specific file
orion status                        # Environment dashboard
orion doctor                        # Full health check (9 checks)
```

### Session & Automation

```bash
orion session new "project"         # Create named session
orion session resume "project"      # Continue where you left off
orion session export "project"      # Export as markdown
orion watch "*.ts" --on-change review  # Auto-review on file change
orion config                        # Set up API keys and models
orion init                          # Create .orion/context.md project memory
orion completions bash              # Generate shell completions
```

### Chat Tools (inside `orion chat`)

```bash
/read src/app.ts                    # Add file to conversation context
/write output.ts                    # Write AI's code block to file
/run npm test                       # Run command, add output to context
/ls                                 # List directory
/cat src/app.ts                     # View file with line numbers
/cd src                             # Change directory
/fetch https://docs.api.com         # Fetch URL into context
/my-custom-command                  # Custom commands from .orion/commands/
```

### Unix Pipes

```bash
cat error.log | orion ask "What's wrong?"
git diff | orion review
cat app.ts | orion explain
cat app.ts | orion fix > fixed.ts
```

### Global Flags

```bash
--json          # Structured JSON output (CI/CD)
--yes / -y      # Auto-confirm all prompts
--dry-run       # Preview changes without writing
--quiet         # Minimal output
--no-color      # Disable colors
```

Every command accepts these flags; each command honors the ones it implements (for example, 27 commands emit `--json` output and 13 honor `--dry-run`).

### Chat Provider Switching

```bash
orion chat
# Inside chat:
/claude              # Switch to Claude
/gpt                 # Switch to GPT
/ollama              # Switch to Ollama (local)
/model deepseek-r1   # Use specific model
/models              # List model shortcuts and installed Ollama models
/switch              # Cycle providers
```

---

## Desktop IDE

Launch with `npm run dev` (Vite dev server and Electron) or `orion gui` (builds and starts the app from the clone the CLI was installed from).

Build installers with `npm run package:win`, `npm run package:mac` or `npm run package:linux` (output in `release/<version>/`).

### Features

- **Monaco Editor** — Syntax highlighting, minimap, bracket pair colorization, inline AI edit (Ctrl+I), inline AI completion (local Ollama by default, or Claude Haiku 5.5 when chosen in Settings)
- **18 Built-in Themes** — Orion Dark, GitHub Light, Tokyo Night, Catppuccin Mocha, Dracula, Nord, and more
- **AI Chat Panel** — Streaming chat with markdown rendering; local Ollama (default), Claude, GPT, Kimi, Gemini, or NVIDIA NIM models. API keys are kept in the main process and encrypted at rest with the OS keychain (Electron safeStorage; on Linux without a keyring it only obfuscates them)
- **Integrated Terminal** — @xterm/xterm + node-pty with multiple and split sessions
- **Git Integration** — Source control (stage, commit, push/pull, branches, stash, tags, cherry-pick), per-file timeline, conflicted-file list and abort during a merge
- **Panels** — Explorer, Search, Source Control, Outline and AI Chat; Terminal, Output and Problems in the bottom panel
- **Command Palette** — Ctrl+Shift+P with fuzzy search

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+I` | Inline AI Edit |
| `Ctrl+L` | Show AI Chat |
| `Ctrl+B` | Toggle Sidebar |
| `` Ctrl+` `` | Toggle Terminal |

On macOS, use Cmd instead of Ctrl. While the editor or the terminal has focus, Ctrl+L stays with them (the editor selects the line, the terminal clears the screen).

---

## AI Providers

| Provider | Models | Cost | Setup |
|----------|--------|------|-------|
| **Ollama** | llama3.2 (default), deepseek-r1, mistral, qwen2.5-coder, + any installed model | **Free** | `ollama pull llama3.2` |
| **Anthropic** | Claude Opus 5.5 (default), Sonnet 5.5, Haiku 5.5, Fable 5.1 | API key | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | GPT-4o (default), GPT-4o-mini, o3, o3-mini | API key | [platform.openai.com](https://platform.openai.com) |

These are the CLI's models (`/models` in `orion chat` lists them). The CLI uses the provider chosen with `orion config`; otherwise it uses Anthropic or OpenAI when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (or a key saved by `orion config`) is set, then a running Ollama. The desktop IDE's chat offers Ollama, Claude Opus 5.5, GPT-6.1 Sol, Kimi K3.1 Pro, Gemini 3.6 Flash and NVIDIA NIM models (Llama 3.3, Nemotron, DeepSeek R1, Qwen 2.5), with keys entered in Settings.

Ollama works out of the box with no API key. Run `orion config` for API key setup.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| CLI | Node.js · Commander · Chalk · Ora · Marked |
| Desktop | Electron 42 · React 19 · TypeScript 5.9 |
| Editor | Monaco Editor 0.52 |
| Terminal | @xterm/xterm 6 · node-pty |
| State | Zustand 5 (17 stores) |
| Styling | TailwindCSS v4 |
| Build | Vite 6 · esbuild |
| AI | Anthropic SDK · OpenAI SDK · Ollama API |
| Packaging | electron-builder 26 |

---

## Project Structure

```
orion/
├── cli/                        # CLI tool (71 commands)
│   ├── index.ts                # Entry point
│   ├── ai-client.ts            # Multi-provider AI client
│   ├── ui.ts                   # Terminal UI components (boxes, tables, badges)
│   ├── markdown.ts             # Terminal markdown renderer
│   ├── backup.ts               # Automatic backup system
│   ├── shared.ts               # Shared patterns
│   ├── pipeline.ts             # CI/CD pipeline mode
│   ├── stdin.ts                # Unix pipe support
│   └── commands/               # Command implementations
│       ├── chat.ts             # Interactive chat with hot-switch
│       ├── ask.ts              # Quick questions with @file refs
│       ├── review.ts           # Code review with severity
│       ├── fix.ts              # Auto-fix with test loop
│       ├── edit.ts             # AI file editing
│       ├── search.ts           # Codebase search + AI
│       ├── diff.ts             # Git diff AI review
│       ├── run.ts              # Command execution + diagnosis
│       ├── test.ts             # Test runner + generation
│       ├── undo.ts             # Backup restore
│       └── ...
├── electron/                   # Desktop main process
├── src/                        # Desktop renderer (React)
│   ├── components/             # 24 UI components
│   ├── panels/                 # 10 workspace panels
│   ├── store/                  # 17 Zustand stores
│   └── themes/                 # 18 built-in themes
├── shared/                     # Shared types, IPC contract & constants
└── package.json
```

---

## Contributing

We welcome contributions from everyone! Here's how to get involved:

### Getting Started

```bash
# 1. Fork the repo on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/orion.git
cd orion

# 3. Install dependencies
npm install

# 4. Create a branch
git checkout -b feat/my-feature

# 5. Make changes and test
npm run typecheck
npm test -- --run
npm run cli:build && node dist-cli/index.mjs --help
npm run dev  # Test desktop IDE

# 6. Commit and push
git commit -m "feat: add awesome feature"
git push origin feat/my-feature

# 7. Open a Pull Request on GitHub
```

### Ways to Contribute

| Type | Description |
|------|-------------|
| **Bug Reports** | Found a bug? [Open an issue](https://github.com/concrete-sangminlee/orion/issues/new?template=bug_report.md) with steps to reproduce |
| **Security Issues** | Do not open a public issue; report privately as described in [SECURITY.md](SECURITY.md) |
| **Feature Requests** | Have an idea? [Open a feature request](https://github.com/concrete-sangminlee/orion/issues/new?template=feature_request.md) |
| **Code** | Pick an issue, write code, open a PR |
| **Documentation** | Improve README, add examples, write guides |
| **Themes** | Create new themes in `src/themes/index.ts` |
| **CLI Commands** | Add a module in `cli/commands/` and register it in `cli/index.ts` |
| **Testing** | Write tests, improve test coverage |

### Good First Issues

Look for issues labeled [`good first issue`](https://github.com/concrete-sangminlee/orion/labels/good%20first%20issue) — these are beginner-friendly tasks.

### Development Guidelines

- Follow existing code style (`.prettierrc` + `.editorconfig`)
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
- Keep PRs focused on a single change
- Add tests for new features where applicable
- Update README if your change affects user-facing behavior

### Architecture Overview

```
CLI Flow:     orion <cmd> → Commander → ai-client.ts → Provider API → markdown.ts → stdout
Desktop Flow: Electron main.ts ⇄ typed IPC (shared/ipc-contract.ts, preload) ⇄ React App.tsx → Monaco/Panels → Zustand stores
AI Flow:      User input → System prompt + context → Provider (stream) → Response rendering
```

---

## Roadmap

- [ ] MCP (Model Context Protocol) support
- [ ] Workspace checkpoints (multi-file undo)
- [ ] Sandboxed execution environment
- [ ] Web search grounding for AI
- [ ] Voice-to-code input
- [ ] Session sharing (shareable links)
- [ ] VS Code extension marketplace integration

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

<p align="center">
  <strong>✦ Built with Orion by the community</strong><br>
  <sub>Star the repo if you find it useful!</sub>
</p>
