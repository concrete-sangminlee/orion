<h1 align="center">
  <br>
  <img src="https://raw.githubusercontent.com/concrete-sangminlee/orion/main/public/icon.svg" width="120" alt="Orion">
  <br>
  Orion
  <br>
</h1>

<h3 align="center">AI-Powered Coding Assistant & IDE for the Terminal</h3>

<p align="center">
  <a href="#-quick-start"><strong>Quick Start</strong></a> ·
  <a href="#-cli-commands"><strong>CLI Commands</strong></a> ·
  <a href="#-desktop-ide"><strong>Desktop IDE</strong></a> ·
  <a href="#-contributing"><strong>Contributing</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/concrete-sangminlee/orion?style=flat-square&color=22C55E" alt="License">
  <img src="https://img.shields.io/badge/version-2.0.0-7C5CFC?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/commands-47-38BDF8?style=flat-square" alt="Commands">
  <img src="https://img.shields.io/badge/platform-Win%20%7C%20Mac%20%7C%20Linux-F59E0B?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20GPT%20%7C%20Ollama-9B59B6?style=flat-square" alt="AI">
  <img src="https://img.shields.io/github/stars/concrete-sangminlee/orion?style=flat-square" alt="Stars">
</p>

---

## What is Orion?

Orion is an **open-source AI coding tool** with two modes:

**CLI** — 47+ commands for AI-assisted coding directly in your terminal. Chat with AI, review code, fix bugs, generate tests, search codebases — all from the command line. Switch between Claude, GPT, and local Ollama models mid-conversation.

**Desktop IDE** — A full-featured code editor built on Electron with Monaco Editor, 18 themes, integrated terminal, Git workflow, and multi-agent AI orchestration.

```
                   ┌──────────────────────────────────┐
                   │  ✦ O R I O N                     │
                   │  AI-Powered Coding Assistant      │
                   │  v2.0.0 · Win/Mac/Linux           │
                   └──────────────────────────────────┘

  $ orion ask "How do I optimize this React component?" @src/App.tsx

  $ orion fix src/auth.ts --auto    # Fix → Test → Iterate until passing

  $ git diff | orion review         # AI code review from pipe

  $ orion chat                      # Interactive chat with /claude /gpt /ollama
```

---

## Why Orion?

