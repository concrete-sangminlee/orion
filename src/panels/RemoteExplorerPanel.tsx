import React, { useState, useCallback } from 'react';
import {
  Monitor,
  Server,
  Container,
  Terminal,
  Plus,
  Trash2,
  Edit3,
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Wifi,
  WifiOff,
  Key,
  Globe,
  ArrowUpDown,
  RefreshCw,
  Check,
  X,
  Clock,
  Activity,
  Box,
  HardDrive,
  Link,
  Unlink,
  Settings,
  Search,
  Play,
  Square,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type ConnectionType = 'SSH' | 'Docker' | 'WSL';
type AuthMethod = 'password' | 'key' | 'agent';
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

interface RemoteConnection {
  id: string;
  name: string;
  type: ConnectionType;
  host: string;
  user: string;
  port: number;
  authMethod: AuthMethod;
  status: ConnectionStatus;
  latencyMs: number | null;
  uptimeSeconds: number | null;
}

interface PortForward {
  id: string;
  connectionId: string;
  localPort: number;
  remotePort: number;
  remoteHost: string;
  active: boolean;
}

interface RemoteFileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: RemoteFileNode[];
}

interface SSHKey {
  id: string;
  name: string;
  fingerprint: string;
  type: string;
  addedAt: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused';
  ports: string;
}

interface WSLDistro {
  name: string;
  version: number;
  isDefault: boolean;
  state: 'running' | 'stopped';
}

// ── Demo Data ──────────────────────────────────────────────────────────────────

const DEMO_CONNECTIONS: RemoteConnection[] = [
  { id: 'c1', name: 'Production Server', type: 'SSH', host: '10.0.1.50', user: 'deploy', port: 22, authMethod: 'key', status: 'connected', latencyMs: 34, uptimeSeconds: 86400 },
  { id: 'c2', name: 'Staging Server', type: 'SSH', host: '10.0.1.51', user: 'admin', port: 2222, authMethod: 'password', status: 'disconnected', latencyMs: null, uptimeSeconds: null },
  { id: 'c3', name: 'Dev Docker Host', type: 'Docker', host: 'tcp://192.168.1.100:2376', user: 'root', port: 2376, authMethod: 'key', status: 'connected', latencyMs: 12, uptimeSeconds: 172800 },
  { id: 'c4', name: 'Ubuntu WSL', type: 'WSL', host: 'localhost', user: 'devuser', port: 0, authMethod: 'agent', status: 'connected', latencyMs: 1, uptimeSeconds: 3600 },
  { id: 'c5', name: 'CI Runner', type: 'SSH', host: '10.0.2.10', user: 'runner', port: 22, authMethod: 'key', status: 'connecting', latencyMs: null, uptimeSeconds: null },
  { id: 'c6', name: 'Database Server', type: 'SSH', host: '10.0.1.60', user: 'dba', port: 22, authMethod: 'key', status: 'disconnected', latencyMs: null, uptimeSeconds: null },
];

const DEMO_PORT_FORWARDS: PortForward[] = [
  { id: 'pf1', connectionId: 'c1', localPort: 8080, remotePort: 80, remoteHost: 'localhost', active: true },
  { id: 'pf2', connectionId: 'c1', localPort: 5432, remotePort: 5432, remoteHost: '10.0.1.60', active: true },
  { id: 'pf3', connectionId: 'c3', localPort: 3000, remotePort: 3000, remoteHost: 'localhost', active: false },
];

const DEMO_REMOTE_FILES: RemoteFileNode[] = [
  {
    name: 'home', path: '/home', isDirectory: true, children: [
      {
        name: 'deploy', path: '/home/deploy', isDirectory: true, children: [
          { name: '.bashrc', path: '/home/deploy/.bashrc', isDirectory: false },
          { name: '.ssh', path: '/home/deploy/.ssh', isDirectory: true, children: [
            { name: 'authorized_keys', path: '/home/deploy/.ssh/authorized_keys', isDirectory: false },
            { name: 'known_hosts', path: '/home/deploy/.ssh/known_hosts', isDirectory: false },
          ]},
          { name: 'app', path: '/home/deploy/app', isDirectory: true, children: [
            { name: 'server.js', path: '/home/deploy/app/server.js', isDirectory: false },
            { name: 'package.json', path: '/home/deploy/app/package.json', isDirectory: false },
            { name: 'Dockerfile', path: '/home/deploy/app/Dockerfile', isDirectory: false },
          ]},
        ]
      }
    ]
  },
  {
    name: 'etc', path: '/etc', isDirectory: true, children: [
      { name: 'nginx', path: '/etc/nginx', isDirectory: true, children: [
        { name: 'nginx.conf', path: '/etc/nginx/nginx.conf', isDirectory: false },
        { name: 'sites-enabled', path: '/etc/nginx/sites-enabled', isDirectory: true },
      ]},
      { name: 'hosts', path: '/etc/hosts', isDirectory: false },
    ]
  },
  {
    name: 'var', path: '/var', isDirectory: true, children: [
      { name: 'log', path: '/var/log', isDirectory: true, children: [
        { name: 'syslog', path: '/var/log/syslog', isDirectory: false },
        { name: 'auth.log', path: '/var/log/auth.log', isDirectory: false },
      ]},
    ]
  },
];

