import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  Loader,
  Clock,
  GitBranch,
  Play,
  Square,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Filter,
  BarChart3,
  Rocket,
  Terminal,
  Timer,
  TrendingUp,
  AlertCircle,
  Globe,
  Server,
  Pause,
  RotateCcw,
  Search,
  Settings,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

type RunStatus = 'success' | 'failure' | 'running' | 'cancelled' | 'queued';
type DeployEnv = 'production' | 'staging' | 'preview';

interface StepInfo {
  id: string;
  name: string;
  status: RunStatus;
  duration: number; // seconds
  log: string[];
}

interface JobInfo {
  id: string;
  name: string;
  status: RunStatus;
  duration: number;
  steps: StepInfo[];
}

interface WorkflowRun {
  id: string;
  name: string;
  branch: string;
  commit: string;
  commitMsg: string;
  status: RunStatus;
  duration: number;
  startedAt: Date;
  actor: string;
  jobs: JobInfo[];
}

interface Deployment {
  id: string;
  environment: DeployEnv;
  branch: string;
  commit: string;
  status: RunStatus;
  deployedAt: Date;
  url: string;
  actor: string;
}

// ── Demo Data ───────────────────────────────────────────────────────────────

const DEMO_RUNS: WorkflowRun[] = [
  {
    id: 'run-1',
    name: 'CI Pipeline',
    branch: 'main',
    commit: 'a3f8c21',
    commitMsg: 'feat: add user authentication module',
    status: 'success',
    duration: 214,
    startedAt: new Date(Date.now() - 12 * 60 * 1000),
    actor: 'developer-a',
    jobs: [
      {
        id: 'job-1a', name: 'Lint & Format', status: 'success', duration: 34,
        steps: [
          { id: 's1', name: 'Checkout', status: 'success', duration: 3, log: ['Cloning repository...', 'Checked out a3f8c21'] },
          { id: 's2', name: 'Install deps', status: 'success', duration: 18, log: ['npm ci', 'added 1432 packages in 17s'] },
          { id: 's3', name: 'ESLint', status: 'success', duration: 8, log: ['Running eslint...', '0 errors, 0 warnings'] },
          { id: 's4', name: 'Prettier', status: 'success', duration: 5, log: ['Checking formatting...', 'All files formatted correctly'] },
        ],
      },
      {
        id: 'job-1b', name: 'Unit Tests', status: 'success', duration: 87,
        steps: [
          { id: 's5', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out a3f8c21'] },
          { id: 's6', name: 'Install deps', status: 'success', duration: 19, log: ['npm ci', 'added 1432 packages'] },
          { id: 's7', name: 'Run tests', status: 'success', duration: 62, log: ['jest --coverage', 'Tests: 248 passed, 248 total', 'Coverage: 91.3%'] },
          { id: 's8', name: 'Upload coverage', status: 'success', duration: 4, log: ['Uploading to Codecov...', 'Report uploaded successfully'] },
        ],
      },
      {
        id: 'job-1c', name: 'Build', status: 'success', duration: 93,
        steps: [
          { id: 's9', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out a3f8c21'] },
          { id: 's10', name: 'Install deps', status: 'success', duration: 20, log: ['npm ci'] },
          { id: 's11', name: 'Build', status: 'success', duration: 65, log: ['vite build', 'dist/index.js  245.3 kB', 'Build completed successfully'] },
          { id: 's12', name: 'Upload artifact', status: 'success', duration: 6, log: ['Uploading build artifact...', 'Artifact uploaded: build-a3f8c21'] },
        ],
      },
    ],
  },
  {
    id: 'run-2',
    name: 'CI Pipeline',
    branch: 'feature/dashboard',
    commit: 'b7e2d44',
    commitMsg: 'fix: resolve chart rendering issue on resize',
    status: 'failure',
    duration: 156,
    startedAt: new Date(Date.now() - 45 * 60 * 1000),
    actor: 'developer-b',
    jobs: [
      {
        id: 'job-2a', name: 'Lint & Format', status: 'success', duration: 31,
        steps: [
          { id: 's13', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out b7e2d44'] },
          { id: 's14', name: 'Install deps', status: 'success', duration: 17, log: ['npm ci'] },
          { id: 's15', name: 'ESLint', status: 'success', duration: 7, log: ['0 errors, 2 warnings'] },
          { id: 's16', name: 'Prettier', status: 'success', duration: 5, log: ['All files formatted'] },
        ],
      },
      {
        id: 'job-2b', name: 'Unit Tests', status: 'failure', duration: 95,
        steps: [
          { id: 's17', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out b7e2d44'] },
          { id: 's18', name: 'Install deps', status: 'success', duration: 18, log: ['npm ci'] },
          { id: 's19', name: 'Run tests', status: 'failure', duration: 75, log: [
            'jest --coverage',
            'FAIL src/components/Chart.test.tsx',
            '  ChartComponent > should handle resize',
            '    expect(received).toBe(expected)',
            '    Expected: 800',
            '    Received: undefined',
            'Tests: 1 failed, 247 passed, 248 total',
          ]},
        ],
      },
      {
        id: 'job-2c', name: 'Build', status: 'cancelled', duration: 0,
        steps: [],
      },
    ],
  },
  {
    id: 'run-3',
    name: 'Deploy Production',
    branch: 'main',
    commit: 'c9d1f88',
    commitMsg: 'chore: bump version to 2.4.0',
    status: 'running',
    duration: 78,
    startedAt: new Date(Date.now() - 2 * 60 * 1000),
    actor: 'developer-a',
    jobs: [
      {
        id: 'job-3a', name: 'Build & Test', status: 'success', duration: 60,
        steps: [
          { id: 's20', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out c9d1f88'] },
          { id: 's21', name: 'Build', status: 'success', duration: 48, log: ['vite build', 'Build completed'] },
          { id: 's22', name: 'Smoke tests', status: 'success', duration: 10, log: ['All smoke tests passed'] },
        ],
      },
      {
        id: 'job-3b', name: 'Deploy to Staging', status: 'running', duration: 18,
        steps: [
          { id: 's23', name: 'Configure AWS', status: 'success', duration: 5, log: ['AWS credentials configured'] },
          { id: 's24', name: 'Push to S3', status: 'running', duration: 13, log: ['Syncing files to s3://staging-bucket...', 'Uploading 142 files...'] },
          { id: 's25', name: 'Invalidate CDN', status: 'queued', duration: 0, log: [] },
        ],
      },
      {
        id: 'job-3c', name: 'Deploy to Production', status: 'queued', duration: 0,
        steps: [
          { id: 's26', name: 'Approval gate', status: 'queued', duration: 0, log: [] },
          { id: 's27', name: 'Deploy', status: 'queued', duration: 0, log: [] },
        ],
      },
    ],
  },
  {
    id: 'run-4',
    name: 'Nightly E2E',
    branch: 'main',
    commit: 'a3f8c21',
    commitMsg: 'scheduled: nightly end-to-end test suite',
    status: 'success',
    duration: 612,
    startedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    actor: 'github-actions',
    jobs: [
      {
        id: 'job-4a', name: 'E2E Chrome', status: 'success', duration: 310,
        steps: [
          { id: 's28', name: 'Checkout', status: 'success', duration: 3, log: ['Checked out a3f8c21'] },
          { id: 's29', name: 'Playwright install', status: 'success', duration: 45, log: ['Installing browsers...', 'Chromium installed'] },
          { id: 's30', name: 'Run E2E', status: 'success', duration: 258, log: ['Running 86 tests...', '86 passed'] },
          { id: 's31', name: 'Upload report', status: 'success', duration: 4, log: ['Report uploaded'] },
        ],
      },
      {
        id: 'job-4b', name: 'E2E Firefox', status: 'success', duration: 302,
        steps: [
          { id: 's32', name: 'Checkout', status: 'success', duration: 3, log: ['Checked out a3f8c21'] },
          { id: 's33', name: 'Playwright install', status: 'success', duration: 50, log: ['Firefox installed'] },
          { id: 's34', name: 'Run E2E', status: 'success', duration: 245, log: ['86 tests passed'] },
          { id: 's35', name: 'Upload report', status: 'success', duration: 4, log: ['Report uploaded'] },
        ],
      },
    ],
  },
  {
    id: 'run-5',
    name: 'CI Pipeline',
    branch: 'fix/memory-leak',
    commit: 'e4a9b03',
    commitMsg: 'fix: dispose subscriptions on unmount',
    status: 'success',
    duration: 198,
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    actor: 'developer-c',
    jobs: [
      {
        id: 'job-5a', name: 'Lint & Format', status: 'success', duration: 29,
        steps: [
          { id: 's36', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out e4a9b03'] },
          { id: 's37', name: 'Lint', status: 'success', duration: 27, log: ['0 errors, 0 warnings'] },
        ],
      },
      {
        id: 'job-5b', name: 'Unit Tests', status: 'success', duration: 82,
        steps: [
          { id: 's38', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out e4a9b03'] },
          { id: 's39', name: 'Tests', status: 'success', duration: 80, log: ['248 passed, 0 failed', 'Coverage: 92.1%'] },
        ],
      },
      {
        id: 'job-5c', name: 'Build', status: 'success', duration: 87,
        steps: [
          { id: 's40', name: 'Checkout', status: 'success', duration: 2, log: ['Checked out e4a9b03'] },
          { id: 's41', name: 'Build', status: 'success', duration: 85, log: ['Build completed', 'Bundle size: 241.8 kB'] },
        ],
      },
    ],
  },
  {
    id: 'run-6',
    name: 'CI Pipeline',
    branch: 'feature/dark-mode',
    commit: 'f1c7e55',
    commitMsg: 'feat: implement dark mode toggle and theme persistence',
    status: 'queued',
    duration: 0,
    startedAt: new Date(Date.now() - 30 * 1000),
    actor: 'developer-d',
    jobs: [
      { id: 'job-6a', name: 'Lint & Format', status: 'queued', duration: 0, steps: [] },
      { id: 'job-6b', name: 'Unit Tests', status: 'queued', duration: 0, steps: [] },
      { id: 'job-6c', name: 'Build', status: 'queued', duration: 0, steps: [] },
    ],
  },
];

const DEMO_DEPLOYMENTS: Deployment[] = [
  {
    id: 'dep-1', environment: 'production', branch: 'main', commit: 'a3f8c21',
    status: 'success', deployedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    url: 'https://app.example.com', actor: 'developer-a',
  },
  {
    id: 'dep-2', environment: 'staging', branch: 'main', commit: 'c9d1f88',
    status: 'running', deployedAt: new Date(Date.now() - 3 * 60 * 1000),
    url: 'https://staging.example.com', actor: 'developer-a',
  },
  {
    id: 'dep-3', environment: 'preview', branch: 'feature/dashboard', commit: 'b7e2d44',
    status: 'success', deployedAt: new Date(Date.now() - 50 * 60 * 1000),
    url: 'https://preview-dashboard.example.com', actor: 'developer-b',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds === 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'success': return 'var(--cicd-success, #3fb950)';
    case 'failure': return 'var(--cicd-failure, #f85149)';
    case 'running': return 'var(--cicd-running, #58a6ff)';
    case 'cancelled': return 'var(--cicd-cancelled, #8b949e)';
    case 'queued': return 'var(--cicd-queued, #d29922)';
  }
}

function branchColor(branch: string): string {
  const colors = [
    'var(--cicd-branch-1, #58a6ff)',
    'var(--cicd-branch-2, #bc8cff)',
    'var(--cicd-branch-3, #f778ba)',
    'var(--cicd-branch-4, #ffa657)',
    'var(--cicd-branch-5, #79c0ff)',
  ];
  let hash = 0;
  for (const ch of branch) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// ── Status Icon ─────────────────────────────────────────────────────────────

const StatusIcon: React.FC<{ status: RunStatus; size?: number }> = ({ status, size = 16 }) => {
  const color = statusColor(status);
  switch (status) {
    case 'success': return <CheckCircle size={size} color={color} />;
    case 'failure': return <XCircle size={size} color={color} />;
    case 'running': return <Loader size={size} color={color} style={{ animation: 'cicd-spin 1s linear infinite' }} />;
    case 'cancelled': return <AlertCircle size={size} color={color} />;
    case 'queued': return <Clock size={size} color={color} />;
  }
};

// ── Duration Bar ────────────────────────────────────────────────────────────

const DurationBar: React.FC<{ duration: number; maxDuration: number; status: RunStatus }> = ({ duration, maxDuration, status }) => {
  const pct = maxDuration > 0 ? Math.min((duration / maxDuration) * 100, 100) : 0;
  return (
    <div style={{ width: 80, height: 6, background: 'var(--cicd-bar-bg, #21262d)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: statusColor(status),
        borderRadius: 3,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
};

// ── Branch Badge ────────────────────────────────────────────────────────────

const BranchBadge: React.FC<{ branch: string }> = ({ branch }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: 'var(--cicd-mono, monospace)',
    background: branchColor(branch) + '22',
    color: branchColor(branch),
    border: `1px solid ${branchColor(branch)}44`,
    whiteSpace: 'nowrap',
  }}>
    <GitBranch size={11} />
    {branch}
  </span>
);

// ── Step Row ────────────────────────────────────────────────────────────────

const StepRow: React.FC<{ step: StepInfo }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: 24 }}>
      <div
        onClick={() => step.log.length > 0 && setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '3px 8px',
          cursor: step.log.length > 0 ? 'pointer' : 'default',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--cicd-text, #c9d1d9)',
        }}
      >
        {step.log.length > 0
          ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
          : <span style={{ width: 12 }} />
        }
        <StatusIcon status={step.status} size={13} />
        <span style={{ flex: 1 }}>{step.name}</span>
        <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)' }}>{formatDuration(step.duration)}</span>
      </div>
      {open && step.log.length > 0 && (
        <div style={{
          marginLeft: 34,
          marginTop: 2,
          marginBottom: 4,
          padding: '6px 10px',
          background: 'var(--cicd-log-bg, #0d1117)',
          borderRadius: 4,
          fontFamily: 'var(--cicd-mono, monospace)',
          fontSize: 11,
          lineHeight: 1.6,
          color: 'var(--cicd-log-text, #8b949e)',
          borderLeft: `2px solid ${statusColor(step.status)}44`,
          maxHeight: 160,
          overflowY: 'auto',
        }}>
          {step.log.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--cicd-muted, #484f58)', userSelect: 'none', minWidth: 20, textAlign: 'right' }}>{i + 1}</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Job Row ─────────────────────────────────────────────────────────────────

const JobRow: React.FC<{ job: JobInfo }> = ({ job }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: 16 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          cursor: 'pointer',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--cicd-text, #c9d1d9)',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <StatusIcon status={job.status} size={14} />
        <span style={{ flex: 1, fontWeight: 500 }}>{job.name}</span>
        <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)' }}>{formatDuration(job.duration)}</span>
      </div>
      {open && job.steps.map(step => <StepRow key={step.id} step={step} />)}
    </div>
  );
};

// ── Workflow Run Card ───────────────────────────────────────────────────────

const RunCard: React.FC<{
  run: WorkflowRun;
  maxDuration: number;
  onRerun: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ run, maxDuration, onRerun, onCancel }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'var(--cicd-card-bg, #161b22)',
      borderRadius: 6,
      border: '1px solid var(--cicd-border, #30363d)',
      marginBottom: 6,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={14} color="var(--cicd-muted, #8b949e)" /> : <ChevronRight size={14} color="var(--cicd-muted, #8b949e)" />}
        <StatusIcon status={run.status} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--cicd-text, #c9d1d9)' }}>{run.name}</span>
            <BranchBadge branch={run.branch} />
            <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)', fontFamily: 'var(--cicd-mono, monospace)' }}>
              {run.commit}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)', marginTop: 3 }}>
            {run.commitMsg} &middot; {run.actor}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <DurationBar duration={run.duration} maxDuration={maxDuration} status={run.status} />
          <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)', minWidth: 48, textAlign: 'right' }}>
            {formatDuration(run.duration)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)', minWidth: 48, textAlign: 'right' }}>
            {timeAgo(run.startedAt)}
          </span>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            {(run.status === 'failure' || run.status === 'cancelled' || run.status === 'success') && (
              <button
                onClick={() => onRerun(run.id)}
                title="Re-run"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--cicd-border, #30363d)',
                  borderRadius: 4,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--cicd-muted, #8b949e)',
                }}
              >
                <RotateCcw size={13} />
              </button>
            )}
            {(run.status === 'running' || run.status === 'queued') && (
              <button
                onClick={() => onCancel(run.id)}
                title="Cancel"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--cicd-border, #30363d)',
                  borderRadius: 4,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--cicd-failure, #f85149)',
                }}
              >
                <Square size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded jobs */}
      {expanded && (
        <div style={{ padding: '4px 8px 10px', borderTop: '1px solid var(--cicd-border, #30363d)' }}>
          {run.jobs.map(job => <JobRow key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
};

// ── Deployment Card ─────────────────────────────────────────────────────────

const envMeta: Record<DeployEnv, { label: string; color: string; icon: React.ReactNode }> = {
  production: { label: 'Production', color: 'var(--cicd-success, #3fb950)', icon: <Globe size={14} /> },
  staging: { label: 'Staging', color: 'var(--cicd-running, #58a6ff)', icon: <Server size={14} /> },
  preview: { label: 'Preview', color: 'var(--cicd-queued, #d29922)', icon: <Rocket size={14} /> },
};

const DeploymentCard: React.FC<{ deployment: Deployment }> = ({ deployment }) => {
  const meta = envMeta[deployment.environment];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      background: 'var(--cicd-card-bg, #161b22)',
      borderRadius: 6,
      border: '1px solid var(--cicd-border, #30363d)',
      marginBottom: 4,
    }}>
      <StatusIcon status={deployment.status} size={14} />
      <span style={{ color: meta.color, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
        {meta.icon} {meta.label}
      </span>
      <BranchBadge branch={deployment.branch} />
      <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)', fontFamily: 'var(--cicd-mono, monospace)' }}>
        {deployment.commit}
      </span>
      <span style={{ flex: 1 }} />
      <a
        href={deployment.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 11, color: 'var(--cicd-running, #58a6ff)', textDecoration: 'none' }}
        onClick={e => e.preventDefault()}
      >
        {deployment.url.replace('https://', '')}
      </a>
      <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)' }}>{timeAgo(deployment.deployedAt)}</span>
    </div>
  );
};

