# Changelog

All notable changes to Orion IDE will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Monaco no longer comes from a CDN.** `@monaco-editor/react` fetched Monaco 0.55.1 from `cdn.jsdelivr.net` at runtime (a different version than `package.json` pins), so remote script ran in the privileged renderer and the editor failed offline. The bundled `monaco-editor` and its language workers are now used; the smoke test fails if the renderer contacts any non-localhost host.
- **Content-Security-Policy** in production builds: `script-src 'self'` (no remote, inline, or eval'd script), `object-src`/`base-uri`/`form-action 'none'`. Defined in `shared/csp.ts`; the smoke test fails on any violation.
- **Renderer sandbox enabled.** The preload is now a CommonJS bundle (`preload.cjs`), so windows run with `sandbox: true`.
- **API keys are encrypted at rest and no longer live in the renderer.** They were stored in plaintext `localStorage` and resent to the main process on every start. The main process now keeps them encrypted with Electron `safeStorage` (OS keychain) in `<userData>/api-keys.json` (mode 0600, atomic writes), or only in memory when OS encryption is unavailable. The renderer can set or remove keys but only reads back which providers are configured. Existing plaintext keys are migrated once and then deleted.
- App windows can no longer navigate away from the app: `will-navigate`, `will-redirect`, and `window.open` previously handed **any** URL to `shell.openExternal`, bypassing the `shell:open-external` protocol allowlist (so `file:///…/x.exe` or `ms-cxh:` links reached OS handlers). Only `http`/`https`/`mailto`/`tel` now leave the app. The development-mode check also compared with `startsWith` (accepting `http://localhost:5173.attacker.example`); origins are now compared exactly.
- Every IPC handler now refuses messages whose sender frame is not showing the app (bundled `dist/` in production, the dev-server origin in development). The check lives in the typed `handle()`/`listen()` helpers, so it covers all channels.
- `git:pull` / `git:push` passed the renderer-supplied remote straight to git, so `remote: '--upload-pack=<cmd>'` with `branch: '.'` executed `<cmd>` locally (reproduced against a real git in `electron/ipc/git-option-injection.test.ts`). Remotes and refspecs are now validated (no leading `-`, no whitespace, no `ext::`/`fd::` transports) and placed after `--`. `--` alone is not sufficient for `pull`, which re-invokes `fetch` without it.
- `git:config-set` accepted any key, including ones that make git execute programs (`core.fsmonitor`, `core.sshCommand`, `alias.*`, `filter.*`, `credential.helper`, …). Writes are limited to an allowlist of identity/workflow keys.
- `git:checkout`, `git:create-branch`, tag, remote, `git:reset`, `git:stage`, `git:unstage`, `git:blame`, and `git:check-ignored` validate refs and pass pathspecs after `--`.
- Git IPC follow-ups now reject failed raw result envelopes even when the error string is empty, validate revert hashes through the shared commit-hash guard, and make `git clean` with `force: false` a safe no-op instead of invoking `git clean` without a mode flag.
- Git timeline follow-ups now preserve reset/cherry-pick/revert IPC contracts end-to-end, wire cherry-pick/revert sequencer options through the main-process handlers, respect `git clean` ignored/force options, and prevent redundant initial timeline reloads or stale row refs after filtering.
- Git timeline and shared git utility follow-ups now use cwd-first IPC argument order for show/revert/commit-amend/clean/cherry-pick calls, await post-action timeline refreshes, and stabilize timeline loading with request refs so stale fetch closures no longer race filter or mode changes.
- Git timeline follow-ups now pass the active workspace cwd into revert actions, refresh the timeline after successful cherry-picks/reverts, and make shared commit-amend/clean helpers unwrap their raw IPC result objects instead of returning handler envelopes to callers.
- Source control tag and cherry-pick follow-ups now keep annotated tags visible on their target commits, allow the shared git operations bridge to consume both raw IPC results and `{ data }` envelopes, and show a toast when timeline cherry-pick fails instead of leaving an unhandled promise rejection.
- Source control git action IPC now preserves the active workspace cwd for timeline cherry-picks, returns annotated tag metadata from `git:tags`, and surfaces git stderr text for merge/delete/cherry-pick failures so renderer toasts show actionable diagnostics. Added 3 regression tests in `electron/ipc/git-tag-format.test.ts`.
- Source control branch merge/delete, tag listing, and cherry-pick actions are now wired through the preload API they were already calling from the renderer. The new `git:merge` and `git:delete-branch` handlers reuse the active-workspace git cwd guard, and branch/hash inputs reject empty, control-character, and option-like payloads before invoking `git`. Added 7 regression tests in `electron/ipc/git-ref-guard.test.ts`.
- `git:merge-status` and `git:rebase-status` IPC handlers no longer construct filesystem paths from the raw output of `git rev-parse --git-dir`. That output can be an absolute path (e.g. for linked worktrees) that silently escapes the workspace boundary when passed to `path.resolve`. `git:merge-status` now uses `git rev-parse --verify MERGE_HEAD` directly; `git:rebase-status` validates the resolved git-dir path via a new `resolveGitInternalPath` helper before any file reads, falling back to a git-level check when the git dir is outside the workspace. Added 5 regression tests in `electron/ipc/git-cwd-guard.test.ts`.
- `git:*` IPC handlers now validate renderer-supplied working directories against the active workspace before invoking `git`. All git commands still use `execFile()` with argv arrays, but they can no longer be redirected to an arbitrary repository outside the opened project via a forged `cwd`; file and missing-directory cwd values are rejected before spawn. Added 7 regression tests in `electron/ipc/git-cwd-guard.test.ts`.
- Clipboard IPC now rejects oversized payloads before they cross the renderer/main-process boundary. Text writes are capped at 5 MiB, clipboard images are capped at 16 megapixels and 25 MiB after PNG encoding, and malformed clipboard payload shapes are rejected with explicit errors. Added 12 regression tests in `electron/ipc/clipboard-guard.test.ts`.
- Workspace opening now uses a dedicated `fs:open-workspace` IPC channel instead of overloading `fs:read-dir`. Only the new channel can validate and set the active workspace root; ordinary `fs:read-dir` calls are constrained to the current workspace and never mutate the root, removing the previous path-comparison heuristic that inferred caller intent.
- `terminal:create` now validates the renderer-supplied shell options shape before calling `pty.spawn()`. Custom shells remain supported, but `shellPath` must be a non-empty string without NUL/control characters and `shellArgs` must be an array of strings without NUL bytes, preventing malformed IPC payloads from escaping the documented terminal shell-selection contract. Added 13 regression tests in `electron/ipc/terminal-options-guard.test.ts`.
- `omo:start` no longer accepts an unused renderer-supplied project path. The OMO bridge never consumed that value, so the IPC contract now starts the assistant without letting a compromised renderer smuggle arbitrary path strings through an otherwise pathless initialization flow.
- `task:run`, `task:list-scripts`, and workspace settings IPC handlers now validate renderer-supplied cwd/root paths against the active workspace before spawning shells or reading/writing `.orion/settings.json`. `task:run` also rejects non-string or NUL-containing commands while preserving shell metacharacters, since running user-authored command lines through the configured shell is the task runner contract.
- Workspace path guard no longer re-stats the active workspace root on every `file:*` / `fs:*` IPC call. The directory-vs-file check now runs only through `resolveWorkspaceRootPath()` when opening or changing a workspace root, so hot operations such as file reads, watches, and existence checks avoid one extra disk hit per call while preserving the same root validation behavior.
- `fs:*` IPC handlers now reuse the active-workspace path guard introduced for `file:*`, and `fs:read-dir` validates that requested roots are existing absolute directories before building a tree. Reading a subdirectory inside the active workspace no longer narrows the active root, which prevents later operations on sibling folders from being accidentally rejected after breadcrumb or explorer browsing. Added 7 regression tests for workspace-root validation in `electron/ipc/workspace-path-guard.test.ts`.
- `file:*` IPC handlers (`rename`, `copy`, `move`, `stat`, `exists`, directory create/delete, watch, binary read) now require an active workspace root and validate every renderer-supplied path before touching the filesystem. The previous handlers passed arbitrary absolute paths directly into `fs`/`chokidar`, so a compromised renderer could read, write, move, watch, or delete outside the opened project via `..` traversal or sibling-prefix tricks. The new guard rejects relative, empty, non-string, and control-character paths, uses `path.relative()` containment instead of string-prefix checks, and resolves existing targets plus nearest existing parents to block symlink/junction escapes. Added 15 regression tests in `electron/ipc/workspace-path-guard.test.ts`.
- `shell.openPath()` IPC handler now validates the target path against an executable-extension blocklist (`.exe`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.msi`, `.sh`, `.app`, `.jar`, …). The handler previously forwarded any renderer-supplied string straight to the OS default-app launcher — a direct RCE primitive if a compromised IPC caller or prompt-injected AI tool output reached it. The new validator screens every dot-separated segment, so `invoice.pdf.exe` lookalikes are caught too. `showItemInFolder` gets a lighter check (NUL / control-char / non-string rejection) since revealing in the file manager does not execute the target. Added 14 regression tests in `shared/path-safety.test.ts`.
- `shell.openExternal()` IPC handler now refuses URLs outside an `http:` / `https:` / `mailto:` / `tel:` allowlist. Custom protocol schemes (`slack:`, `vscode:`, `ms-cxh:`, `steam:`, `zoommtg:`, …) resolve to OS-registered handlers that can launch arbitrary local applications — a classic Electron RCE primitive. `file:`, `javascript:`, and `data:` are also blocked, and URLs containing embedded whitespace or control characters are rejected before parsing. Added 11 regression tests in `shared/url-safety.test.ts`.
- `MarkdownPreview` rendering pipeline was hardened end-to-end. The pipeline now escapes raw HTML in the input *before* applying inline transforms (code blocks and Mermaid SVG are stashed behind placeholders and restored after escaping, so trusted output isn't mangled), and `escapeHtml()` now also escapes `"` and `'`. Image, link, autolink, and bare-URL handlers all route through a new `safeMarkdownUrl()` validator that enforces a protocol allowlist (`http:`/`https:`/`mailto:`/`tel:` for links, `http:`/`https:` plus a narrow `data:image/<png|gif|jpe?g|webp>;base64,…` whitelist for images), rejects URLs containing control chars, whitespace, quotes, backticks, brackets, or backslashes, and HTML-escapes the result before interpolation. Closes XSS paths via `[x](javascript:alert(1))`, `![x](data:text/html,…)`, and broken-attribute injection like `[x](https://e.com" onload="alert(1))`.
- Replaced `execSync(`git ${args}`)` with `execFileSync('git', [...args])` in the CLI's git runner. User-controlled CLI options (`--ref`, `--since`, `--author`, `--base`, blame paths) no longer flow through a shell, so values containing `;`, `|`, `&`, backticks, or `$()` can't inject commands. Added 7 regression tests covering the no-shell contract.
- Migrated every remaining `electron/ipc/git.ts` IPC handler from `exec("git " + args)` to `execFile("git", [...args])`. Renderer-supplied branch names, file paths, commit messages, stash indices, and log counts can no longer inject shell commands via the git IPC bridge. The unsafe `runGit()` helper has been deleted; new `runGitOrEmpty()` mirrors the old graceful-degradation semantics for handlers that need them.
- `orion run --fix` now refuses to write to paths that escape the project root. Previously the parsed `---FILE: <path> ---` blocks from AI output were written without validation, so a compromised provider or prompt-injected error stream piped into `orion run` could overwrite arbitrary files (e.g. `../../../etc/passwd`). The confirmation prompt now lists each target path so the user can spot anything unexpected. Added 10 regression tests.
- Fixed an XSS opening in `editorZones.ts` where the AI suggestion badge interpolated the model name into `innerHTML`; the label is now built with `textContent`.
- AI chat markdown link sanitization was hardened: `safeHref()` in `src/utils/aiChatMarkdown.ts` now rejects URLs containing control characters, whitespace, quotes, backticks, brackets, or backslashes in addition to enforcing the `http:`/`https:`/`mailto:`/`tel:` protocol allow-list. Closes injection paths like `[x](javascript:alert(1)" onload="alert(1))` that previously slipped past a protocol-only check.
- API response HTML previews in `ApiClientPanel` are now rendered inside a `sandbox=""` iframe with `referrerPolicy="no-referrer"`. A malicious or compromised API can no longer execute scripts or fetch external resources in the renderer context when its body is previewed.
- Notebook HTML cell outputs (`NotebookPanel`) are now rendered inside a `sandbox=""` iframe with `referrerPolicy="no-referrer"`. Shared `.ipynb` files containing embedded HTML output can no longer execute scripts against the IDE renderer's globals when opened.
- `customCSS` passed to `MarkdownPreview` is now sanitized before injection into both the live preview and the exported HTML. `@import` directives, `</style>` breakout attempts, `expression(...)` (legacy IE), and any `url(...)` that isn't a `data:` URI are stripped — closes CSS-based exfiltration via attribute-selector tricks and external resource fetches.

### Fixed
- **Saves could silently discard a version changed on disk.** With unsaved edits, an external change showed the conflict banner and auto-save then overwrote it anyway; Ctrl+S, Save All, and Save-and-close overwrote it without asking. Auto-save now skips files that changed or were deleted on disk, and explicit saves ask first.
- External changes made within 1.5 s after a save (formatters on save, a git checkout) were ignored because the watcher suppressed events by time; it now ignores only events whose file content matches what the app wrote.
- The workspace watcher's ignore pattern matched substrings of the absolute path, so files like `src/distance.ts`, `.github/`, `.gitignore`, or any workspace under a path containing `dist` were not watched. It now matches whole path segments below the workspace root.
- **CLI aliases and plugin commands never ran.** A root-level default action made commander reject every non-built-in word with "too many arguments", so `orion <alias>` failed right after `orion alias set` reported success. Unknown commands now reach the alias/plugin handler, which also suggests close matches for typos.
- **Undo could write one file's content into another.** All editor tabs shared a single Monaco model; after switching tabs, Ctrl+Z restored the previous file's text into the current one, and saving wrote it there. Each file now has its own model (closed files' models are disposed), which also stops the TypeScript worker's uncaught "Could not find source file: 'inmemory://model/1'" errors.
- **The desktop app never opened a usable window.** The ES-module main bundle used `__dirname` (and `require`), so `createWindow()` threw `ReferenceError: __dirname is not defined`; and the renderer imported `node:path`, which `vite-plugin-electron-renderer` rewrote into a `require()` that crashed it at load with nodeIntegration disabled. Both are fixed, the plugin is removed, and a test now fails if any module the app loads imports a Node built-in.
- The integrated terminal could not load in packaged builds: `node-pty` was a devDependency, which electron-builder does not ship. It is now an optional dependency.
- Help › Documentation / Report Issue and the electron-builder publish target pointed at repositories that do not exist.
- **Source Control reported success for failed operations.** Git mutations (commit, push, pull, fetch, checkout, stage, stash, …) swallowed errors and resolved `''`/`true`; they now reject with git's diagnostic, which the panel already shows as a toast.
- `git:status` trimmed porcelain output, so the first entry lost its leading space: ` M src/a.ts` was listed as *staged* with path `rc/a.ts`. Status now parses untrimmed `--porcelain=v1 -z` output (renames and paths with spaces handled).
- `git:checkout` of a name that is not a ref but matches a file silently discarded that file's local edits; it now fails with "invalid reference".
- `git:create-tag` tagged `HEAD` when the requested target hash was invalid.
- File › Open File (menu and command palette), OS file associations, and files passed on the command line never opened: nothing listened for `app:open-file`, and the palette called a nonexistent method. Files the user opens this way can be read and saved even outside the workspace (single-file grants).
- `fs:read-file` resolved `{ content: '' }` on failure while callers expected a rejection, so unreadable files opened as empty buffers that a save could write back. It now rejects.
- The chat Stop button sent a message the AI bridge treated as a new chat turn (with an empty prompt). It now cancels the in-flight request.
- The file store's copy, move, trash, create-from-template, and watch actions called a bridge the preload never exposed and only updated the tree. They now go through `window.api`; `file:unwatch` / `file:unwatch-all` stop watcher leaks.
- Workspace extension recommendations were never loaded (read from a field the handler does not return).
- Removed 8 preload methods (`appGetVersion`, `windowSetTitle`, `dialogShowMessageBox`, …) that had no main-process handler and always rejected.
- Main-process event pushes no longer throw "Object has been destroyed" after a window closes.
- Open Folder commands from the command palette, welcome tab, recent-folder list, and native app menu now all route through the shared workspace-open flow instead of only opening the OS picker or dispatching an unhandled event.
- Top-level `program.parseAsync(...)` now has a `.catch()` handler, so unhandled rejections from command handlers print a friendly error and exit 1 instead of dumping an unhandled-rejection warning.
- `FS_SEARCH` IPC handler: hoisted the regex out of the per-file loop (was rebuilding it for every file), dropped the unused `g` flag together with its fragile `lastIndex` reset, and now lets an invalid user regex reject the renderer promise instead of silently skipping every file.
- `orion search`: same regex hot-loop fix — dropped the `g` flag and removed the per-iteration `lastIndex` resets that were papering over its stateful semantics.

### Added
- `npm run test:e2e` launches the built desktop app (Playwright's Electron driver) and checks that a window opens, `window.api` works, React renders, IPC round-trips, navigation stays in the app, and API keys are stored without exposing them. A new CI job runs it under Xvfb.
- `shared/ipc-contract.ts`: single typed contract for every IPC channel. The main process registers handlers through typed `handle()`/`listen()`/`emit()`, the preload builds `window.api` from an electron-free factory, and the renderer's `window.api` type is derived from it, so channel/argument/payload drift is a compile error.
- IPC integrity tests: the preload exposes exactly the contract, the main process registers each channel exactly once, every event is emitted, and no module reachable from the app entry point uses `window.electron`, `window.electronAPI`, or `(window as any).api`.
- `npm run audit:reachability` reports renderer modules the app never imports (currently 142 of 219 files under `src/`).
- `npm run typecheck` now also type-checks `electron/` and `cli/` (previously only `src/` and `shared/`).
- Dependabot configuration for weekly npm and GitHub Actions updates, with minor/patch updates grouped into a single PR per ecosystem.
- `npm run typecheck` script (`tsc --noEmit`), wired into CI.
- CI workflows now declare `timeout-minutes`, least-privilege `permissions`, `concurrency` with cancel-in-progress, and npm caching in `actions/setup-node@v6`.
- `CHANGELOG.md` and `SECURITY.md` are now shipped in the published npm tarball via the `files` manifest.

### Changed
- **AI models.** The previously hard-coded Claude IDs (`claude-sonnet-4-20250514`, …) are retired; the CLI now defaults to `claude-opus-5-5` (`claude`, `claude-opus`, `claude-sonnet`, `claude-haiku`, new `claude-fable` shortcuts point at current models), and `temperature` is only sent to models that still accept it. `temperature: 0` / `maxTokens` in config are no longer replaced by defaults (`||` → `??`).
- **IDE model selector names now match the model they call.** "Claude Opus" called a Sonnet model and "GPT-5.3" called `gpt-4o`; Kimi and Gemini had no base URL and sent their keys to api.openai.com. Entries are now `Claude Opus 5.5`, `GPT-6.1 Sol`, `Kimi K3.1 Pro` (Moonshot endpoint), and `Gemini 3.6 Flash` (Gemini OpenAI-compatible endpoint).
- IDE AI conversation history only records completed exchanges, so a failed or cancelled request no longer leaves a dangling user turn (or a duplicate one after the streaming → non-streaming retry).
- AI chat markdown parsing was extracted from `AIChatWidget` into a shared `src/utils/aiChatMarkdown.ts` module. The widget no longer duplicates fenced-code-block detection: both call sites use `hasCodeBlock()` and the shared `CODE_BLOCK_REGEX`.

## [2.2.0] - 2026-05-18

### Added
- Debug console regression tests for safe expression evaluation.
- Packaging icon assets for Windows, macOS, Linux, and DMG builds.
- Repository-wide LF normalization policy via `.gitattributes`.

### Changed
- Upgraded Electron to 42.1.0 and electron-builder to 26.8.1.
- Migrated deprecated xterm packages to the maintained `@xterm/*` packages.
- Updated CI and release workflows to run audit, full tests, and production builds on Node.js 22.
- Lazy-loaded the main editor panel and adjusted Monaco chunking for cleaner production bundles.
- Cleaned npm publish artifacts down to the bundled CLI entry and required package metadata.

### Fixed
- Removed unsafe `eval()` usage from the debug console.
- Fixed electron-builder 26 Linux desktop configuration schema usage.
- Fixed Windows packaging failures caused by missing icon assets and local winCodeSign symlink constraints.
- Fixed CLI integration tests and generated workflow templates for the Node.js 22.12+ support baseline.
- Fixed backup filename collisions and path-dependent tests surfaced by GitHub Actions.

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