const DEMO_SSH_KEYS: SSHKey[] = [
  { id: 'k1', name: 'id_ed25519', fingerprint: 'SHA256:xR4g...Kp2Q', type: 'ED25519', addedAt: '2025-08-15' },
  { id: 'k2', name: 'deploy_rsa', fingerprint: 'SHA256:bN7f...Wm3A', type: 'RSA-4096', addedAt: '2025-06-01' },
  { id: 'k3', name: 'ci_runner_key', fingerprint: 'SHA256:qL5m...Yv8D', type: 'ED25519', addedAt: '2026-01-20' },
];

const DEMO_CONTAINERS: DockerContainer[] = [
  { id: 'dc1', name: 'web-frontend', image: 'nginx:alpine', status: 'running', ports: '80:80, 443:443' },
  { id: 'dc2', name: 'api-service', image: 'node:18-slim', status: 'running', ports: '3000:3000' },
  { id: 'dc3', name: 'postgres-db', image: 'postgres:15', status: 'running', ports: '5432:5432' },
  { id: 'dc4', name: 'redis-cache', image: 'redis:7', status: 'stopped', ports: '6379:6379' },
  { id: 'dc5', name: 'worker-queue', image: 'rabbitmq:3-management', status: 'paused', ports: '5672:5672, 15672:15672' },
];

const DEMO_WSL_DISTROS: WSLDistro[] = [
  { name: 'Ubuntu-22.04', version: 2, isDefault: true, state: 'running' },
  { name: 'Debian', version: 2, isDefault: false, state: 'stopped' },
  { name: 'Alpine', version: 2, isDefault: false, state: 'stopped' },
];

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-primary, #1e1e1e)',
    color: 'var(--text-primary, #cccccc)',
    fontFamily: 'var(--font-family, "Segoe UI", sans-serif)',
    fontSize: 13,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-color, #333)',
    flexShrink: 0,
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  headerActions: {
    display: 'flex',
    gap: 4,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary, #999)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
  },
  section: {
    borderBottom: '1px solid var(--border-color, #333)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--text-secondary, #999)',
  },
  connectionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px 5px 20px',
    cursor: 'pointer',
    fontSize: 13,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  connectionName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  badge: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 600,
    flexShrink: 0,
  },
  formGroup: {
    padding: '6px 12px',
  },
  input: {
    width: '100%',
    padding: '4px 8px',
    backgroundColor: 'var(--input-bg, #3c3c3c)',
    border: '1px solid var(--border-color, #555)',
    borderRadius: 3,
    color: 'var(--text-primary, #ccc)',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '4px 8px',
    backgroundColor: 'var(--input-bg, #3c3c3c)',
    border: '1px solid var(--border-color, #555)',
    borderRadius: 3,
    color: 'var(--text-primary, #ccc)',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  primaryBtn: {
    width: '100%',
    padding: '5px 10px',
    backgroundColor: 'var(--accent-color, #0078d4)',
    border: 'none',
    borderRadius: 3,
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  },
  label: {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-secondary, #999)',
    marginBottom: 3,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    borderBottom: '1px solid var(--border-color, #444)',
    color: 'var(--text-secondary, #999)',
    fontWeight: 600,
    fontSize: 11,
  },
  td: {
    padding: '4px 8px',
    borderBottom: '1px solid var(--border-color, #2a2a2a)',
  },
  treeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '80px 1fr',
    gap: '3px 8px',
    padding: '6px 20px',
    fontSize: 12,
  },
  detailLabel: {
    color: 'var(--text-secondary, #888)',
    fontSize: 11,
  },
  detailValue: {
    color: 'var(--text-primary, #ccc)',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '4px 12px',
    fontSize: 11,
    color: 'var(--text-secondary, #888)',
    borderTop: '1px solid var(--border-color, #333)',
    flexShrink: 0,
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  keyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 20px',
    fontSize: 12,
  },
  containerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 20px',
    fontSize: 12,
  },
  distroRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 20px',
    fontSize: 12,
  },
};

