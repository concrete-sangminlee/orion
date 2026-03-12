import React, { useState, useMemo, useCallback } from 'react';
import {
  BarChart3,
  PieChart,
  Bot,
  TrendingUp,
  FileText,
  Clock,
  Flame,
  Terminal,
  Puzzle,
  Download,
  Calendar,
  Code2,
  GitCommit,
  FilePlus,
  FileMinus,
  Zap,
  DollarSign,
  Activity,
  ChevronDown,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type TimePeriod = 'today' | 'week' | 'month' | 'all';

interface DailyCodeTime {
  day: string;
  hours: number;
}

interface LanguageStat {
  language: string;
  hours: number;
  color: string;
}

interface AIUsageStats {
  tokensUsed: number;
  cost: number;
  requestsPerDay: number;
  totalRequests: number;
}

interface ProductivityMetrics {
  linesAdded: number;
  linesRemoved: number;
  filesEdited: number;
  commits: number;
}

interface EditedFile {
  path: string;
  edits: number;
  language: string;
}

interface Session {
  id: string;
  start: string;
  end: string;
  durationMinutes: number;
}

interface CommandUsage {
  command: string;
  count: number;
}

interface ExtensionUsage {
  name: string;
  activations: number;
  timeMinutes: number;
}

// ── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_CODING_TIME: Record<TimePeriod, DailyCodeTime[]> = {
  today: [{ day: 'Today', hours: 4.5 }],
  week: [
    { day: 'Mon', hours: 6.2 },
    { day: 'Tue', hours: 5.8 },
    { day: 'Wed', hours: 7.1 },
    { day: 'Thu', hours: 4.3 },
    { day: 'Fri', hours: 8.0 },
    { day: 'Sat', hours: 2.5 },
    { day: 'Sun', hours: 3.9 },
  ],
  month: [
    { day: 'Wk1', hours: 32.4 },
    { day: 'Wk2', hours: 28.7 },
    { day: 'Wk3', hours: 35.1 },
    { day: 'Wk4', hours: 30.2 },
  ],
  all: [
    { day: 'Jan', hours: 124 },
    { day: 'Feb', hours: 108 },
    { day: 'Mar', hours: 135 },
    { day: 'Apr', hours: 98 },
    { day: 'May', hours: 142 },
    { day: 'Jun', hours: 119 },
  ],
};

const DEMO_LANGUAGES: LanguageStat[] = [
  { language: 'TypeScript', hours: 42.3, color: '#3178c6' },
  { language: 'Python', hours: 18.7, color: '#3572A5' },
  { language: 'Rust', hours: 12.1, color: '#dea584' },
  { language: 'Go', hours: 8.4, color: '#00ADD8' },
  { language: 'CSS', hours: 5.9, color: '#563d7c' },
  { language: 'JSON', hours: 3.2, color: '#a0a0a0' },
  { language: 'Markdown', hours: 2.8, color: '#455a64' },
];

const DEMO_AI_USAGE: Record<TimePeriod, AIUsageStats> = {
  today: { tokensUsed: 48230, cost: 1.42, requestsPerDay: 37, totalRequests: 37 },
  week: { tokensUsed: 312450, cost: 9.87, requestsPerDay: 42, totalRequests: 294 },
  month: { tokensUsed: 1_245_800, cost: 38.52, requestsPerDay: 39, totalRequests: 1170 },
  all: { tokensUsed: 8_432_100, cost: 261.8, requestsPerDay: 35, totalRequests: 6300 },
};

const DEMO_PRODUCTIVITY: Record<TimePeriod, ProductivityMetrics> = {
  today: { linesAdded: 342, linesRemoved: 87, filesEdited: 12, commits: 4 },
  week: { linesAdded: 2184, linesRemoved: 643, filesEdited: 47, commits: 23 },
  month: { linesAdded: 8920, linesRemoved: 2310, filesEdited: 134, commits: 89 },
  all: { linesAdded: 52340, linesRemoved: 14280, filesEdited: 612, commits: 487 },
};

