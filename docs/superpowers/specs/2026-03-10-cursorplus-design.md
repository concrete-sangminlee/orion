# CursorPlus Design Spec

Agent-First AI IDE — Cursor clone powered by oh-my-openagent.

## Decisions

- **Architecture**: Electron + Monaco Editor (custom shell)
- **AI Integration**: User API keys + free model choice + OMO backend optimization
- **UI Direction**: Agent-First — multi-agent status as first-class citizen
- **MVP Strategy**: Full skeleton — all panels at once, then fill in
- **Deploy**: https://github.com/concrete-sangminlee/cursorplus

## Architecture

Three-layer system communicating via IPC + WebSocket:

### Electron Main Process
- **File System Manager**: File CRUD, watch (chokidar), project management
- **Terminal Manager**: node-pty based shell processes
- **OMO Bridge**: oh-my-openagent process lifecycle, message relay
- **Settings & API Key Store**: Encrypted API key storage, model config (electron-store)

### Renderer (React)
- **Monaco Editor**: Code editing, syntax highlighting, inline AI suggestions
- **Agent Panel**: Real-time agent status, progress, delegation chain
- **File Explorer**: Tree view, search, git status indicators
- **AI Chat**: Agent/Chat mode toggle, model selection, streaming responses
- **Terminal**: xterm.js, multi-tab, agent output tab
- **Activity Bar**: Panel switching icons

### oh-my-openagent Layer
- **Agent Orchestrator**: Sisyphus, Hephaestus, Prometheus, Oracle coordination
- **Model Router**: Auto-match tasks to optimal models
- **Hashline Editor**: Hash-anchored safe edits
- **LLM APIs**: Claude, GPT, Kimi, Gemini client

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 33+ |
| Frontend | React 19, TypeScript |
| Editor | Monaco Editor |
| Terminal | xterm.js + node-pty |
| State | Zustand |
| Styling | TailwindCSS |
| File Watch | chokidar |
| Settings | electron-store |
| Agent | oh-my-openagent |
| Build | Vite + electron-builder |

## UI Layout

```
┌──────┬──────────────┬──────────────────────────┬──────────────┐
│ Act  │ Agent Panel   │ Tab Bar                  │ AI Chat      │
│ Bar  │ ┌───────────┐ │ ┌──────┬──────┬────────┐ │ ┌──────────┐ │
│      │ │ Sisyphus  │ │ │App.tsx│main │Header  │ │ │ Agent/   │ │
│ 📁   │ │ ● active  │ │ └──────┴──────┴────────┘ │ │ Chat     │ │
│ 🔍   │ ├───────────┤ │                          │ │ toggle   │ │
│ 🔀   │ │Hephaestus │ │ Monaco Editor            │ ├──────────┤ │
│ 🤖   │ │ ● coding  │ │ (AI inline suggestions)  │ │ Messages │ │
│      │ ├───────────┤ │ (diff highlights)        │ │          │ │
│      │ │Prometheus │ │                          │ │          │ │
│      │ │ ◌ idle    │ │                          │ │          │ │
│      │ └───────────┘ ├──────────────────────────┤ ├──────────┤ │
│      │ File Explorer │ Terminal | Agent Log      │ │ Input    │ │
│ ⚙️   │ (collapsible) │ Problems | Output         │ │ [models] │ │
└──────┴──────────────┴──────────────────────────┴──────────────┘
```

- Activity Bar: left icon strip, panel switching
- Agent Panel: agent cards with status (active/working/idle), progress bars, delegation logs
- File Explorer: collapsible below Agent Panel, tree view with git status
- Editor: Monaco with AI-modified region highlights (green), inline suggestion UI (Accept/Reject)
- Tab Bar: AI badge on agent-modified files
- Bottom Panel: Terminal, Agent Log, Problems, Output tabs
- AI Chat: Agent/Chat mode, model selector, streaming responses, task progress

## Data Flow

```
User Input (Chat) → IPC → OMO Bridge → Sisyphus (orchestrator)
  → delegates to Hephaestus → LLM API → code generation
  → Hashline edit → File System → chokidar watch → Editor update
  (Agent Panel streams status throughout)
```

## Features

### Code Editing
- Monaco Editor with 30+ language support
- Multi-cursor, minimap, folding
- AI inline suggestions with Accept/Reject
- AI diff highlighting
- Tab autocomplete (AI-based)

### Multi-Agent (OMO)
- Real-time agent status display
- Per-agent progress tracking
- Parallel agent execution visualization
- Agent log streaming
- Delegation chain display
- Hashline safe editing

### AI Chat
- Agent mode (autonomous execution)
- Chat mode (Q&A)
- Code reference (@file, @symbol)
- Model selection (Claude, GPT, Kimi, Gemini)
- Chat history persistence
- Streaming responses

### File Management
- Tree view file explorer
- Quick open (Ctrl+P)
- Global search (Ctrl+Shift+F)
- Git status indicators
- File watch (external change detection)
- Drag and drop

### Terminal
- xterm.js full terminal
- Multi-tab terminals
- Agent-dedicated output tab
- Shell auto-detection (bash, zsh, pwsh)
- Terminal split

### Settings & Security
- Encrypted API key storage
- Per-model settings (temperature, etc.)
- Theme customization
- Keybinding configuration
- Agent-model mapping config
- Per-project settings

## Project Structure

```
cursorplus/
├── electron/           # Electron main process
│   ├── main.ts         # App entry point
│   ├── preload.ts      # Preload script (IPC bridge)
│   ├── ipc/            # IPC handlers
│   ├── terminal/       # node-pty terminal manager
│   ├── filesystem/     # File system operations
│   └── omo-bridge/     # OMO integration bridge
├── src/                # React renderer
│   ├── App.tsx         # Root component
│   ├── components/     # Shared UI components
│   ├── panels/         # Editor, Chat, Agent, Terminal panels
│   ├── store/          # Zustand stores
│   ├── hooks/          # Custom hooks
│   └── styles/         # TailwindCSS config
├── agents/             # OMO agent configuration
├── shared/             # Shared types, utilities, IPC contracts
├── package.json
├── vite.config.ts
├── electron-builder.yml
└── tsconfig.json
```
