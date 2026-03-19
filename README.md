<p align="center">
  <strong>✦ O R I O N</strong><br>
  <em>AI-Powered Coding Assistant & IDE</em><br><br>
  <a href="#orion-cli">CLI</a> · <a href="#orion-ide">Desktop IDE</a> · <a href="#quick-start">Quick Start</a> · <a href="#commands">Commands</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-7C5CFC?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-38BDF8?style=flat-square" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20GPT%20%7C%20Ollama-9B59B6?style=flat-square" alt="ai">
</p>

---

## What is Orion?

Orion is a **dual-mode AI coding tool** — a powerful **CLI** for the terminal and a full-featured **desktop IDE** built on Electron.

- **Orion CLI** — AI coding assistant in your terminal. Chat, review, fix, edit code with Claude, GPT, or local Ollama models. Hot-switch between providers mid-conversation.
- **Orion IDE** — Professional desktop editor with Monaco, 18 themes, multi-agent orchestration, integrated terminal, and Git workflow.

---

## Quick Start

```bash
# Clone & install
git clone https://github.com/concrete-sangminlee/orion.git
cd orion
npm install

# Use the CLI
npm run cli:build
npm install -g .
orion chat

# Or launch the Desktop IDE
npm run dev
```

### Prerequisites

- **Node.js** 18+ (recommended: 22.x)
- **C++ Build Tools** (for `node-pty`):
  - Windows: `npm install -g windows-build-tools` 또는 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
- (Optional) [Ollama](https://ollama.com) for free local AI: `ollama pull llama3.2`

---

## Orion CLI

AI-powered coding assistant for the terminal. Cross-platform (Windows, macOS, Linux).

### Chat

```bash
orion chat                              # Interactive AI chat
```

Chat commands:
```
/claude          → Switch to Claude (API key required)
/gpt             → Switch to GPT (API key required)
/ollama          → Switch to Ollama (local, free)
/model <name>    → Change model (deepseek-r1, mistral, etc.)
/models          → List all available models
/switch          → Cycle to next provider
/save            → Save session
/history         → List saved sessions
/load <id>       → Resume a session
/stats           → Usage statistics
/clear           → Clear history
/exit            → Quit
```

### Code Commands

```bash
orion ask "question"                    # Quick one-shot question
orion explain file.ts                   # AI code explanation
orion review file.ts                    # AI code review with severity
orion fix file.ts                       # Auto-detect and fix bugs
orion edit file.ts                      # AI-assisted file editing
orion commit                            # AI-generated commit message
```

### Multi-Agent

```bash
orion agent "task1" "task2" "task3"      # Run tasks in parallel
orion agent "Review auth" "Add tests" --parallel 2
```

### Sessions

```bash
orion session new "project-name"        # Create named session
orion session list                      # List all sessions
orion session resume "project-name"     # Continue where you left off
orion session export "project-name"     # Export as markdown
orion session delete "project-name"     # Delete session
```

### Watch Mode

```bash
orion watch "*.ts" --on-change review   # Auto-review on file change
orion watch "src/**" --on-change fix    # Auto-fix on change
```

### Unix Pipes

```bash
cat error.log | orion ask "What's wrong?"
git diff | orion review
cat app.ts | orion explain
cat app.ts | orion fix > fixed.ts
```

### Pipeline Mode (CI/CD)

```bash
orion commit -y                         # Auto-confirm
orion fix file.ts -y --quiet            # Silent auto-fix
orion ask "question" --json             # Structured JSON output
```

### Configuration

```bash
orion config                            # Interactive API key setup
orion init                              # Create .orion/context.md project memory
```

### Supported AI Providers

| Provider | Models | Auth |
|----------|--------|------|
| **Ollama** (local) | llama3.2, deepseek-r1, mistral, qwen2.5-coder, + any | Free, no key |
| **Anthropic** | Claude Sonnet 4, Opus 4, Haiku | API key |
| **OpenAI** | GPT-4o, GPT-4o-mini, o3 | API key |

---

## Orion IDE

Professional desktop code editor built on Electron + React + Monaco Editor.

### Key Features

**Editor** — Monaco with syntax highlighting, minimap, bracket colorization, inline AI editing (Ctrl+K), ghost text completions, snippet engine, hex/image/markdown editors

**AI Integration** — 6 providers (Claude, GPT, Ollama, NVIDIA NIM, Kimi, Gemini), streaming chat, multi-agent orchestration, AI composer, customizable prompts

**Git** — Source control panel, blame, graph, stash, timeline, merge conflict resolver, conventional commits

**Terminal** — xterm.js + node-pty, multiple sessions, profiles, link detection

**Dev Tools** — Debug panel, test explorer, code coverage, profiler, problems panel, database/API/Docker/CI-CD panels

**Customization** — 18 built-in themes (dark + light), VS Code theme import, command palette, keybinding editor, extension system, 4 languages (EN/KO/JA/ZH)

### Launch

```bash
npm run dev                             # Development with hot reload
orion gui                               # From CLI
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+B` | Toggle Sidebar |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+L` | Focus AI Chat |
| `Ctrl+,` | Settings |
| `Ctrl+K` | Inline AI Edit |
| `Ctrl+Shift+E` | Explorer |
| `Ctrl+Shift+F` | Search |
| `Ctrl+Shift+G` | Source Control |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| CLI | Node.js + Commander + Chalk + Ora + Marked |
| Desktop | Electron 33 + React 19 + TypeScript 5.7 |
| Editor | Monaco Editor 0.52 |
| Terminal | xterm.js 5 + node-pty |
| State | Zustand 5 (33 stores) |
| Styling | TailwindCSS v4 + 2,300-line design system |
| Build | Vite 6 + esbuild |
| AI | Anthropic SDK + OpenAI SDK + Ollama API |
| Packaging | electron-builder 25 |

---

## Project Structure

```
orion/
├── cli/                    # CLI tool
│   ├── index.ts            # Entry point (Commander)
│   ├── ai-client.ts        # Multi-provider AI client
│   ├── ui.ts               # Premium UI components
│   ├── markdown.ts         # Terminal markdown renderer
│   ├── shared.ts           # Shared patterns
│   ├── pipeline.ts         # CI/CD pipeline mode
│   ├── stdin.ts            # Unix pipe support
│   └── commands/           # 12 commands
├── electron/               # Desktop main process
│   ├── main.ts             # Electron entry
│   ├── preload.ts          # IPC bridge
│   └── ipc/                # IPC handlers
├── src/                    # Desktop renderer (React)
│   ├── components/         # 60+ UI components
│   ├── panels/             # 30+ workspace panels
│   ├── store/              # 33 Zustand stores
│   ├── themes/             # 18 built-in themes
│   └── i18n/               # 4 languages
├── shared/                 # Shared types & constants
└── package.json
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Launch desktop IDE with hot reload |
| `npm run cli:build` | Build CLI tool |
| `npm run cli:dev` | Run CLI in dev mode |
| `npm run build` | Production build |
| `npm run package:win` | Package for Windows |
| `npm run package:mac` | Package for macOS |
| `npm run package:linux` | Package for Linux |
| `npm test` | Run tests |

---

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-feature`
3. Make changes and test: `npm test`
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
5. Open a Pull Request

---

## License

[MIT](LICENSE)
