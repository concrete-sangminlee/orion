import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Sparkles,
  Sun,
  Moon,
  Palette,
  Brain,
  Keyboard,
  Puzzle,
  Rocket,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Search,
  FolderOpen,
  FilePlus,
  GitBranch,
  Zap,
  Code,
  Terminal,
  Bug,
  FileJson,
  Braces,
  Eye,
  Settings,
  RotateCcw,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'orion-ide-onboarding-complete';
const TOTAL_STEPS = 6;

type ThemeId = 'dark' | 'light' | 'monokai' | 'solarized' | 'nord' | 'dracula';
type ShortcutPreset = 'default' | 'vscode' | 'vim' | 'emacs';
type AIProvider = 'anthropic' | 'openai' | 'local' | 'none';
type TransitionDir = 'forward' | 'backward';

interface ThemeOption {
  id: ThemeId;
  name: string;
  bg: string;
  sidebar: string;
  accent: string;
  text: string;
  secondaryBg: string;
}

interface ShortcutEntry {
  action: string;
  keys: string;
  category: string;
}

interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  recommended: boolean;
}

// ── Theme definitions ────────────────────────────────────────────────────────

const THEMES: ThemeOption[] = [
  { id: 'dark', name: 'Dark', bg: '#1e1e1e', sidebar: '#252526', accent: '#007acc', text: '#d4d4d4', secondaryBg: '#2d2d2d' },
  { id: 'light', name: 'Light', bg: '#ffffff', sidebar: '#f3f3f3', accent: '#0066b8', text: '#333333', secondaryBg: '#ececec' },
  { id: 'monokai', name: 'Monokai', bg: '#272822', sidebar: '#1e1f1c', accent: '#f92672', text: '#f8f8f2', secondaryBg: '#3e3d32' },
  { id: 'solarized', name: 'Solarized', bg: '#002b36', sidebar: '#073642', accent: '#b58900', text: '#839496', secondaryBg: '#073642' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', sidebar: '#3b4252', accent: '#88c0d0', text: '#d8dee9', secondaryBg: '#3b4252' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', sidebar: '#21222c', accent: '#bd93f9', text: '#f8f8f2', secondaryBg: '#44475a' },
];

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

const SHORTCUTS: ShortcutEntry[] = [
  { action: 'Command Palette', keys: 'Ctrl+Shift+P', category: 'General' },
  { action: 'Quick Open File', keys: 'Ctrl+P', category: 'General' },
  { action: 'Toggle Sidebar', keys: 'Ctrl+B', category: 'General' },
  { action: 'Toggle Terminal', keys: 'Ctrl+`', category: 'General' },
  { action: 'New File', keys: 'Ctrl+N', category: 'General' },
  { action: 'Save File', keys: 'Ctrl+S', category: 'Editing' },
  { action: 'Find in File', keys: 'Ctrl+F', category: 'Editing' },
  { action: 'Find and Replace', keys: 'Ctrl+H', category: 'Editing' },
  { action: 'Multi-cursor Select', keys: 'Ctrl+D', category: 'Editing' },
  { action: 'Move Line Up', keys: 'Alt+Up', category: 'Editing' },
  { action: 'Move Line Down', keys: 'Alt+Down', category: 'Editing' },
  { action: 'Duplicate Line', keys: 'Shift+Alt+Down', category: 'Editing' },
  { action: 'Toggle Comment', keys: 'Ctrl+/', category: 'Editing' },
  { action: 'Go to Definition', keys: 'F12', category: 'Navigation' },
  { action: 'Peek Definition', keys: 'Alt+F12', category: 'Navigation' },
  { action: 'Go to Line', keys: 'Ctrl+G', category: 'Navigation' },
  { action: 'Navigate Back', keys: 'Alt+Left', category: 'Navigation' },
  { action: 'Navigate Forward', keys: 'Alt+Right', category: 'Navigation' },
  { action: 'Start Debugging', keys: 'F5', category: 'Debug' },
  { action: 'Toggle Breakpoint', keys: 'F9', category: 'Debug' },
  { action: 'Step Over', keys: 'F10', category: 'Debug' },
  { action: 'Step Into', keys: 'F11', category: 'Debug' },
];

// ── Extensions ───────────────────────────────────────────────────────────────

const EXTENSIONS: ExtensionInfo[] = [
  { id: 'ai-assist', name: 'Orion AI Assistant', description: 'Inline AI code completion, chat, and refactoring tools.', icon: <Brain size={20} />, recommended: true },
  { id: 'git-lens', name: 'GitLens', description: 'Supercharge Git with blame annotations and history insights.', icon: <Eye size={20} />, recommended: true },
  { id: 'prettier', name: 'Prettier', description: 'Automatic code formatting for JS, TS, CSS, HTML and more.', icon: <Braces size={20} />, recommended: true },
  { id: 'eslint', name: 'ESLint', description: 'Find and fix problems in your JavaScript/TypeScript code.', icon: <Bug size={20} />, recommended: true },
  { id: 'docker', name: 'Docker', description: 'Build, manage, and deploy containerized applications.', icon: <Terminal size={20} />, recommended: false },
  { id: 'rest-client', name: 'REST Client', description: 'Send HTTP requests and view responses directly in the editor.', icon: <Zap size={20} />, recommended: false },
  { id: 'json-tools', name: 'JSON Tools', description: 'Validate, format, and transform JSON with ease.', icon: <FileJson size={20} />, recommended: false },
  { id: 'live-share', name: 'Live Share', description: 'Real-time collaborative editing and debugging.', icon: <Code size={20} />, recommended: false },
];

// ── AI models ────────────────────────────────────────────────────────────────

const AI_MODELS: Record<AIProvider, string[]> = {
  anthropic: ['Claude Opus 4', 'Claude Sonnet 4', 'Claude Haiku'],
  openai: ['GPT-4o', 'GPT-4o-mini', 'o1-preview'],
  local: ['CodeLlama 34B', 'DeepSeek Coder', 'StarCoder2'],
  none: [],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function markOnboardingComplete(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // ignore
  }
}

// ── Component ────────────────────────────────────────────────────────────────

const OnboardingWalkthrough: React.FC<{
  onClose?: () => void;
  forceShow?: boolean;
}> = ({ onClose, forceShow = false }) => {
  const [step, setStep] = useState(0);
  const [transitionDir, setTransitionDir] = useState<TransitionDir>('forward');
  const [isAnimating, setIsAnimating] = useState(false);
  const [visible, setVisible] = useState(true);

  // Step-specific state
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>('dark');
  const [aiProvider, setAiProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('Claude Opus 4');
  const [shortcutPreset, setShortcutPreset] = useState<ShortcutPreset>('default');
  const [shortcutSearch, setShortcutSearch] = useState('');
  const [installedExtensions, setInstalledExtensions] = useState<Set<string>>(
    new Set(EXTENSIONS.filter((e) => e.recommended).map((e) => e.id))
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve the active theme object
  const activeTheme = useMemo(() => THEMES.find((t) => t.id === selectedTheme) ?? THEMES[0], [selectedTheme]);

  // Don't render if already completed (unless forced)
  useEffect(() => {
    if (!forceShow && isOnboardingComplete()) {
      setVisible(false);
    }
  }, [forceShow]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSkip();
      } else if (e.key === 'ArrowRight' && step < TOTAL_STEPS - 1) {
        goNext();
      } else if (e.key === 'ArrowLeft' && step > 0) {
        goBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, isAnimating]);

  // ── Navigation ─────────────────────────────────────────────────────────

  const animateTransition = useCallback(
    (direction: TransitionDir, nextStep: number) => {
      if (isAnimating) return;
      setTransitionDir(direction);
      setIsAnimating(true);
      setTimeout(() => {
        setStep(nextStep);
        setIsAnimating(false);
      }, 280);
    },
    [isAnimating]
  );

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) animateTransition('forward', step + 1);
  }, [step, animateTransition]);

  const goBack = useCallback(() => {
    if (step > 0) animateTransition('backward', step - 1);
  }, [step, animateTransition]);

  const handleSkip = useCallback(() => {
    markOnboardingComplete();
    setVisible(false);
    onClose?.();
  }, [onClose]);

  const handleFinish = useCallback(() => {
    markOnboardingComplete();
    setVisible(false);
    onClose?.();
  }, [onClose]);

  // ── Extension toggle ───────────────────────────────────────────────────

  const toggleExtension = useCallback((id: string) => {
    setInstalledExtensions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Filtered shortcuts ─────────────────────────────────────────────────

  const filteredShortcuts = useMemo(() => {
    if (!shortcutSearch.trim()) return SHORTCUTS;
    const q = shortcutSearch.toLowerCase();
    return SHORTCUTS.filter(
      (s) =>
        s.action.toLowerCase().includes(q) ||
        s.keys.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [shortcutSearch]);

  // ── Render guard ───────────────────────────────────────────────────────

  if (!visible) return null;

  // ── Styles ─────────────────────────────────────────────────────────────

  const cssVars: Record<string, string> = {
    '--ob-bg': activeTheme.bg,
    '--ob-sidebar': activeTheme.sidebar,
    '--ob-accent': activeTheme.accent,
    '--ob-text': activeTheme.text,
    '--ob-secondary': activeTheme.secondaryBg,
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(6px)',
    ...cssVars as any,
  };

  const panelStyle: React.CSSProperties = {
    width: 720,
    maxWidth: '94vw',
    maxHeight: '88vh',
    backgroundColor: 'var(--ob-bg)',
    color: 'var(--ob-text)',
    borderRadius: 12,
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    transition: 'background-color 0.3s, color 0.3s',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '12px 16px 0',
  };

  const bodyStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 40px 24px',
    overflowY: 'auto',
    opacity: isAnimating ? 0 : 1,
    transform: isAnimating
      ? `translateX(${transitionDir === 'forward' ? '-30px' : '30px'})`
      : 'translateX(0)',
    transition: 'opacity 0.26s ease, transform 0.26s ease',
  };

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 40px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  };

  const btnBase: React.CSSProperties = {
    border: 'none',
    borderRadius: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s, opacity 0.15s',
  };

  const primaryBtn: React.CSSProperties = {
    ...btnBase,
    backgroundColor: 'var(--ob-accent)',
    color: '#fff',
  };

  const ghostBtn: React.CSSProperties = {
    ...btnBase,
    backgroundColor: 'transparent',
    color: 'var(--ob-text)',
    opacity: 0.7,
  };

  // ── Step renderers ─────────────────────────────────────────────────────

  const renderWelcome = () => (
    <div style={{ textAlign: 'center', paddingTop: 24 }}>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${activeTheme.accent}, #a855f7)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: `0 0 40px ${activeTheme.accent}44`,
        }}
      >
        <Sparkles size={36} color="#fff" />
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px' }}>
        Welcome to Orion IDE
      </h1>
      <p style={{ fontSize: 16, opacity: 0.65, margin: '0 0 28px', lineHeight: 1.6 }}>
        A lightning-fast, AI-powered code editor built for modern development.
        <br />
        Let's get you set up in under a minute.
      </p>
      <div
        style={{
          display: 'inline-flex',
          gap: 16,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {[
          { icon: <Palette size={18} />, label: 'Themes' },
          { icon: <Brain size={18} />, label: 'AI' },
          { icon: <Keyboard size={18} />, label: 'Shortcuts' },
          { icon: <Puzzle size={18} />, label: 'Extensions' },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              backgroundColor: 'var(--ob-secondary)',
              padding: '10px 18px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              opacity: 0.8,
            }}
          >
            {item.icon}
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );

  const renderThemePicker = () => (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
        <Palette size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Choose Your Theme
      </h2>
      <p style={{ opacity: 0.55, fontSize: 13, margin: '0 0 20px' }}>
        Pick a color scheme that suits your style. You can always change it later.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
        }}
      >
        {THEMES.map((theme) => {
          const isActive = theme.id === selectedTheme;
          return (
            <button
              key={theme.id}
              onClick={() => setSelectedTheme(theme.id)}
              style={{
                border: isActive ? `2px solid ${theme.accent}` : '2px solid transparent',
                borderRadius: 10,
                padding: 0,
                cursor: 'pointer',
                backgroundColor: theme.bg,
                overflow: 'hidden',
                outline: 'none',
                transition: 'border-color 0.2s, transform 0.15s',
                transform: isActive ? 'scale(1.03)' : 'scale(1)',
              }}
            >
              {/* Mini editor preview */}
              <div style={{ padding: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#27c93f' }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div
                    style={{
                      width: 40,
                      backgroundColor: theme.sidebar,
                      borderRadius: 3,
                      height: 48,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 6, backgroundColor: theme.accent, borderRadius: 2, width: '70%', marginBottom: 5 }} />
                    <div style={{ height: 6, backgroundColor: theme.secondaryBg, borderRadius: 2, width: '90%', marginBottom: 5 }} />
                    <div style={{ height: 6, backgroundColor: theme.secondaryBg, borderRadius: 2, width: '55%', marginBottom: 5 }} />
                    <div style={{ height: 6, backgroundColor: theme.accent, borderRadius: 2, width: '40%', opacity: 0.5 }} />
                  </div>
                </div>
              </div>
              <div
                style={{
                  backgroundColor: theme.sidebar,
                  padding: '6px 0',
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {isActive && <Check size={13} />}
                {theme.name}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderAIConfig = () => (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
        <Brain size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Configure AI Assistant
      </h2>
      <p style={{ opacity: 0.55, fontSize: 13, margin: '0 0 20px' }}>
        Connect an AI provider for code completion, chat, and refactoring.
      </p>

      {/* Provider selection */}
      <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, display: 'block', marginBottom: 6 }}>
        AI Provider
      </label>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {(
          [
            { id: 'anthropic', label: 'Anthropic' },
            { id: 'openai', label: 'OpenAI' },
            { id: 'local', label: 'Local / Ollama' },
            { id: 'none', label: 'None' },
          ] as { id: AIProvider; label: string }[]
        ).map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setAiProvider(p.id);
              const models = AI_MODELS[p.id];
              if (models.length > 0) setSelectedModel(models[0]);
              else setSelectedModel('');
            }}
            style={{
              ...btnBase,
              backgroundColor: aiProvider === p.id ? 'var(--ob-accent)' : 'var(--ob-secondary)',
              color: aiProvider === p.id ? '#fff' : 'var(--ob-text)',
              flex: 1,
              justifyContent: 'center',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {aiProvider !== 'none' && (
        <>
          {/* API key */}
          {aiProvider !== 'local' && (
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, display: 'block', marginBottom: 6 }}>
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.12)',
                  backgroundColor: 'var(--ob-secondary)',
                  color: 'var(--ob-text)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 11, opacity: 0.45, marginTop: 4, display: 'block' }}>
                Your key is stored locally and never sent to our servers.
              </span>
            </div>
          )}

          {/* Model selection */}
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, display: 'block', marginBottom: 6 }}>
            Default Model
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AI_MODELS[aiProvider].map((model) => (
              <button
                key={model}
                onClick={() => setSelectedModel(model)}
                style={{
                  ...btnBase,
                  backgroundColor: selectedModel === model ? 'var(--ob-accent)' : 'var(--ob-secondary)',
                  color: selectedModel === model ? '#fff' : 'var(--ob-text)',
                }}
              >
                {model}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const renderShortcuts = () => (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
        <Keyboard size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Keyboard Shortcuts
      </h2>
      <p style={{ opacity: 0.55, fontSize: 13, margin: '0 0 16px' }}>
        Orion supports popular keybinding presets. Choose one or keep the defaults.
      </p>

      {/* Preset buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {(
          [
            { id: 'default', label: 'Orion Default' },
            { id: 'vscode', label: 'VS Code' },
            { id: 'vim', label: 'Vim' },
            { id: 'emacs', label: 'Emacs' },
          ] as { id: ShortcutPreset; label: string }[]
        ).map((p) => (
          <button
            key={p.id}
            onClick={() => setShortcutPreset(p.id)}
            style={{
              ...btnBase,
              backgroundColor: shortcutPreset === p.id ? 'var(--ob-accent)' : 'var(--ob-secondary)',
              color: shortcutPreset === p.id ? '#fff' : 'var(--ob-text)',
              flex: 1,
              justifyContent: 'center',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: 'var(--ob-secondary)',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
        }}
      >
        <Search size={14} style={{ opacity: 0.5 }} />
        <input
          value={shortcutSearch}
          onChange={(e) => setShortcutSearch(e.target.value)}
          placeholder="Search shortcuts..."
          style={{
            flex: 1,
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--ob-text)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--ob-secondary)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, opacity: 0.6 }}>Action</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, opacity: 0.6 }}>Shortcut</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, opacity: 0.6 }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {filteredShortcuts.map((s) => (
              <tr key={s.action} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '7px 12px' }}>{s.action}</td>
                <td style={{ padding: '7px 12px' }}>
                  <code
                    style={{
                      backgroundColor: 'var(--ob-secondary)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  >
                    {s.keys}
                  </code>
                </td>
                <td style={{ padding: '7px 12px', opacity: 0.55 }}>{s.category}</td>
              </tr>
            ))}
            {filteredShortcuts.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 16, textAlign: 'center', opacity: 0.4 }}>
                  No shortcuts match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderExtensions = () => (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
        <Puzzle size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Install Extensions
      </h2>
      <p style={{ opacity: 0.55, fontSize: 13, margin: '0 0 16px' }}>
        Recommended extensions are pre-selected. Toggle any you don't need.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {EXTENSIONS.map((ext) => {
          const isInstalled = installedExtensions.has(ext.id);
          return (
            <button
              key={ext.id}
              onClick={() => toggleExtension(ext.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: 14,
                borderRadius: 8,
                border: isInstalled
                  ? `1px solid ${activeTheme.accent}55`
                  : '1px solid rgba(255,255,255,0.06)',
                backgroundColor: isInstalled ? `${activeTheme.accent}11` : 'var(--ob-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--ob-text)',
                transition: 'border-color 0.2s, background 0.2s',
                outline: 'none',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: isInstalled ? activeTheme.accent : 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: isInstalled ? '#fff' : 'var(--ob-text)',
                  transition: 'background 0.2s, color 0.2s',
                }}
              >
                {ext.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ext.name}
                  {ext.recommended && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 3,
                        backgroundColor: 'var(--ob-accent)',
                        color: '#fff',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      Rec
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.4 }}>
                  {ext.description}
                </div>
              </div>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: isInstalled ? 'none' : '2px solid rgba(255,255,255,0.15)',
                  backgroundColor: isInstalled ? activeTheme.accent : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 2,
                  transition: 'background 0.15s',
                }}
              >
                {isInstalled && <Check size={14} color="#fff" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderGetStarted = () => (
    <div style={{ textAlign: 'center', paddingTop: 12 }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${activeTheme.accent}, #22c55e)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}
      >
        <Rocket size={30} color="#fff" />
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px' }}>You're All Set!</h2>
      <p style={{ opacity: 0.55, fontSize: 13, margin: '0 0 28px' }}>
        Orion IDE is ready. What would you like to do first?
      </p>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { icon: <FolderOpen size={20} />, label: 'Open Folder', sub: 'Browse existing project' },
          { icon: <FilePlus size={20} />, label: 'New Project', sub: 'Start from a template' },
          { icon: <GitBranch size={20} />, label: 'Clone Repo', sub: 'Pull from Git remote' },
        ].map((action) => (
          <button
            key={action.label}
            onClick={handleFinish}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '20px 24px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'var(--ob-secondary)',
              cursor: 'pointer',
              color: 'var(--ob-text)',
              transition: 'border-color 0.2s, transform 0.15s',
              minWidth: 150,
              outline: 'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = activeTheme.accent;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                backgroundColor: `${activeTheme.accent}22`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: activeTheme.accent,
              }}
            >
              {action.icon}
            </div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{action.label}</span>
            <span style={{ fontSize: 11, opacity: 0.45 }}>{action.sub}</span>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, opacity: 0.35, marginTop: 24 }}>
        Tip: You can restart this walkthrough any time from{' '}
        <span style={{ opacity: 0.6 }}>
          <Settings size={11} style={{ verticalAlign: 'middle' }} /> Settings &gt; General &gt; Restart Onboarding
        </span>
      </p>
    </div>
  );

  // ── Step map ───────────────────────────────────────────────────────────

  const stepRenderers = [
    renderWelcome,
    renderThemePicker,
    renderAIConfig,
    renderShortcuts,
    renderExtensions,
    renderGetStarted,
  ];

  const stepLabels = ['Welcome', 'Theme', 'AI Setup', 'Shortcuts', 'Extensions', 'Get Started'];

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div style={overlayStyle} ref={containerRef}>
      <div style={panelStyle} role="dialog" aria-label="Onboarding Walkthrough">
        {/* Header with skip */}
        <div style={headerStyle}>
          <button onClick={handleSkip} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }} title="Skip onboarding (Esc)">
            <X size={14} /> Skip
          </button>
        </div>

        {/* Body – animated */}
        <div style={bodyStyle}>{stepRenderers[step]()}</div>

        {/* Footer */}
        <div style={footerStyle}>
          {/* Back button */}
          <div>
            {step > 0 && (
              <button onClick={goBack} style={ghostBtn}>
                <ChevronLeft size={16} /> Back
              </button>
            )}
          </div>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i !== step) animateTransition(i > step ? 'forward' : 'backward', i);
                }}
                title={stepLabels[i]}
                style={{
                  width: i === step ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: i === step ? 'var(--ob-accent)' : 'rgba(255,255,255,0.15)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'width 0.3s, background-color 0.3s',
                }}
              />
            ))}
          </div>

          {/* Next / Finish */}
          <div>
            {step < TOTAL_STEPS - 1 ? (
              <button onClick={goNext} style={primaryBtn}>
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={handleFinish} style={primaryBtn}>
                <Rocket size={15} /> Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Settings helper component ────────────────────────────────────────────────

export const RestartOnboardingButton: React.FC<{ onRestart?: () => void }> = ({ onRestart }) => {
  const handleClick = () => {
    resetOnboarding();
    onRestart?.();
  };

  return (
    <button
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.12)',
        backgroundColor: 'transparent',
        color: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      <RotateCcw size={13} />
      Restart Onboarding Walkthrough
    </button>
  );
};

export default OnboardingWalkthrough;