// ── Helper Components ──────────────────────────────────────────────────────────

const statusColor = (s: ConnectionStatus): string =>
  s === 'connected' ? '#4ec94e' : s === 'connecting' ? '#d4a017' : '#888';

const containerStatusColor = (s: string): string =>
  s === 'running' ? '#4ec94e' : s === 'paused' ? '#d4a017' : '#888';

const typeBadgeColor = (t: ConnectionType): { bg: string; fg: string } => {
  if (t === 'SSH') return { bg: '#264f78', fg: '#6cb6ff' };
  if (t === 'Docker') return { bg: '#2a4d3e', fg: '#56d364' };
  return { bg: '#4a3060', fg: '#c49bff' };
};

const typeIcon = (t: ConnectionType) => {
  if (t === 'SSH') return <Server size={14} />;
  if (t === 'Docker') return <Container size={14} />;
  return <Monitor size={14} />;
};

function formatUptime(seconds: number | null): string {
  if (seconds === null) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

// ── File Tree Component ────────────────────────────────────────────────────────

function FileTreeNode({ node, depth }: { node: RemoteFileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <>
      <div
        style={{
          ...styles.treeRow,
          paddingLeft: 20 + depth * 16,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--hover-bg, #2a2d2e)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
        }}
        onClick={() => node.isDirectory && setExpanded(!expanded)}
      >
        {node.isDirectory ? (
          expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        {node.isDirectory ? (
          <Folder size={14} style={{ color: 'var(--folder-color, #dcb67a)' }} />
        ) : (
          <FileText size={14} style={{ color: 'var(--text-secondary, #999)' }} />
        )}
        <span>{node.name}</span>
      </div>
      {node.isDirectory && expanded && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type ActiveTab = 'connections' | 'keys' | 'docker' | 'wsl';

const RemoteExplorerPanel: React.FC = () => {
  const [connections, setConnections] = useState<RemoteConnection[]>(DEMO_CONNECTIONS);
  const [portForwards, setPortForwards] = useState<PortForward[]>(DEMO_PORT_FORWARDS);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>(DEMO_SSH_KEYS);
  const [containers] = useState<DockerContainer[]>(DEMO_CONTAINERS);
  const [wslDistros] = useState<WSLDistro[]>(DEMO_WSL_DISTROS);

  const [activeTab, setActiveTab] = useState<ActiveTab>('connections');
  const [selectedConnection, setSelectedConnection] = useState<string | null>('c1');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    saved: true, quickConnect: false, details: true, files: true, ports: true,
  });

  // Quick connect form state
  const [newConn, setNewConn] = useState({
    name: '', type: 'SSH' as ConnectionType, host: '', user: '', port: '22', authMethod: 'key' as AuthMethod,
  });

  // Port forward form
  const [showPortForm, setShowPortForm] = useState(false);
  const [newPort, setNewPort] = useState({ localPort: '', remotePort: '', remoteHost: 'localhost' });

  // SSH key form
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKey, setNewKey] = useState({ name: '', type: 'ED25519' });

  const [searchQuery, setSearchQuery] = useState('');

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const selected = connections.find((c) => c.id === selectedConnection) ?? null;

  const filteredConnections = connections.filter(
    (c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.host.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleConnect = useCallback((id: string) => {
    setConnections((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: c.status === 'connected' ? 'disconnected' : 'connecting' as ConnectionStatus, latencyMs: c.status === 'connected' ? null : c.latencyMs, uptimeSeconds: c.status === 'connected' ? null : c.uptimeSeconds }
          : c
      )
    );
    // Simulate connecting
    setTimeout(() => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === id && c.status === 'connecting'
            ? { ...c, status: 'connected', latencyMs: Math.floor(Math.random() * 80) + 5, uptimeSeconds: 0 }
            : c
        )
      );
    }, 1500);
  }, []);

  const handleDeleteConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    if (selectedConnection === id) setSelectedConnection(null);
  }, [selectedConnection]);

  const handleAddConnection = useCallback(() => {
    if (!newConn.name || !newConn.host) return;
    const conn: RemoteConnection = {
      id: `c${Date.now()}`,
      name: newConn.name,
      type: newConn.type,
      host: newConn.host,
      user: newConn.user || 'root',
      port: parseInt(newConn.port) || 22,
      authMethod: newConn.authMethod,
      status: 'disconnected',
      latencyMs: null,
      uptimeSeconds: null,
    };
    setConnections((prev) => [...prev, conn]);
    setNewConn({ name: '', type: 'SSH', host: '', user: '', port: '22', authMethod: 'key' });
  }, [newConn]);

  const handleAddPortForward = useCallback(() => {
    if (!newPort.localPort || !newPort.remotePort || !selectedConnection) return;
    const pf: PortForward = {
      id: `pf${Date.now()}`,
      connectionId: selectedConnection,
      localPort: parseInt(newPort.localPort),
      remotePort: parseInt(newPort.remotePort),
      remoteHost: newPort.remoteHost || 'localhost',
      active: true,
    };
    setPortForwards((prev) => [...prev, pf]);
    setNewPort({ localPort: '', remotePort: '', remoteHost: 'localhost' });
    setShowPortForm(false);
  }, [newPort, selectedConnection]);

  const handleRemovePortForward = useCallback((id: string) => {
    setPortForwards((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleTogglePortForward = useCallback((id: string) => {
    setPortForwards((prev) => prev.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  }, []);

  const handleAddKey = useCallback(() => {
    if (!newKey.name) return;
    const key: SSHKey = {
      id: `k${Date.now()}`,
      name: newKey.name,
      fingerprint: `SHA256:${Math.random().toString(36).substring(2, 8)}...${Math.random().toString(36).substring(2, 6)}`,
      type: newKey.type,
      addedAt: new Date().toISOString().split('T')[0],
    };
    setSSHKeys((prev) => [...prev, key]);
    setNewKey({ name: '', type: 'ED25519' });
    setShowKeyForm(false);
  }, [newKey]);

  const handleDeleteKey = useCallback((id: string) => {
    setSSHKeys((prev) => prev.filter((k) => k.id !== id));
  }, []);

  const selectedPortForwards = portForwards.filter((p) => p.connectionId === selectedConnection);

  // ── Tab Bar ──────────────────────────────────────────────────────────────────

  const tabs: { key: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { key: 'connections', label: 'Connections', icon: <Globe size={13} /> },
    { key: 'keys', label: 'SSH Keys', icon: <Key size={13} /> },
    { key: 'docker', label: 'Docker', icon: <Container size={13} /> },
    { key: 'wsl', label: 'WSL', icon: <Monitor size={13} /> },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <Globe size={14} />
          Remote Explorer
        </div>
        <div style={styles.headerActions}>
          <button style={styles.iconBtn} title="Refresh"><RefreshCw size={14} /></button>
          <button style={styles.iconBtn} title="Settings"><Settings size={14} /></button>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color, #333)', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '6px 4px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent-color, #0078d4)' : '2px solid transparent',
              color: activeTab === tab.key ? 'var(--text-primary, #ccc)' : 'var(--text-secondary, #888)',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.scrollArea}>
        {/* ── Connections Tab ──────────────────────────────────────────────── */}
        {activeTab === 'connections' && (
          <>
            {/* Search */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color, #333)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 7, top: 6, color: 'var(--text-secondary, #888)' }} />
                <input
                  style={{ ...styles.input, paddingLeft: 26 }}
                  placeholder="Filter connections..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Saved Connections */}
            <div style={styles.section}>
              <div style={styles.sectionHeader} onClick={() => toggleSection('saved')}>
                {expandedSections.saved ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Saved Connections ({filteredConnections.length})
              </div>
              {expandedSections.saved && filteredConnections.map((conn) => {
                const badgeColors = typeBadgeColor(conn.type);
                const isSelected = selectedConnection === conn.id;
                return (
                  <div
                    key={conn.id}
                    style={{
                      ...styles.connectionItem,
                      backgroundColor: isSelected ? 'var(--selection-bg, #094771)' : 'transparent',
                    }}
                    onClick={() => setSelectedConnection(conn.id)}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--hover-bg, #2a2d2e)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <div style={{ ...styles.statusDot, backgroundColor: statusColor(conn.status) }} />
                    {typeIcon(conn.type)}
                    <span style={styles.connectionName}>{conn.name}</span>
                    <span style={{ ...styles.badge, backgroundColor: badgeColors.bg, color: badgeColors.fg }}>
                      {conn.type}
                    </span>
                    <button
                      style={styles.iconBtn}
                      title={conn.status === 'connected' ? 'Disconnect' : 'Connect'}
                      onClick={(e) => { e.stopPropagation(); handleConnect(conn.id); }}
                    >
                      {conn.status === 'connected' ? <Unlink size={13} /> : <Link size={13} />}
                    </button>
                    <button
                      style={styles.iconBtn}
                      title="Open Terminal"
                      onClick={(e) => { e.stopPropagation(); }}
                    >
                      <Terminal size={13} />
                    </button>
                    <button
                      style={styles.iconBtn}
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteConnection(conn.id); }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Quick Connect Form */}
            <div style={styles.section}>
              <div style={styles.sectionHeader} onClick={() => toggleSection('quickConnect')}>
                {expandedSections.quickConnect ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Plus size={12} />
                Quick Connect
              </div>
              {expandedSections.quickConnect && (
                <div style={{ padding: '4px 0 8px' }}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Connection Name</label>
                    <input
                      style={styles.input}
                      placeholder="My Server"
                      value={newConn.name}
                      onChange={(e) => setNewConn((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div style={{ ...styles.formGroup, display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={styles.label}>Type</label>
                      <select
                        style={styles.select}
                        value={newConn.type}
                        onChange={(e) => setNewConn((p) => ({ ...p, type: e.target.value as ConnectionType }))}
                      >
                        <option value="SSH">SSH</option>
                        <option value="Docker">Docker</option>
                        <option value="WSL">WSL</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={styles.label}>Auth Method</label>
                      <select
                        style={styles.select}
                        value={newConn.authMethod}
                        onChange={(e) => setNewConn((p) => ({ ...p, authMethod: e.target.value as AuthMethod }))}
                      >
                        <option value="key">SSH Key</option>
                        <option value="password">Password</option>
                        <option value="agent">Agent</option>
                      </select>
                    </div>
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Host</label>
                    <input
                      style={styles.input}
                      placeholder="192.168.1.100"
                      value={newConn.host}
                      onChange={(e) => setNewConn((p) => ({ ...p, host: e.target.value }))}
                    />
                  </div>
                  <div style={{ ...styles.formGroup, display: 'flex', gap: 8 }}>
                    <div style={{ flex: 2 }}>
                      <label style={styles.label}>User</label>
                      <input
                        style={styles.input}
                        placeholder="root"
                        value={newConn.user}
                        onChange={(e) => setNewConn((p) => ({ ...p, user: e.target.value }))}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={styles.label}>Port</label>
                      <input
                        style={styles.input}
                        placeholder="22"
                        value={newConn.port}
                        onChange={(e) => setNewConn((p) => ({ ...p, port: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div style={styles.formGroup}>
                    <button style={styles.primaryBtn} onClick={handleAddConnection}>
                      Add Connection
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Connection Details */}
            {selected && (
              <div style={styles.section}>
                <div style={styles.sectionHeader} onClick={() => toggleSection('details')}>
                  {expandedSections.details ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Connection Details
                </div>
                {expandedSections.details && (
                  <div style={styles.detailGrid}>
                    <span style={styles.detailLabel}>Name</span>
                    <span style={styles.detailValue}>{selected.name}</span>
                    <span style={styles.detailLabel}>Type</span>
                    <span style={styles.detailValue}>{selected.type}</span>
                    <span style={styles.detailLabel}>Host</span>
                    <span style={styles.detailValue}>{selected.host}</span>
                    <span style={styles.detailLabel}>User</span>
                    <span style={styles.detailValue}>{selected.user}</span>
                    <span style={styles.detailLabel}>Port</span>
                    <span style={styles.detailValue}>{selected.port}</span>
                    <span style={styles.detailLabel}>Auth</span>
                    <span style={styles.detailValue}>{selected.authMethod}</span>
                    <span style={styles.detailLabel}>Status</span>
                    <span style={{ ...styles.detailValue, color: statusColor(selected.status) }}>
                      {selected.status}
                    </span>
                    <span style={styles.detailLabel}>Latency</span>
                    <span style={styles.detailValue}>
                      {selected.latencyMs !== null ? `${selected.latencyMs}ms` : '--'}
                    </span>
                    <span style={styles.detailLabel}>Uptime</span>
                    <span style={styles.detailValue}>{formatUptime(selected.uptimeSeconds)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Remote File Browser */}
            {selected?.status === 'connected' && (
              <div style={styles.section}>
                <div style={styles.sectionHeader} onClick={() => toggleSection('files')}>
                  {expandedSections.files ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Remote Files
                </div>
                {expandedSections.files && (
                  <div style={{ paddingBottom: 4 }}>
                    {DEMO_REMOTE_FILES.map((node) => (
                      <FileTreeNode key={node.path} node={node} depth={0} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Port Forwarding */}
            {selected && (
              <div style={styles.section}>
                <div style={styles.sectionHeader} onClick={() => toggleSection('ports')}>
                  {expandedSections.ports ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <ArrowUpDown size={12} />
                  Port Forwarding ({selectedPortForwards.length})
                  <button
                    style={{ ...styles.iconBtn, marginLeft: 'auto' }}
                    title="Add Port Forward"
                    onClick={(e) => { e.stopPropagation(); setShowPortForm(!showPortForm); }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {expandedSections.ports && (
                  <div style={{ padding: '0 12px 8px' }}>
                    {showPortForm && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <label style={styles.label}>Local</label>
                          <input
                            style={styles.input}
                            placeholder="8080"
                            value={newPort.localPort}
                            onChange={(e) => setNewPort((p) => ({ ...p, localPort: e.target.value }))}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={styles.label}>Remote</label>
                          <input
                            style={styles.input}
                            placeholder="80"
                            value={newPort.remotePort}
                            onChange={(e) => setNewPort((p) => ({ ...p, remotePort: e.target.value }))}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={styles.label}>Host</label>
                          <input
                            style={styles.input}
                            placeholder="localhost"
                            value={newPort.remoteHost}
                            onChange={(e) => setNewPort((p) => ({ ...p, remoteHost: e.target.value }))}
                          />
                        </div>
                        <button style={{ ...styles.iconBtn, color: '#4ec94e' }} onClick={handleAddPortForward}><Check size={14} /></button>
                        <button style={styles.iconBtn} onClick={() => setShowPortForm(false)}><X size={14} /></button>
                      </div>
                    )}
                    {selectedPortForwards.length > 0 ? (
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Local</th>
                            <th style={styles.th}>Remote</th>
                            <th style={styles.th}>Host</th>
                            <th style={styles.th}>Status</th>
                            <th style={{ ...styles.th, width: 50 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPortForwards.map((pf) => (
                            <tr key={pf.id}>
                              <td style={styles.td}>{pf.localPort}</td>
                              <td style={styles.td}>{pf.remotePort}</td>
                              <td style={styles.td}>{pf.remoteHost}</td>
                              <td style={styles.td}>
                                <span
                                  style={{ color: pf.active ? '#4ec94e' : '#888', cursor: 'pointer' }}
                                  onClick={() => handleTogglePortForward(pf.id)}
                                >
                                  {pf.active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td style={styles.td}>
                                <button style={styles.iconBtn} onClick={() => handleRemovePortForward(pf.id)}>
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ color: 'var(--text-secondary, #888)', fontSize: 12, padding: '4px 0' }}>
                        No port forwards configured.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── SSH Keys Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'keys' && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #999)' }}>
                Registered Keys ({sshKeys.length})
              </span>
              <button
                style={styles.iconBtn}
                title="Add Key"
                onClick={() => setShowKeyForm(!showKeyForm)}
              >
                <Plus size={14} />
              </button>
            </div>

            {showKeyForm && (
              <div style={{ padding: '4px 12px 8px', borderBottom: '1px solid var(--border-color, #333)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 2 }}>
                    <label style={styles.label}>Key Name</label>
                    <input
                      style={styles.input}
                      placeholder="my_key"
                      value={newKey.name}
                      onChange={(e) => setNewKey((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Type</label>
                    <select
                      style={styles.select}
                      value={newKey.type}
                      onChange={(e) => setNewKey((p) => ({ ...p, type: e.target.value }))}
                    >
                      <option value="ED25519">ED25519</option>
                      <option value="RSA-4096">RSA-4096</option>
                      <option value="ECDSA">ECDSA</option>
                    </select>
                  </div>
                  <button style={{ ...styles.iconBtn, color: '#4ec94e' }} onClick={handleAddKey}><Check size={14} /></button>
                  <button style={styles.iconBtn} onClick={() => setShowKeyForm(false)}><X size={14} /></button>
                </div>
              </div>
            )}

            {sshKeys.map((key) => (
              <div
                key={key.id}
                style={styles.keyRow}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--hover-bg, #2a2d2e)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
              >
                <Key size={14} style={{ color: 'var(--accent-color, #0078d4)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{key.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)' }}>
                    {key.type} &middot; {key.fingerprint} &middot; Added {key.addedAt}
                  </div>
                </div>
                <button style={styles.iconBtn} title="Delete Key" onClick={() => handleDeleteKey(key.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Docker Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'docker' && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ padding: '4px 12px 6px', fontSize: 12, color: 'var(--text-secondary, #999)' }}>
              Connected to <strong style={{ color: 'var(--text-primary, #ccc)' }}>Dev Docker Host</strong> (tcp://192.168.1.100:2376)
            </div>
            <div style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #999)', textTransform: 'uppercase' }}>
              Containers ({containers.length})
            </div>
            {containers.map((ctr) => (
              <div
                key={ctr.id}
                style={styles.containerRow}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--hover-bg, #2a2d2e)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
              >
                <div style={{ ...styles.statusDot, backgroundColor: containerStatusColor(ctr.status) }} />
                <Box size={14} style={{ color: '#56d364', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ctr.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)' }}>
                    {ctr.image} &middot; {ctr.ports}
                  </div>
                </div>
                <span style={{
                  ...styles.badge,
                  backgroundColor: ctr.status === 'running' ? '#1a3a2a' : ctr.status === 'paused' ? '#3a3520' : '#3a2020',
                  color: containerStatusColor(ctr.status),
                }}>
                  {ctr.status}
                </span>
                {ctr.status === 'running' ? (
                  <button style={styles.iconBtn} title="Stop"><Square size={13} /></button>
                ) : (
                  <button style={styles.iconBtn} title="Start"><Play size={13} /></button>
                )}
                <button style={styles.iconBtn} title="Open Terminal"><Terminal size={13} /></button>
              </div>
            ))}
          </div>
        )}

        {/* ── WSL Tab ──────────────────────────────────────────────────────── */}
        {activeTab === 'wsl' && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ padding: '4px 12px 6px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #999)', textTransform: 'uppercase' }}>
              WSL Distributions ({wslDistros.length})
            </div>
            {wslDistros.map((distro) => (
              <div
                key={distro.name}
                style={styles.distroRow}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--hover-bg, #2a2d2e)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
              >
                <div style={{ ...styles.statusDot, backgroundColor: distro.state === 'running' ? '#4ec94e' : '#888' }} />
                <HardDrive size={14} style={{ color: '#c49bff', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {distro.name}
                    {distro.isDefault && (
                      <span style={{ ...styles.badge, marginLeft: 6, backgroundColor: '#264f78', color: '#6cb6ff' }}>
                        Default
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)' }}>
                    WSL {distro.version} &middot; {distro.state}
                  </div>
                </div>
                {distro.state === 'running' ? (
                  <button style={styles.iconBtn} title="Stop"><Square size={13} /></button>
                ) : (
                  <button style={styles.iconBtn} title="Start"><Play size={13} /></button>
                )}
                <button style={styles.iconBtn} title="Open Terminal"><Terminal size={13} /></button>
                <button style={styles.iconBtn} title="Open File Explorer"><Folder size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Status Bar */}
      <div style={styles.statusBar}>
        {selected ? (
          <>
            <div style={styles.statusItem}>
              {selected.status === 'connected' ? <Wifi size={12} color="#4ec94e" /> : <WifiOff size={12} />}
              <span>{selected.name}</span>
            </div>
            <div style={styles.statusItem}>
              <Activity size={12} />
              <span>{selected.latencyMs !== null ? `${selected.latencyMs}ms` : '--'}</span>
            </div>
            <div style={styles.statusItem}>
              <Clock size={12} />
              <span>{formatUptime(selected.uptimeSeconds)}</span>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              {selected.type} &middot; {selected.host}
            </div>
          </>
        ) : (
          <span>No connection selected</span>
        )}
      </div>
    </div>
  );
};

export default RemoteExplorerPanel;
