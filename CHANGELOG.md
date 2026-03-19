# Changelog

All notable changes to Orion IDE will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-03-19

### Added

#### CLI - 50+ Commands
- **Core**: chat, ask, explain, review, fix (--auto), edit, commit
- **Code**: search, diff, pr (--review), run (--fix), test (--generate), agent, refactor, compare
- **Generate**: plan (--execute), generate (20+ frameworks), docs (--readme, --api), snippet, scaffold (11 templates), format (--style)
- **Tools**: shell (natural language→commands), todo (--fix, --prioritize), fetch, changelog, migrate (6 targets), deps (--security, --unused)
- **Analysis**: debug (--error, --stacktrace), benchmark (--memory, --complexity), security (--owasp), typecheck (--strict, --convert)
- **Safety**: undo (--checkpoint), status, doctor (9 checks), update, clean
- **Session**: session (new/resume/export), watch, config, init, gui, completions (bash/zsh/fish/powershell)
- **Git**: hooks (install/uninstall), alias (set/remove)
- **Config**: profile (create/use/export/import), metrics
- **Help**: tutorial (interactive 6-step), examples (per-command)
- **Chat tools**: /read, /write, /run, /ls, /cat, /cd, /pwd, /fetch, custom .orion/commands/

#### CLI Infrastructure
- Multi-provider AI client (Claude, GPT, Ollama) with hot-switching
- Terminal markdown rendering (marked + marked-terminal)
- Premium UI component library (box, table, badge, progress bar, diff block)
- Workspace checkpoints for multi-file atomic rollback
- Conversation compaction for long sessions (auto-summarize at 20+ messages)
- Automatic file backup before every edit/fix
- Unix pipe support (stdin detection, stdout for piping)
- Pipeline mode (--json, --yes, --dry-run, --quiet, --no-color)
- Shell completions generation (bash, zsh, fish, PowerShell)
- Lazy command loading for instant --help
- Non-blocking npm version check with 24h cache
- Cross-platform CRLF handling (18 fixes)
- Git commit via temp file (Windows shell escaping fix)
- Project memory (.orion/context.md, hierarchical loading)
- Custom slash commands (.orion/commands/*.md)
- Usage metrics tracking (commands, tokens, files)
- 161 unit tests (vitest) across 8 test files

#### Desktop IDE
- Premium design system (50+ CSS classes, 2,300+ lines)
- Light theme support (GitHub Light, Solarized Light, Gruvbox Light, Ayu Light)
- Professional About dialog with Orion constellation SVG
- Enhanced SplashScreen (60 particle star field, nebula background)
- Welcome page with keyboard shortcuts card and AI showcase
- Chat panel redesign (provider badges, timestamps, token counts)
- Window focus/blur desaturation effect
- Per-panel ErrorBoundary (side, editor, chat)
- i18n: 4 languages with 7 new sections (EN/KO/JA/ZH)
- TypeScript zero-error build (all type issues resolved)

### Changed
- Version bumped to 2.1.0
- Package scripts: tsc removed from package builds (vite-only)
- README completely rewritten as dual-mode (CLI + IDE) documentation

## [2.0.0] - 2026-03-16

### Added

#### Core Editor
- Monaco Editor integration with syntax highlighting, minimap, bracket colorization, and sticky scroll
- Multi-tab file editing with automatic language detection
- Breadcrumb navigation bar with dropdown symbol picker
- Split view editor with multiple layout orientations
- Inline diff viewer and full diff editor
- Hex editor for binary file inspection
- Image editor with basic editing capabilities
- Markdown live preview panel
- JSON tree viewer and CSV table viewer
- Editor minimap with custom highlight support
- Ghost text / inline suggestion provider
- Emmet abbreviation expansion support
- Code folding with custom fold regions
- Bracket pair colorization engine
- Indent detection and auto-configuration
- Editor zones for inline widgets
- Editor decorations API for extensions
- Snippet engine with tabstop, variable, and transform support

#### AI Integration
- Multi-model AI chat with streaming responses
- Supported providers: Claude (Anthropic), GPT-4o (OpenAI), Kimi (Moonshot), Gemini (Google), NVIDIA NIM, Ollama (local)
- NVIDIA NIM models: Llama 3.3, Nemotron, DeepSeek R1, Qwen 2.5
- Ctrl+K inline AI code editing with diff preview
- AI code completion with ghost text suggestions
- AI inline actions: explain, refactor, document, test generation
- AI code lens integration for contextual actions
- Agent/Chat dual mode toggle
- Multi-agent orchestration panel (Sisyphus, Hephaestus, Prometheus, Oracle)
- AI Composer panel for multi-file generation
- Customizable system prompts and user prompt templates
- AI context engine for intelligent code understanding
- Token counting and cost estimation per conversation
- AI conversation history and session management

#### File Management
- File Explorer with tree view, context menu (New File, New Folder, Rename, Delete)
- Global search with case-sensitive, whole-word, and regex support
- Quick Open file picker (Ctrl+P) with fuzzy matching
- File drag-and-drop support
- File watcher for external change detection
- Recent files tracking
- Recent projects list
- Virtual file system abstraction
- Workspace trust management

#### Git Integration
- Real branch info display with changed file count and sync status
- Source Control panel with staging, unstaging, and commit
- Git blame panel with per-line annotation
- Git stash management panel
- Git graph visualization
- Git timeline panel for file history
- Merge conflict resolver with 3-way merge view
- Git operations layer (fetch, pull, push, branch, checkout)

#### Terminal
- Integrated terminal powered by xterm.js + node-pty
- Multiple terminal sessions with tab management
- Terminal profile manager for custom shell configurations
- Terminal multiplexer support
- Terminal link detection and click handling

#### IDE Features
- Command Palette (Ctrl+Shift+P) with fuzzy search across all commands
- Working menu bar (File, Edit, View, Terminal, Help)
- Toast and notification system with notification center
- Settings modal with API key management and prompt customization
- Settings editor with search and category navigation
- Keybinding editor with conflict detection
- Customizable keyboard shortcuts
- Theme editor with live preview
- Extension system with host API
- Built-in extensions: TODO highlighter, bracket colorizer
- Code action providers (quick fixes, refactoring)
- IntelliSense / autocomplete provider system
- Peek definition widget
- References panel for find-all-references
- Symbol outline panel
- Code lens provider framework
- Snippet manager with import/export
- Search and replace dialog with regex support
- Bookmark management across files
- Editor tab context menu (close, close others, pin, split)

#### Development Tools
- Debug panel with breakpoint management
- Debug console panel
- Debug toolbar with step controls
- Debug adapter protocol support
- Testing panel with test explorer
- Code coverage panel with line-level visualization
- Profiler panel for performance analysis
- Problems panel with diagnostics aggregation
- Output panel with multiple output channels
- Ports panel for forwarded port management
- Database panel for connection management
- API client panel for HTTP request testing
- Docker panel for container management
- CI/CD panel for pipeline visualization
- Notebook panel for interactive computing

#### Collaboration and Remote
- Collaboration overlay for real-time co-editing
- Remote explorer panel for SSH/container connections
- Settings sync across devices

#### User Experience
- Splash screen with loading animation
- Welcome page with getting started guide
- Onboarding walkthrough for new users
- About dialog with version info
- Release notes viewer
- Analytics dashboard for usage insights
- Process explorer for resource monitoring
- New project wizard with templates
- Performance monitor widget
- Error boundary with graceful recovery
- Activity bar with customizable panel views
- Status bar with contextual widgets
- Resizable panels with drag handles
- Layout persistence across sessions
- Auto-save with recovery check
- Workspace indexer for fast file lookup

#### Internationalization
- i18n framework with locale support

#### Build and Packaging
- Electron Builder configuration for Windows (NSIS, portable), macOS (DMG, ZIP), Linux (AppImage, deb, snap)
- Protocol handler registration (orion://)
- File type associations for 20+ extensions
- Auto-update via GitHub Releases
- Icon generation tooling and documentation

### Technical Details
- Built with Electron 33, React 19, TypeScript 5.7
- Vite 6 with vite-plugin-electron for build tooling
- Zustand for state management across 20+ stores
- TailwindCSS v4 for styling
- Anthropic SDK and OpenAI SDK for AI provider integration
- xterm.js 5 with fit, search, and web-links addons
- Monaco Editor 0.52 with custom providers

[2.0.0]: https://github.com/orion-ide/orion-ide/releases/tag/v2.0.0