const DEMO_EDITED_FILES: EditedFile[] = [
  { path: 'src/components/Editor.tsx', edits: 187, language: 'TypeScript' },
  { path: 'src/store/editorStore.ts', edits: 142, language: 'TypeScript' },
  { path: 'src/components/TabBar.tsx', edits: 128, language: 'TypeScript' },
  { path: 'src/utils/parser.ts', edits: 114, language: 'TypeScript' },
  { path: 'src/services/ai.ts', edits: 97, language: 'TypeScript' },
  { path: 'backend/api/routes.py', edits: 89, language: 'Python' },
  { path: 'src/components/FileExplorer.tsx', edits: 76, language: 'TypeScript' },
  { path: 'backend/models/session.py', edits: 68, language: 'Python' },
  { path: 'src/styles/theme.css', edits: 54, language: 'CSS' },
  { path: 'README.md', edits: 41, language: 'Markdown' },
];

const DEMO_SESSIONS: Session[] = [
  { id: 's1', start: '2026-03-12 08:15', end: '2026-03-12 12:45', durationMinutes: 270 },
  { id: 's2', start: '2026-03-11 09:00', end: '2026-03-11 17:30', durationMinutes: 510 },
  { id: 's3', start: '2026-03-10 14:20', end: '2026-03-10 18:10', durationMinutes: 230 },
  { id: 's4', start: '2026-03-09 10:00', end: '2026-03-09 16:45', durationMinutes: 405 },
  { id: 's5', start: '2026-03-08 08:30', end: '2026-03-08 13:00', durationMinutes: 270 },
  { id: 's6', start: '2026-03-07 11:00', end: '2026-03-07 19:20', durationMinutes: 500 },
  { id: 's7', start: '2026-03-06 09:45', end: '2026-03-06 15:30', durationMinutes: 345 },
];

const DEMO_COMMANDS: CommandUsage[] = [
  { command: 'editor.action.formatDocument', count: 842 },
  { command: 'workbench.action.quickOpen', count: 731 },
  { command: 'editor.action.triggerSuggest', count: 698 },
  { command: 'workbench.action.terminal.toggleTerminal', count: 524 },
  { command: 'editor.action.commentLine', count: 487 },
  { command: 'workbench.action.showCommands', count: 412 },
  { command: 'editor.action.rename', count: 356 },
  { command: 'workbench.action.files.save', count: 2941 },
];

const DEMO_EXTENSIONS: ExtensionUsage[] = [
  { name: 'Claude AI Assistant', activations: 1247, timeMinutes: 3420 },
  { name: 'ESLint', activations: 8940, timeMinutes: 2100 },
  { name: 'Prettier', activations: 6230, timeMinutes: 1540 },
  { name: 'GitLens', activations: 3180, timeMinutes: 980 },
  { name: 'Error Lens', activations: 5120, timeMinutes: 870 },
  { name: 'Auto Rename Tag', activations: 2410, timeMinutes: 620 },
  { name: 'Bracket Pair Colorizer', activations: 4870, timeMinutes: 540 },
];

const STREAK_DAYS = 12;
const LONGEST_STREAK = 34;

// ── Styles ───────────────────────────────────────────────────────────────────

const cssVars = {
  '--ad-bg': '#1e1e1e',
  '--ad-surface': '#252526',
  '--ad-surface2': '#2d2d2d',
  '--ad-border': '#3e3e42',
  '--ad-text': '#cccccc',
  '--ad-text-muted': '#858585',
  '--ad-accent': '#007acc',
  '--ad-accent-light': '#1a8fd4',
  '--ad-green': '#4ec9b0',
  '--ad-red': '#f14c4c',
  '--ad-orange': '#ce9178',
  '--ad-yellow': '#dcdcaa',
  '--ad-purple': '#c586c0',
} as React.CSSProperties;

