# Orion

**AI-Powered Code Editor by Bebut**

A professional Cursor IDE clone built with Electron, featuring multi-model AI integration, multi-agent orchestration, and a polished developer experience.

## Features

### Editor
- **Monaco Editor** with syntax highlighting, minimap, bracket colorization, sticky scroll
- **Breadcrumbs** navigation bar
- **Multi-tab** file editing with language detection
- **Ctrl+K** inline AI code editing
- **Ctrl+S** save with visual feedback

### AI Chat
- **Multi-model support**: Claude, GPT, Kimi, Gemini, NVIDIA NIM, Ollama (local)
- **NVIDIA NIM** models: Llama 3.3, Nemotron, DeepSeek R1, Qwen 2.5
- **Ollama** local LLM support (no API key needed)
- **Markdown rendering** with syntax-highlighted code blocks
- **Apply code** directly from chat to editor
- **Custom prompts**: Editable system prompt and user prompt template
- **Agent/Chat** dual mode toggle

### IDE Features
- **Command Palette** (Ctrl+Shift+P) with fuzzy search
- **File Explorer** with context menu (New File, New Folder, Rename, Delete)
- **Global Search** with case-sensitive and regex support
- **Git Integration** - real branch info, changed file count, sync status
- **Integrated Terminal** powered by xterm.js + node-pty
- **Multi-Agent Panel** with OMO orchestration (Sisyphus, Hephaestus, Prometheus, Oracle)
- **Working Menu Bar** (File, Edit, View, Terminal, Help)
- **Toast Notifications** for user feedback
- **Settings Modal** with API key management and prompt customization

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick Open (file search) |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+`` ` | Toggle Terminal |
| `Ctrl+J` | Toggle Bottom Panel |
| `Ctrl+L` | Focus Chat |
| `Ctrl+,` | Open Settings |
| `Ctrl+S` | Save File |
| `Ctrl+Shift+E` | Explorer |
| `Ctrl+Shift+F` | Search |
| `Ctrl+Shift+G` | Source Control |
| `Ctrl+K` | Inline AI Edit |

## Tech Stack

- **Electron 33** - Desktop framework
- **React 19** + **TypeScript** - UI
- **Monaco Editor** - Code editing
- **xterm.js** + **node-pty** - Integrated terminal
- **Zustand** - State management (6 stores)
- **TailwindCSS v4** - Styling
- **Vite 6** + **vite-plugin-electron** - Build tooling
- **Anthropic SDK** + **OpenAI SDK** - AI API clients
- **oh-my-openagent** - Multi-agent orchestration
- **lucide-react** - Icons

## AI Providers

| Provider | Models | API Key Required |
|---|---|---|
| Ollama | llama3.2 (local) | No |
| Anthropic | Claude Sonnet | Yes |
| OpenAI | GPT-4o | Yes |
| NVIDIA NIM | Llama 3.3, Nemotron, DeepSeek R1, Qwen 2.5 | Yes (free at build.nvidia.com) |
| Moonshot | Kimi | Yes |
| Google | Gemini | Yes |

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- (Optional) [Ollama](https://ollama.com) for local AI

### Install & Run

```bash
# Install dependencies
npm install

# Start development
npm run dev

# Build for production
npm run build
```

### Setup Ollama (Optional)

```bash
# Install Ollama
winget install Ollama.Ollama

# Pull a model
ollama pull llama3.2

# Ollama runs automatically on localhost:11434
```

## Project Structure

```
orion/
├── electron/           # Main process
│   ├── main.ts         # Electron entry point
│   ├── preload.ts      # Context bridge
│   ├── ipc/            # IPC handlers (filesystem, terminal, git, settings, omo)
│   ├── omo-bridge/     # AI client & agent orchestration
│   ├── filesystem/     # File operations & watcher
│   └── terminal/       # Terminal session manager
├── src/                # Renderer process
│   ├── components/     # UI components (TitleBar, ActivityBar, TabBar, etc.)
│   ├── panels/         # Main panels (Editor, Chat, FileExplorer, etc.)
│   ├── store/          # Zustand stores (editor, chat, files, agents, etc.)
│   ├── hooks/          # Custom hooks (useIpc, useOmo)
│   └── globals.css     # Theme & styles
├── shared/             # Shared types & constants
└── package.json
```

## License

MIT

---

*Built with Orion by Bebut*