| | Orion | Claude Code | Codex CLI | Aider |
|---|---|---|---|---|
| **Cross-platform** | Win/Mac/Linux | Mac/Linux/Win11 | Mac/Linux | Mac/Linux/Win |
| **Built-in AI** | Yes | Yes | Yes | Yes |
| **Local models** | Ollama (free) | No | No | Yes |
| **Provider switching** | Hot-switch mid-chat | No | No | Yes |
| **Auto fix loop** | fix → test → iterate | Manual | Manual | Yes |
| **File ops in chat** | /read /write /run /ls /cat | Yes | Yes | No |
| **Custom commands** | .orion/commands/*.md | .claude/commands/ | /commands/ | No |
| **Plan mode** | AI implementation plans | Yes | No | No |
| **Code generation** | 20+ frameworks | No | No | No |
| **File backup/undo** | Automatic | No | No | No |
| **Unix pipes** | Full support | Partial | No | No |
| **Web fetch** | /fetch URL in chat | Yes | Yes | No |
| **Natural language shell** | orion shell | No | No | No |
| **TODO scanner** | orion todo --fix | No | No | No |
| **Dependency analysis** | orion deps | No | No | No |
| **Migration** | JS→TS, py2→3, class→hooks | No | No | No |
| **Health check** | orion doctor | No | No | No |
| **Desktop IDE** | Included | No | No | No |
| **Price** | Free & open source | Subscription | Subscription | Free |

---

## Quick Start

```bash
git clone https://github.com/concrete-sangminlee/orion.git
cd orion
npm install
npm run cli:build
npm install -g .

# Start using
orion chat                    # AI chat
orion ask "What does this do?" @file.ts   # Quick question
orion status                  # Check setup
```

### Prerequisites

| Requirement | How to install |
|------------|----------------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **C++ Build Tools** | Windows: `npm i -g windows-build-tools` · macOS: `xcode-select --install` · Linux: `apt install build-essential` |
| **Ollama** (optional) | [ollama.com](https://ollama.com) — `ollama pull llama3.2` |

---

## CLI Commands

### 47+ commands organized in 10 categories:

```
Core:       chat · ask · explain · review · fix · edit · commit
Code:       search · diff · pr · run · test · agent · refactor · compare
Generate:   plan · generate · docs · snippet · scaffold · format
Tools:      shell · todo · fetch · changelog · migrate · deps
Analysis:   debug · benchmark · security · typecheck
Safety:     undo · status · doctor · update
Session:    session · watch · config · init · gui · completions
Git:        hooks · alias
Config:     profile · metrics
Help:       tutorial · examples
Chat:       /read · /write · /run · /ls · /cat · /cd · /fetch · custom commands
```

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
orion run "npm build" --fix         # Run, diagnose, and auto-fix
orion test                          # Run tests, AI analyzes failures
orion test --generate src/auth.ts   # Generate tests for a file
orion agent "task1" "task2" "task3" # Run multiple AI tasks in parallel
orion refactor src/app.ts --simplify  # AI refactoring
orion compare file1.ts file2.ts     # Compare two files with AI
```

### Generate — Code & Docs Generation

```bash
orion plan "Add auth to the app"    # AI implementation plan + auto-execute
orion plan --execute "task"         # Plan and execute immediately
orion generate component LoginForm  # Generate code (20+ frameworks)
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
orion undo --checkpoint             # Restore a workspace checkpoint
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

### Chat Provider Switching

```bash
orion chat
# Inside chat:
/claude              # Switch to Claude
/gpt                 # Switch to GPT
/ollama              # Switch to Ollama (local)
/model deepseek-r1   # Use specific model
/models              # List installed models
/switch              # Cycle providers
```

---

## Desktop IDE

Launch with `npm run dev` or `orion gui`.

### Features

- **Monaco Editor** — Syntax highlighting, minimap, bracket colorization, inline AI editing
- **18 Built-in Themes** — Orion Dark, GitHub Light, Tokyo Night, Catppuccin, Dracula, Nord, and more
- **AI Chat Panel** — Multi-provider streaming chat with markdown rendering
- **Integrated Terminal** — xterm.js + node-pty with multiple sessions
- **Git Integration** — Source control, blame, stash, timeline, merge conflict resolver
- **30+ Panels** — Debug, test, profiler, problems, database, API client, Docker, CI/CD
- **Command Palette** — Ctrl+Shift+P with fuzzy search
- **Extension System** — VS Code-compatible extension API
- **4 Languages** — English, Korean, Japanese, Chinese

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+K` | Inline AI Edit |
| `Ctrl+L` | Focus AI Chat |
| `Ctrl+B` | Toggle Sidebar |
| `` Ctrl+` `` | Toggle Terminal |

---

## AI Providers

| Provider | Models | Cost | Setup |
|----------|--------|------|-------|
| **Ollama** | llama3.2, deepseek-r1, mistral, qwen, + any | **Free** | `ollama pull llama3.2` |
| **Anthropic** | Claude Sonnet 4, Opus 4, Haiku | API key | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | GPT-4o, GPT-4o-mini, o3 | API key | [platform.openai.com](https://platform.openai.com) |

Ollama works out of the box with no API key. Run `orion config` for API key setup.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| CLI | Node.js · Commander · Chalk · Ora · Marked |
| Desktop | Electron 33 · React 19 · TypeScript 5.7 |
| Editor | Monaco Editor 0.52 |
| Terminal | xterm.js 5 · node-pty |
| State | Zustand 5 (33 stores) |
| Styling | TailwindCSS v4 |
| Build | Vite 6 · esbuild |
| AI | Anthropic SDK · OpenAI SDK · Ollama API |
| Packaging | electron-builder 25 |

---

## Project Structure

```
orion/
├── cli/                        # CLI tool (38 commands)
│   ├── index.ts                # Entry point
│   ├── ai-client.ts            # Multi-provider AI client
│   ├── ui.ts                   # Premium UI components
│   ├── markdown.ts             # Terminal markdown renderer
│   ├── backup.ts               # Automatic backup system
│   ├── shared.ts               # Shared patterns
│   ├── pipeline.ts             # CI/CD pipeline mode
│   ├── stdin.ts                # Unix pipe support
│   └── commands/               # 38 command implementations
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
│   ├── components/             # 60+ UI components
│   ├── panels/                 # 30+ workspace panels
│   ├── store/                  # 33 Zustand stores
│   └── themes/                 # 18 built-in themes
├── shared/                     # Shared types & constants
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
npm run cli:build && orion --help
npm run dev  # Test desktop IDE

# 6. Commit and push
git commit -m "feat: add awesome feature"
git push origin feat/my-feature

# 7. Open a Pull Request on GitHub
```

### Ways to Contribute

| Type | Description |
|------|-------------|
| **Bug Reports** | Found a bug? [Open an issue](https://github.com/concrete-sangminlee/orion/issues/new) with steps to reproduce |
| **Feature Requests** | Have an idea? [Start a discussion](https://github.com/concrete-sangminlee/orion/issues/new) |
| **Code** | Pick an issue, write code, open a PR |
| **Documentation** | Improve README, add examples, write guides |
| **Translations** | Add or improve translations in `src/i18n/locales/` |
| **Themes** | Create new themes in `src/themes/index.ts` |
| **CLI Commands** | Add new commands in `cli/commands/` |
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
Desktop Flow: Electron main.ts → IPC → React App.tsx → Monaco/Panels → Zustand stores
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
- [ ] Plugin system for custom CLI commands

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

<p align="center">
  <strong>✦ Built with Orion by the community</strong><br>
  <sub>Star the repo if you find it useful!</sub>
</p>