// ── Quick Stats ─────────────────────────────────────────────────────────────

const QuickStats: React.FC<{ runs: WorkflowRun[] }> = ({ runs }) => {
  const completed = runs.filter(r => r.status === 'success' || r.status === 'failure');
  const successes = completed.filter(r => r.status === 'success').length;
  const successRate = completed.length > 0 ? Math.round((successes / completed.length) * 100) : 0;
  const avgDuration = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.duration, 0) / completed.length)
    : 0;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const runsThisWeek = runs.filter(r => r.startedAt.getTime() > oneWeekAgo).length;
  const runningCount = runs.filter(r => r.status === 'running').length;

  const stats = [
    { label: 'Success Rate', value: `${successRate}%`, icon: <TrendingUp size={14} />, color: successRate >= 80 ? 'var(--cicd-success, #3fb950)' : successRate >= 50 ? 'var(--cicd-queued, #d29922)' : 'var(--cicd-failure, #f85149)' },
    { label: 'Avg Duration', value: formatDuration(avgDuration), icon: <Timer size={14} />, color: 'var(--cicd-running, #58a6ff)' },
    { label: 'This Week', value: `${runsThisWeek}`, icon: <BarChart3 size={14} />, color: 'var(--cicd-branch-2, #bc8cff)' },
    { label: 'Running', value: `${runningCount}`, icon: <Loader size={14} />, color: 'var(--cicd-running, #58a6ff)' },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      {stats.map(st => (
        <div key={st.label} style={{
          flex: '1 1 100px',
          padding: '10px 14px',
          background: 'var(--cicd-card-bg, #161b22)',
          borderRadius: 6,
          border: '1px solid var(--cicd-border, #30363d)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--cicd-muted, #8b949e)' }}>
            {st.icon} {st.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: st.color }}>{st.value}</div>
        </div>
      ))}
    </div>
  );
};