const styles = {
  container: {
    ...cssVars,
    background: 'var(--ad-bg)',
    color: 'var(--ad-text)',
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    height: '100%',
    overflow: 'auto',
    padding: '20px 24px',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    flexWrap: 'wrap' as const,
    gap: 12,
  } as React.CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,
  periodSelector: {
    display: 'flex',
    gap: 4,
    background: 'var(--ad-surface)',
    borderRadius: 6,
    padding: 3,
    border: '1px solid var(--ad-border)',
  } as React.CSSProperties,
  periodBtn: (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 4,
    border: 'none',
    background: active ? 'var(--ad-accent)' : 'transparent',
    color: active ? '#fff' : 'var(--ad-text-muted)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    transition: 'all 0.15s ease',
  }),
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 16,
    marginBottom: 16,
  } as React.CSSProperties,
  card: {
    background: 'var(--ad-surface)',
    border: '1px solid var(--ad-border)',
    borderRadius: 8,
    padding: 16,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--ad-text)',
  } as React.CSSProperties,
  barContainer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
    height: 140,
    paddingTop: 8,
  } as React.CSSProperties,
  barWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    flex: 1,
    gap: 4,
  } as React.CSSProperties,
  bar: (heightPct: number): React.CSSProperties => ({
    width: '100%',
    maxWidth: 40,
    height: `${heightPct}%`,
    minHeight: 4,
    background: 'linear-gradient(180deg, var(--ad-accent-light), var(--ad-accent))',
    borderRadius: '4px 4px 0 0',
    transition: 'height 0.3s ease',
  }),
  barLabel: {
    fontSize: 10,
    color: 'var(--ad-text-muted)',
  } as React.CSSProperties,
  barValue: {
    fontSize: 10,
    color: 'var(--ad-text)',
    fontWeight: 500,
  } as React.CSSProperties,
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid var(--ad-border)',
  } as React.CSSProperties,
  statLabel: {
    fontSize: 12,
    color: 'var(--ad-text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
  statValue: {
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  pieContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  } as React.CSSProperties,
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    padding: '3px 0',
  } as React.CSSProperties,
  legendDot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid var(--ad-border)',
    fontSize: 12,
  } as React.CSSProperties,
  fileRank: {
    color: 'var(--ad-text-muted)',
    width: 18,
    textAlign: 'right' as const,
    fontSize: 11,
    flexShrink: 0,
  } as React.CSSProperties,
  filePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: 'var(--ad-accent-light)',
  } as React.CSSProperties,
  fileEdits: {
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--ad-text-muted)',
    fontSize: 11,
  } as React.CSSProperties,
  sessionRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 80px',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid var(--ad-border)',
    fontSize: 11,
    color: 'var(--ad-text-muted)',
  } as React.CSSProperties,
  streakContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
  } as React.CSSProperties,
  streakNumber: {
    fontSize: 48,
    fontWeight: 700,
    color: 'var(--ad-orange)',
    lineHeight: 1,
  } as React.CSSProperties,
  streakLabel: {
    fontSize: 12,
    color: 'var(--ad-text-muted)',
  } as React.CSSProperties,
  streakDots: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  } as React.CSSProperties,
  streakDot: (active: boolean): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: active ? 'var(--ad-orange)' : 'var(--ad-surface2)',
    border: `1px solid ${active ? 'var(--ad-orange)' : 'var(--ad-border)'}`,
  }),
  exportBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: 'var(--ad-surface)',
    border: '1px solid var(--ad-border)',
    borderRadius: 6,
    color: 'var(--ad-text)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    transition: 'background 0.15s ease',
  } as React.CSSProperties,
  progressBar: (pct: number, color: string): React.CSSProperties => ({
    height: 6,
    borderRadius: 3,
    background: color,
    width: `${pct}%`,
    transition: 'width 0.3s ease',
  }),
  progressTrack: {
    height: 6,
    borderRadius: 3,
    background: 'var(--ad-surface2)',
    flex: 1,
  } as React.CSSProperties,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function buildPieSlices(data: LanguageStat[]): string {
  const total = data.reduce((s, d) => s + d.hours, 0);
  let cumulative = 0;
  const gradientStops: string[] = [];
  data.forEach((d) => {
    const start = (cumulative / total) * 360;
    cumulative += d.hours;
    const end = (cumulative / total) * 360;
    gradientStops.push(`${d.color} ${start}deg ${end}deg`);
  });
  return `conic-gradient(${gradientStops.join(', ')})`;
}

// ── Component ────────────────────────────────────────────────────────────────

const AnalyticsDashboard: React.FC = () => {
  const [period, setPeriod] = useState<TimePeriod>('week');

  const codingTime = useMemo(() => DEMO_CODING_TIME[period], [period]);
  const aiUsage = useMemo(() => DEMO_AI_USAGE[period], [period]);
  const productivity = useMemo(() => DEMO_PRODUCTIVITY[period], [period]);
  const maxHours = useMemo(() => Math.max(...codingTime.map((d) => d.hours)), [codingTime]);
  const totalLangHours = useMemo(() => DEMO_LANGUAGES.reduce((s, l) => s + l.hours, 0), []);
  const pieGradient = useMemo(() => buildPieSlices(DEMO_LANGUAGES), []);

  const handleExport = useCallback(() => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      period,
      codingTime: DEMO_CODING_TIME[period],
      languages: DEMO_LANGUAGES,
      aiUsage: DEMO_AI_USAGE[period],
      productivity: DEMO_PRODUCTIVITY[period],
      mostEditedFiles: DEMO_EDITED_FILES,
      sessions: DEMO_SESSIONS,
      streak: { current: STREAK_DAYS, longest: LONGEST_STREAK },
      commands: DEMO_COMMANDS,
      extensions: DEMO_EXTENSIONS,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${period}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [period]);

  const periodLabels: Record<TimePeriod, string> = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    all: 'All Time',
  };

  const maxCommandCount = Math.max(...DEMO_COMMANDS.map((c) => c.count));
  const maxExtActivations = Math.max(...DEMO_EXTENSIONS.map((e) => e.activations));

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <Activity size={20} color="var(--ad-accent)" />
          Usage Analytics
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={styles.periodSelector}>
            {(Object.keys(periodLabels) as TimePeriod[]).map((p) => (
              <button
                key={p}
                style={styles.periodBtn(period === p)}
                onClick={() => setPeriod(p)}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
          <button style={styles.exportBtn} onClick={handleExport} title="Export data as JSON">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Row 1: Coding Time + Language Distribution */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <BarChart3 size={15} color="var(--ad-accent)" />
            Coding Time
          </div>
          <div style={styles.barContainer}>
            {codingTime.map((d) => (
              <div key={d.day} style={styles.barWrapper}>
                <span style={styles.barValue}>{d.hours.toFixed(1)}</span>
                <div style={styles.bar(maxHours > 0 ? (d.hours / maxHours) * 100 : 0)} />
                <span style={styles.barLabel}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <PieChart size={15} color="var(--ad-purple)" />
            Language Distribution
          </div>
          <div style={styles.pieContainer}>
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                background: pieGradient,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              {DEMO_LANGUAGES.map((lang) => (
                <div key={lang.language} style={styles.legendItem}>
                  <div style={styles.legendDot(lang.color)} />
                  <span style={{ flex: 1 }}>{lang.language}</span>
                  <span style={{ color: 'var(--ad-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {lang.hours}h ({((lang.hours / totalLangHours) * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: AI Usage + Productivity Metrics */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Bot size={15} color="var(--ad-green)" />
            AI Usage
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <Zap size={12} /> Tokens Used
            </span>
            <span style={styles.statValue}>{formatNumber(aiUsage.tokensUsed)}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <DollarSign size={12} /> Estimated Cost
            </span>
            <span style={{ ...styles.statValue, color: 'var(--ad-yellow)' }}>
              ${aiUsage.cost.toFixed(2)}
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <Activity size={12} /> Requests / Day
            </span>
            <span style={styles.statValue}>{aiUsage.requestsPerDay}</span>
          </div>
          <div style={{ ...styles.statRow, borderBottom: 'none' }}>
            <span style={styles.statLabel}>
              <Bot size={12} /> Total Requests
            </span>
            <span style={styles.statValue}>{formatNumber(aiUsage.totalRequests)}</span>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <TrendingUp size={15} color="var(--ad-orange)" />
            Productivity Metrics
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <FilePlus size={12} /> Lines Added
            </span>
            <span style={{ ...styles.statValue, color: 'var(--ad-green)' }}>
              +{formatNumber(productivity.linesAdded)}
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <FileMinus size={12} /> Lines Removed
            </span>
            <span style={{ ...styles.statValue, color: 'var(--ad-red)' }}>
              -{formatNumber(productivity.linesRemoved)}
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>
              <FileText size={12} /> Files Edited
            </span>
            <span style={styles.statValue}>{productivity.filesEdited}</span>
          </div>
          <div style={{ ...styles.statRow, borderBottom: 'none' }}>
            <span style={styles.statLabel}>
              <GitCommit size={12} /> Commits
            </span>
            <span style={styles.statValue}>{productivity.commits}</span>
          </div>
        </div>
      </div>

      {/* Row 3: Most Edited Files + Streak Tracker */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <FileText size={15} color="var(--ad-accent-light)" />
            Most Edited Files
          </div>
          {DEMO_EDITED_FILES.map((file, idx) => (
            <div key={file.path} style={styles.fileRow}>
              <span style={styles.fileRank}>#{idx + 1}</span>
              <Code2 size={12} color="var(--ad-text-muted)" />
              <span style={styles.filePath} title={file.path}>
                {file.path}
              </span>
              <span style={styles.fileEdits}>{file.edits} edits</span>
            </div>
          ))}
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Flame size={15} color="var(--ad-orange)" />
            Streak Tracker
          </div>
          <div style={styles.streakContainer}>
            <div style={styles.streakNumber}>{STREAK_DAYS}</div>
            <div style={styles.streakLabel}>consecutive coding days</div>
            <div style={styles.streakDots}>
              {Array.from({ length: 21 }, (_, i) => (
                <div key={i} style={styles.streakDot(i < STREAK_DAYS)} title={`Day ${i + 1}`} />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 24,
                marginTop: 8,
                fontSize: 12,
                color: 'var(--ad-text-muted)',
              }}
            >
              <span>
                Current: <strong style={{ color: 'var(--ad-orange)' }}>{STREAK_DAYS} days</strong>
              </span>
              <span>
                Longest: <strong style={{ color: 'var(--ad-text)' }}>{LONGEST_STREAK} days</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: Session History + Top Commands */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Clock size={15} color="var(--ad-yellow)" />
            Session History
          </div>
          <div style={{ ...styles.sessionRow, fontWeight: 600, color: 'var(--ad-text)', borderBottom: '1px solid var(--ad-border)' }}>
            <span>Start</span>
            <span>End</span>
            <span style={{ textAlign: 'right' }}>Duration</span>
          </div>
          {DEMO_SESSIONS.map((session) => (
            <div key={session.id} style={styles.sessionRow}>
              <span>{session.start}</span>
              <span>{session.end}</span>
              <span style={{ textAlign: 'right', color: 'var(--ad-green)' }}>
                {formatDuration(session.durationMinutes)}
              </span>
            </div>
          ))}
          <div
            style={{
              textAlign: 'center',
              paddingTop: 8,
              fontSize: 11,
              color: 'var(--ad-text-muted)',
            }}
          >
            Total: {formatDuration(DEMO_SESSIONS.reduce((s, sess) => s + sess.durationMinutes, 0))}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Terminal size={15} color="var(--ad-green)" />
            Top Commands
          </div>
          {DEMO_COMMANDS.map((cmd) => (
            <div key={cmd.command} style={{ padding: '5px 0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                    color: 'var(--ad-yellow)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {cmd.command}
                </span>
                <span
                  style={{
                    color: 'var(--ad-text-muted)',
                    marginLeft: 8,
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >
                  {cmd.count.toLocaleString()}x
                </span>
              </div>
              <div style={styles.progressTrack}>
                <div
                  style={styles.progressBar(
                    (cmd.count / maxCommandCount) * 100,
                    'var(--ad-accent)'
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 5: Extension Usage */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Puzzle size={15} color="var(--ad-purple)" />
            Extension Usage Rankings
          </div>
          {DEMO_EXTENSIONS.map((ext, idx) => (
            <div key={ext.name} style={{ padding: '6px 0', borderBottom: '1px solid var(--ad-border)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  marginBottom: 4,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--ad-text-muted)', fontSize: 11, width: 18, textAlign: 'right' }}>
                    #{idx + 1}
                  </span>
                  <span>{ext.name}</span>
                </span>
                <span style={{ color: 'var(--ad-text-muted)', fontSize: 11 }}>
                  {ext.activations.toLocaleString()} activations &middot; {formatDuration(ext.timeMinutes)}
                </span>
              </div>
              <div style={{ ...styles.progressTrack, marginLeft: 26 }}>
                <div
                  style={styles.progressBar(
                    (ext.activations / maxExtActivations) * 100,
                    'var(--ad-purple)'
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Privacy note card */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <Calendar size={15} color="var(--ad-text-muted)" />
            Data & Privacy
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--ad-text-muted)' }}>
            <p style={{ marginBottom: 12 }}>
              All analytics data is stored locally on your machine. No data is sent to external
              servers. Your coding habits remain private.
            </p>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Storage location</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace' }}>~/.cursor/analytics/</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Data retention</span>
              <span style={{ fontSize: 12 }}>365 days</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Last sync</span>
              <span style={{ fontSize: 12 }}>Just now</span>
            </div>
            <div style={{ ...styles.statRow, borderBottom: 'none' }}>
              <span style={styles.statLabel}>Data size</span>
              <span style={{ fontSize: 12 }}>2.4 MB</span>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                style={{
                  ...styles.exportBtn,
                  background: 'var(--ad-surface2)',
                  fontSize: 11,
                  padding: '6px 12px',
                }}
                onClick={handleExport}
              >
                <Download size={12} />
                Export All Data
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