// ── Main Panel ──────────────────────────────────────────────────────────────

const CICDPanel: React.FC = () => {
  const [runs, setRuns] = useState<WorkflowRun[]>(DEMO_RUNS);
  const [deployments] = useState<Deployment[]>(DEMO_DEPLOYMENTS);
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('');
  const [nameFilter, setNameFilter] = useState<string>('');
  const [refreshInterval, setRefreshInterval] = useState<number>(30);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'runs' | 'deployments'>('runs');
  const [searchText, setSearchText] = useState('');

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const id = setInterval(() => {
      setLastRefresh(new Date());
      // In a real app this would re-fetch from the API
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [refreshInterval]);

  // Derive filter options
  const allBranches = useMemo(() => [...new Set(runs.map(r => r.branch))], [runs]);
  const allNames = useMemo(() => [...new Set(runs.map(r => r.name))], [runs]);

  // Filtered runs
  const filteredRuns = useMemo(() => {
    return runs.filter(r => {
      if (branchFilter && r.branch !== branchFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (nameFilter && r.name !== nameFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const haystack = `${r.name} ${r.branch} ${r.commit} ${r.commitMsg} ${r.actor}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [runs, branchFilter, statusFilter, nameFilter, searchText]);

  const maxDuration = useMemo(() => Math.max(...runs.map(r => r.duration), 1), [runs]);

  const handleRerun = useCallback((id: string) => {
    setRuns(prev => prev.map(r =>
      r.id === id ? { ...r, status: 'queued' as RunStatus, duration: 0, startedAt: new Date() } : r
    ));
  }, []);

  const handleCancel = useCallback((id: string) => {
    setRuns(prev => prev.map(r =>
      r.id === id ? { ...r, status: 'cancelled' as RunStatus } : r
    ));
  }, []);

  const handleRefresh = useCallback(() => {
    setLastRefresh(new Date());
  }, []);

  const selectStyle: React.CSSProperties = {
    background: 'var(--cicd-input-bg, #0d1117)',
    color: 'var(--cicd-text, #c9d1d9)',
    border: '1px solid var(--cicd-border, #30363d)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--cicd-bg, #0d1117)',
      color: 'var(--cicd-text, #c9d1d9)',
      fontFamily: 'var(--cicd-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif)',
      overflow: 'hidden',
    }}>
      {/* Spinner keyframe injected via style tag */}
      <style>{`
        @keyframes cicd-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--cicd-border, #30363d)',
        flexShrink: 0,
      }}>
        <Play size={16} color="var(--cicd-running, #58a6ff)" />
        <span style={{ fontWeight: 700, fontSize: 14 }}>CI/CD</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--cicd-muted, #8b949e)' }}>
          Updated {timeAgo(lastRefresh)}
        </span>
        <button
          onClick={handleRefresh}
          title="Refresh now"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--cicd-muted, #8b949e)', display: 'flex', padding: 4 }}
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--cicd-muted, #8b949e)', display: 'flex', padding: 4 }}
        >
          <Settings size={14} />
        </button>
      </div>

      {/* ── Settings drawer ─────────────────────────────────────────────── */}
      {showSettings && (
        <div style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--cicd-border, #30363d)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          flexShrink: 0,
          background: 'var(--cicd-card-bg, #161b22)',
        }}>
          <label style={{ color: 'var(--cicd-muted, #8b949e)' }}>
            Auto-refresh interval:
          </label>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))} style={selectStyle}>
            <option value={0}>Off</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
            <option value={60}>1m</option>
            <option value={300}>5m</option>
          </select>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--cicd-border, #30363d)',
        flexShrink: 0,
      }}>
        {(['runs', 'deployments'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--cicd-running, #58a6ff)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--cicd-text, #c9d1d9)' : 'var(--cicd-muted, #8b949e)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'runs' ? 'Workflow Runs' : 'Deployments'}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {activeTab === 'runs' && (
          <>
            {/* Quick stats */}
            <QuickStats runs={runs} />

            {/* Filters */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
              flexWrap: 'wrap',
            }}>
              <Filter size={13} color="var(--cicd-muted, #8b949e)" />
              <div style={{ position: 'relative', flex: '1 1 140px' }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--cicd-muted, #8b949e)' }} />
                <input
                  type="text"
                  placeholder="Search runs..."
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  style={{
                    ...selectStyle,
                    width: '100%',
                    paddingLeft: 28,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={selectStyle}>
                <option value="">All branches</option>
                {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as RunStatus | '')} style={selectStyle}>
                <option value="">All statuses</option>
                {(['success', 'failure', 'running', 'cancelled', 'queued'] as RunStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select value={nameFilter} onChange={e => setNameFilter(e.target.value)} style={selectStyle}>
                <option value="">All workflows</option>
                {allNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {/* Run list */}
            {filteredRuns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--cicd-muted, #8b949e)', fontSize: 13 }}>
                No workflow runs match the current filters.
              </div>
            ) : (
              filteredRuns.map(run => (
                <RunCard
                  key={run.id}
                  run={run}
                  maxDuration={maxDuration}
                  onRerun={handleRerun}
                  onCancel={handleCancel}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'deployments' && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cicd-text, #c9d1d9)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Rocket size={14} /> Active Deployments
            </div>
            {deployments.map(dep => <DeploymentCard key={dep.id} deployment={dep} />)}
          </>
        )}
      </div>
    </div>
  );
};

export default CICDPanel;
