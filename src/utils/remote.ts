// Remote Development Connection Manager
// Manages SSH, Docker, WSL, Dev Container, and Tunnel connections

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionType = 'ssh' | 'docker' | 'wsl' | 'devcontainer' | 'tunnel';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type AuthMethod = 'key' | 'password' | 'agent' | 'keyAndPassword';
export type PortForwardProtocol = 'tcp' | 'udp';
export type PortForwardStatus = 'active' | 'inactive' | 'error';
export type RemoteFileType = 'file' | 'directory' | 'symlink' | 'unknown';

export interface SSHConfig {
  host: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  keyPath?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  keepAliveInterval?: number;
  readyTimeout?: number;
}

export interface DockerConfig {
  containerId: string;
  containerName: string;
  image: string;
  workDir: string;
  shell?: string;
  composeFile?: string;
  serviceName?: string;
}

export interface WSLConfig {
  distribution: string;
  user: string;
  mountPoint?: string;
  defaultShell?: string;
}

export interface DevContainerConfig {
  configPath: string;
  dockerComposeFile?: string;
  service?: string;
  workspaceFolder: string;
  image?: string;
  build?: {
    dockerfile?: string;
    context?: string;
    args?: Record<string, string>;
  };
  forwardPorts?: number[];
  remoteUser?: string;
  postCreateCommand?: string;
  postStartCommand?: string;
  extensions?: string[];
  settings?: Record<string, unknown>;
}

export interface TunnelConfig {
  tunnelId: string;
  name: string;
  endpoint: string;
  authToken?: string;
}

export type RemoteConfig = SSHConfig | DockerConfig | WSLConfig | DevContainerConfig | TunnelConfig;

export interface RemoteConnection {
  id: string;
  type: ConnectionType;
  status: ConnectionStatus;
  config: RemoteConfig;
  label: string;
  connectedAt?: number;
  lastError?: string;
  portForwards: PortForward[];
  metadata?: Record<string, string>;
}

export interface PortForward {
  id: string;
  localPort: number;
  remotePort: number;
  protocol: PortForwardProtocol;
  status: PortForwardStatus;
  bindAddress?: string;
}

export interface RemoteFileInfo {
  path: string;
  name: string;
  type: RemoteFileType;
  size: number;
  modifiedAt: number;
  permissions: string;
  owner?: string;
  group?: string;
}

export interface RemoteTerminalSession {
  id: string;
  connectionId: string;
  cols: number;
  rows: number;
  shell: string;
  cwd?: string;
  env?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROFILES_STORAGE_KEY = 'remote-connection-profiles';

let connectionIdCounter = 0;
let portForwardIdCounter = 0;
let terminalSessionIdCounter = 0;

function generateConnectionId(): string {
  return `conn-${Date.now()}-${++connectionIdCounter}`;
}

function generatePortForwardId(): string {
  return `pf-${Date.now()}-${++portForwardIdCounter}`;
}

function generateTerminalSessionId(): string {
  return `term-${Date.now()}-${++terminalSessionIdCounter}`;
}

function getApi(): any {
  return (window as any).api;
}

function buildConnectionLabel(type: ConnectionType, config: RemoteConfig): string {
  switch (type) {
    case 'ssh': {
      const ssh = config as SSHConfig;
      return `${ssh.user}@${ssh.host}:${ssh.port}`;
    }
    case 'docker': {
      const docker = config as DockerConfig;
      return docker.containerName || docker.containerId.substring(0, 12);
    }
    case 'wsl': {
      const wsl = config as WSLConfig;
      return `WSL: ${wsl.distribution}`;
    }
    case 'devcontainer': {
      const dc = config as DevContainerConfig;
      return `Dev Container: ${dc.service || dc.workspaceFolder}`;
    }
    case 'tunnel': {
      const tunnel = config as TunnelConfig;
      return `Tunnel: ${tunnel.name}`;
    }
    default:
      return 'Unknown Connection';
  }
}

// ─── Connection Store ────────────────────────────────────────────────────────

const activeConnections: Map<string, RemoteConnection> = new Map();
const connectionListeners: Array<(connections: RemoteConnection[]) => void> = [];

function notifyListeners(): void {
  const connections = getConnections();
  for (const listener of connectionListeners) {
    try {
      listener(connections);
    } catch (err) {
      console.error('[Remote] Listener error:', err);
    }
  }
}

function setConnectionStatus(
  connectionId: string,
  status: ConnectionStatus,
  error?: string
): void {
  const conn = activeConnections.get(connectionId);
  if (!conn) return;

  conn.status = status;
  if (status === 'connected') {
    conn.connectedAt = Date.now();
    conn.lastError = undefined;
  }
  if (status === 'error' && error) {
    conn.lastError = error;
  }
  if (status === 'disconnected') {
    conn.connectedAt = undefined;
  }

  activeConnections.set(connectionId, conn);
  notifyListeners();
}

// ─── SSH ─────────────────────────────────────────────────────────────────────

export async function connectSSH(config: SSHConfig): Promise<RemoteConnection> {
  const id = generateConnectionId();
  const connection: RemoteConnection = {
    id,
    type: 'ssh',
    status: 'connecting',
    config: { ...config, port: config.port || 22 },
    label: buildConnectionLabel('ssh', config),
    portForwards: [],
  };

  activeConnections.set(id, connection);
  notifyListeners();

  try {
    const api = getApi();
    if (api?.remoteConnectSSH) {
      await api.remoteConnectSSH({
        id,
        host: config.host,
        port: config.port || 22,
        user: config.user,
        authMethod: config.authMethod,
        keyPath: config.keyPath,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        keepAliveInterval: config.keepAliveInterval ?? 10000,
        readyTimeout: config.readyTimeout ?? 20000,
      });
    }

    setConnectionStatus(id, 'connected');

    if (config.keepAliveInterval) {
      startKeepAlive(id, config.keepAliveInterval);
    }

    return activeConnections.get(id)!;
  } catch (err: any) {
    const message = err?.message || 'SSH connection failed';
    setConnectionStatus(id, 'error', message);
    throw new Error(`SSH connection to ${config.host} failed: ${message}`);
  }
}

const keepAliveTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

function startKeepAlive(connectionId: string, intervalMs: number): void {
  stopKeepAlive(connectionId);

  const timer = setInterval(async () => {
    const conn = activeConnections.get(connectionId);
    if (!conn || conn.status !== 'connected') {
      stopKeepAlive(connectionId);
      return;
    }

    try {
      const api = getApi();
      if (api?.remoteKeepAlive) {
        await api.remoteKeepAlive(connectionId);
      }
    } catch {
      console.warn(`[Remote] Keep-alive failed for ${connectionId}`);
    }
  }, intervalMs);

  keepAliveTimers.set(connectionId, timer);
}

function stopKeepAlive(connectionId: string): void {
  const existing = keepAliveTimers.get(connectionId);
  if (existing) {
    clearInterval(existing);
    keepAliveTimers.delete(connectionId);
  }
}

// ─── Docker ──────────────────────────────────────────────────────────────────

export async function connectDocker(config: DockerConfig): Promise<RemoteConnection> {
  const id = generateConnectionId();
  const connection: RemoteConnection = {
    id,
    type: 'docker',
    status: 'connecting',
    config: { ...config, shell: config.shell || '/bin/sh' },
    label: buildConnectionLabel('docker', config),
    portForwards: [],
  };

  activeConnections.set(id, connection);
  notifyListeners();

  try {
    const api = getApi();
    if (api?.remoteConnectDocker) {
      await api.remoteConnectDocker({
        id,
        containerId: config.containerId,
        containerName: config.containerName,
        image: config.image,
        workDir: config.workDir || '/workspace',
        shell: config.shell || '/bin/sh',
      });
    }

    setConnectionStatus(id, 'connected');
    return activeConnections.get(id)!;
  } catch (err: any) {
    const message = err?.message || 'Docker connection failed';
    setConnectionStatus(id, 'error', message);
    throw new Error(`Docker connection to ${config.containerId} failed: ${message}`);
  }
}

// ─── WSL ─────────────────────────────────────────────────────────────────────

export async function connectWSL(config: WSLConfig): Promise<RemoteConnection> {
  const id = generateConnectionId();
  const connection: RemoteConnection = {
    id,
    type: 'wsl',
    status: 'connecting',
    config: {
      ...config,
      mountPoint: config.mountPoint || `/mnt/wsl/${config.distribution}`,
      defaultShell: config.defaultShell || '/bin/bash',
    },
    label: buildConnectionLabel('wsl', config),
    portForwards: [],
  };

  activeConnections.set(id, connection);
  notifyListeners();

  try {
    const api = getApi();
    if (api?.remoteConnectWSL) {
      await api.remoteConnectWSL({
        id,
        distribution: config.distribution,
        user: config.user,
      });
    }

    setConnectionStatus(id, 'connected');
    return activeConnections.get(id)!;
  } catch (err: any) {
    const message = err?.message || 'WSL connection failed';
    setConnectionStatus(id, 'error', message);
    throw new Error(`WSL connection to ${config.distribution} failed: ${message}`);
  }
}

// ─── Dev Container ───────────────────────────────────────────────────────────

export function parseDevContainer(content: string): DevContainerConfig {
  let parsed: any;

  try {
    // Strip JSON comments (// and /* */) before parsing
    const stripped = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1'); // trailing commas
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error('Failed to parse devcontainer.json: invalid JSON');
  }

  const config: DevContainerConfig = {
    configPath: '',
    workspaceFolder: parsed.workspaceFolder || '/workspace',
  };

  if (parsed.dockerComposeFile) {
    config.dockerComposeFile =
      typeof parsed.dockerComposeFile === 'string'
        ? parsed.dockerComposeFile
        : parsed.dockerComposeFile[0];
  }

  if (parsed.service) {
    config.service = parsed.service;
  }

  if (parsed.image) {
    config.image = parsed.image;
  }

  if (parsed.build) {
    config.build = {
      dockerfile: parsed.build.dockerfile,
      context: parsed.build.context || '.',
      args: parsed.build.args,
    };
  }

  if (Array.isArray(parsed.forwardPorts)) {
    config.forwardPorts = parsed.forwardPorts.filter(
      (p: unknown) => typeof p === 'number'
    );
  }

  if (parsed.remoteUser) {
    config.remoteUser = parsed.remoteUser;
  }

  if (parsed.postCreateCommand) {
    config.postCreateCommand =
      typeof parsed.postCreateCommand === 'string'
        ? parsed.postCreateCommand
        : (parsed.postCreateCommand as string[]).join(' && ');
  }

  if (parsed.postStartCommand) {
    config.postStartCommand =
      typeof parsed.postStartCommand === 'string'
        ? parsed.postStartCommand
        : (parsed.postStartCommand as string[]).join(' && ');
  }

  if (Array.isArray(parsed.extensions)) {
    config.extensions = parsed.extensions;
  } else if (
    parsed.customizations?.vscode?.extensions &&
    Array.isArray(parsed.customizations.vscode.extensions)
  ) {
    config.extensions = parsed.customizations.vscode.extensions;
  }

  if (parsed.settings) {
    config.settings = parsed.settings;
  } else if (parsed.customizations?.vscode?.settings) {
    config.settings = parsed.customizations.vscode.settings;
  }

  return config;
}

export async function buildDevContainer(
  configPath: string
): Promise<{ containerId: string; image: string }> {
  const api = getApi();
  if (api?.remoteDevContainerBuild) {
    return api.remoteDevContainerBuild({ configPath });
  }
  throw new Error('Dev container build not supported in this environment');
}

export async function connectDevContainer(
  configPath: string,
  content: string
): Promise<RemoteConnection> {
  const devConfig = parseDevContainer(content);
  devConfig.configPath = configPath;

  const id = generateConnectionId();
  const connection: RemoteConnection = {
    id,
    type: 'devcontainer',
    status: 'connecting',
    config: devConfig,
    label: buildConnectionLabel('devcontainer', devConfig),
    portForwards: [],
  };

  activeConnections.set(id, connection);
  notifyListeners();

  try {
    const buildResult = await buildDevContainer(configPath);

    const api = getApi();
    if (api?.remoteConnectDevContainer) {
      await api.remoteConnectDevContainer({
        id,
        containerId: buildResult.containerId,
        configPath,
        workspaceFolder: devConfig.workspaceFolder,
        remoteUser: devConfig.remoteUser,
      });
    }

    setConnectionStatus(id, 'connected');

    // Auto-forward ports from config
    if (devConfig.forwardPorts) {
      for (const port of devConfig.forwardPorts) {
        try {
          addPortForward(id, port, port);
        } catch {
          console.warn(`[Remote] Failed to auto-forward port ${port}`);
        }
      }
    }

    // Run post-create command
    if (devConfig.postCreateCommand) {
      try {
        await remoteExec(id, devConfig.postCreateCommand);
      } catch {
        console.warn('[Remote] postCreateCommand failed');
      }
    }

    return activeConnections.get(id)!;
  } catch (err: any) {
    const message = err?.message || 'Dev container connection failed';
    setConnectionStatus(id, 'error', message);
    throw new Error(`Dev container connection failed: ${message}`);
  }
}

// ─── Tunnel ──────────────────────────────────────────────────────────────────

export async function connectTunnel(config: TunnelConfig): Promise<RemoteConnection> {
  const id = generateConnectionId();
  const connection: RemoteConnection = {
    id,
    type: 'tunnel',
    status: 'connecting',
    config,
    label: buildConnectionLabel('tunnel', config),
    portForwards: [],
  };

  activeConnections.set(id, connection);
  notifyListeners();

  try {
    const api = getApi();
    if (api?.remoteConnectTunnel) {
      await api.remoteConnectTunnel({
        id,
        tunnelId: config.tunnelId,
        endpoint: config.endpoint,
        authToken: config.authToken,
      });
    }

    setConnectionStatus(id, 'connected');
    return activeConnections.get(id)!;
  } catch (err: any) {
    const message = err?.message || 'Tunnel connection failed';
    setConnectionStatus(id, 'error', message);
    throw new Error(`Tunnel connection failed: ${message}`);
  }
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

export async function disconnect(connectionId: string): Promise<void> {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error(`Connection ${connectionId} not found`);
  }

  // Remove all port forwards
  for (const pf of [...conn.portForwards]) {
    try {
      removePortForward(pf.id);
    } catch {
      // best effort
    }
  }

  stopKeepAlive(connectionId);

  try {
    const api = getApi();
    if (api?.remoteDisconnect) {
      await api.remoteDisconnect(connectionId);
    }
  } finally {
    setConnectionStatus(connectionId, 'disconnected');
    activeConnections.delete(connectionId);
    notifyListeners();
  }
}

export async function disconnectAll(): Promise<void> {
  const ids = Array.from(activeConnections.keys());
  const errors: string[] = [];

  for (const id of ids) {
    try {
      await disconnect(id);
    } catch (err: any) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn('[Remote] Some disconnections failed:', errors);
  }
}

// ─── Connection Query ────────────────────────────────────────────────────────

export function getConnections(): RemoteConnection[] {
  return Array.from(activeConnections.values());
}

export function getConnection(connectionId: string): RemoteConnection | undefined {
  return activeConnections.get(connectionId);
}

export function getConnectionsByType(type: ConnectionType): RemoteConnection[] {
  return getConnections().filter((c) => c.type === type);
}

export function getActiveConnections(): RemoteConnection[] {
  return getConnections().filter((c) => c.status === 'connected');
}

export function onConnectionsChanged(
  listener: (connections: RemoteConnection[]) => void
): () => void {
  connectionListeners.push(listener);
  return () => {
    const idx = connectionListeners.indexOf(listener);
    if (idx !== -1) connectionListeners.splice(idx, 1);
  };
}

// ─── Connection Profiles (localStorage) ──────────────────────────────────────

export function saveProfile(connection: RemoteConnection): void {
  const profiles = loadProfiles();
  const existing = profiles.findIndex((p) => p.id === connection.id);

  // Sanitize: strip passwords / private keys before persisting
  const sanitized: RemoteConnection = {
    ...connection,
    status: 'disconnected',
    connectedAt: undefined,
    lastError: undefined,
    portForwards: [],
    config: sanitizeConfigForStorage(connection.type, connection.config),
  };

  if (existing !== -1) {
    profiles[existing] = sanitized;
  } else {
    profiles.push(sanitized);
  }

  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error('[Remote] Failed to save profiles:', err);
  }
}

export function loadProfiles(): RemoteConnection[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const profiles = JSON.parse(raw);
    if (!Array.isArray(profiles)) return [];
    return profiles.filter(isValidProfile);
  } catch {
    return [];
  }
}

export function deleteProfile(profileId: string): void {
  const profiles = loadProfiles().filter((p) => p.id !== profileId);
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error('[Remote] Failed to delete profile:', err);
  }
}

export function clearProfiles(): void {
  try {
    localStorage.removeItem(PROFILES_STORAGE_KEY);
  } catch (err) {
    console.error('[Remote] Failed to clear profiles:', err);
  }
}

function sanitizeConfigForStorage(type: ConnectionType, config: RemoteConfig): RemoteConfig {
  if (type === 'ssh') {
    const ssh = { ...(config as SSHConfig) };
    delete ssh.password;
    delete ssh.privateKey;
    delete ssh.passphrase;
    return ssh;
  }
  return { ...config };
}

function isValidProfile(profile: any): profile is RemoteConnection {
  return (
    profile &&
    typeof profile.id === 'string' &&
    typeof profile.type === 'string' &&
    typeof profile.label === 'string' &&
    ['ssh', 'docker', 'wsl', 'devcontainer', 'tunnel'].includes(profile.type) &&
    profile.config !== null &&
    typeof profile.config === 'object'
  );
}

// ─── Port Forwarding ─────────────────────────────────────────────────────────

export function addPortForward(
  connectionId: string,
  localPort: number,
  remotePort: number,
  protocol: PortForwardProtocol = 'tcp',
  bindAddress: string = '127.0.0.1'
): PortForward {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error(`Connection ${connectionId} not found`);
  }

  // Check for duplicate local port across all connections
  for (const [, c] of activeConnections) {
    for (const pf of c.portForwards) {
      if (pf.localPort === localPort && pf.status === 'active') {
        throw new Error(`Local port ${localPort} is already forwarded`);
      }
    }
  }

  const forward: PortForward = {
    id: generatePortForwardId(),
    localPort,
    remotePort,
    protocol,
    status: 'active',
    bindAddress,
  };

  conn.portForwards.push(forward);
  activeConnections.set(connectionId, conn);

  const api = getApi();
  if (api?.remoteAddPortForward) {
    api.remoteAddPortForward({
      connectionId,
      forwardId: forward.id,
      localPort,
      remotePort,
      protocol,
      bindAddress,
    }).catch((err: any) => {
      forward.status = 'error';
      console.error(`[Remote] Port forward failed: ${err.message}`);
    });
  }

  notifyListeners();
  return forward;
}

export function removePortForward(forwardId: string): void {
  for (const [connId, conn] of activeConnections) {
    const idx = conn.portForwards.findIndex((pf) => pf.id === forwardId);
    if (idx !== -1) {
      conn.portForwards.splice(idx, 1);
      activeConnections.set(connId, conn);

      const api = getApi();
      if (api?.remoteRemovePortForward) {
        api.remoteRemovePortForward({ connectionId: connId, forwardId }).catch(
          (err: any) => console.warn(`[Remote] Remove port forward error: ${err.message}`)
        );
      }

      notifyListeners();
      return;
    }
  }

  throw new Error(`Port forward ${forwardId} not found`);
}

export function getPortForwards(connectionId: string): PortForward[] {
  const conn = activeConnections.get(connectionId);
  return conn ? [...conn.portForwards] : [];
}

export function getAllPortForwards(): Array<PortForward & { connectionId: string }> {
  const result: Array<PortForward & { connectionId: string }> = [];
  for (const [connId, conn] of activeConnections) {
    for (const pf of conn.portForwards) {
      result.push({ ...pf, connectionId: connId });
    }
  }
  return result;
}

// ─── Remote Execution ────────────────────────────────────────────────────────

export async function remoteExec(
  connectionId: string,
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
): Promise<string> {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error(`Connection ${connectionId} not found`);
  }
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active (status: ${conn.status})`);
  }

  const api = getApi();
  if (api?.remoteExec) {
    const result = await api.remoteExec({
      connectionId,
      command,
      cwd: options?.cwd,
      env: options?.env,
      timeout: options?.timeout ?? 30000,
    });
    return typeof result === 'string' ? result : result?.stdout ?? '';
  }

  throw new Error('Remote execution not supported in this environment');
}

// ─── Remote File System ──────────────────────────────────────────────────────

export async function remoteReadFile(
  connectionId: string,
  path: string,
  encoding: string = 'utf-8'
): Promise<string> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active`);
  }

  const api = getApi();
  if (api?.remoteReadFile) {
    return api.remoteReadFile({ connectionId, path, encoding });
  }

  throw new Error('Remote file read not supported in this environment');
}

export async function remoteWriteFile(
  connectionId: string,
  path: string,
  content: string,
  options?: { encoding?: string; mode?: string; createDirs?: boolean }
): Promise<void> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active`);
  }

  const api = getApi();
  if (api?.remoteWriteFile) {
    await api.remoteWriteFile({
      connectionId,
      path,
      content,
      encoding: options?.encoding ?? 'utf-8',
      mode: options?.mode,
      createDirs: options?.createDirs ?? false,
    });
    return;
  }

  throw new Error('Remote file write not supported in this environment');
}

export async function remoteListDir(
  connectionId: string,
  path: string
): Promise<RemoteFileInfo[]> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active`);
  }

  const api = getApi();
  if (api?.remoteListDir) {
    const entries = await api.remoteListDir({ connectionId, path });
    if (Array.isArray(entries)) {
      return entries.map(normalizeFileInfo);
    }
    return [];
  }

  throw new Error('Remote directory listing not supported in this environment');
}

export async function remoteStatFile(
  connectionId: string,
  path: string
): Promise<RemoteFileInfo> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active`);
  }

  const api = getApi();
  if (api?.remoteStatFile) {
    const stat = await api.remoteStatFile({ connectionId, path });
    return normalizeFileInfo(stat);
  }

  throw new Error('Remote stat not supported in this environment');
}

export async function remoteMkdir(
  connectionId: string,
  path: string,
  recursive: boolean = true
): Promise<void> {
  await remoteExec(connectionId, `mkdir ${recursive ? '-p' : ''} "${path}"`);
}

export async function remoteDelete(
  connectionId: string,
  path: string,
  recursive: boolean = false
): Promise<void> {
  await remoteExec(connectionId, `rm ${recursive ? '-rf' : '-f'} "${path}"`);
}

function normalizeFileInfo(raw: any): RemoteFileInfo {
  return {
    path: raw.path ?? '',
    name: raw.name ?? raw.path?.split('/').pop() ?? '',
    type: normalizeFileType(raw.type),
    size: typeof raw.size === 'number' ? raw.size : 0,
    modifiedAt: typeof raw.modifiedAt === 'number' ? raw.modifiedAt : 0,
    permissions: raw.permissions ?? '',
    owner: raw.owner,
    group: raw.group,
  };
}

function normalizeFileType(type: any): RemoteFileType {
  if (type === 'file' || type === 'directory' || type === 'symlink') return type;
  if (type === 'd' || type === 'dir') return 'directory';
  if (type === 'f') return 'file';
  if (type === 'l' || type === 'link') return 'symlink';
  return 'unknown';
}

// ─── Remote Terminal Sessions ────────────────────────────────────────────────

const activeSessions: Map<string, RemoteTerminalSession> = new Map();

export async function createTerminalSession(
  connectionId: string,
  options?: { cols?: number; rows?: number; shell?: string; cwd?: string; env?: Record<string, string> }
): Promise<RemoteTerminalSession> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'connected') {
    throw new Error(`Connection ${connectionId} is not active`);
  }

  const defaultShell = resolveDefaultShell(conn);

  const session: RemoteTerminalSession = {
    id: generateTerminalSessionId(),
    connectionId,
    cols: options?.cols ?? 80,
    rows: options?.rows ?? 24,
    shell: options?.shell ?? defaultShell,
    cwd: options?.cwd,
    env: options?.env,
  };

  const api = getApi();
  if (api?.remoteCreateTerminal) {
    await api.remoteCreateTerminal({
      sessionId: session.id,
      connectionId,
      cols: session.cols,
      rows: session.rows,
      shell: session.shell,
      cwd: session.cwd,
      env: session.env,
    });
  }

  activeSessions.set(session.id, session);
  return session;
}

export async function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Terminal session ${sessionId} not found`);

  session.cols = cols;
  session.rows = rows;

  const api = getApi();
  if (api?.remoteResizeTerminal) {
    await api.remoteResizeTerminal({ sessionId, cols, rows });
  }
}

export async function destroyTerminalSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const api = getApi();
  if (api?.remoteDestroyTerminal) {
    await api.remoteDestroyTerminal({ sessionId });
  }

  activeSessions.delete(sessionId);
}

export function getTerminalSessions(connectionId?: string): RemoteTerminalSession[] {
  const all = Array.from(activeSessions.values());
  if (connectionId) {
    return all.filter((s) => s.connectionId === connectionId);
  }
  return all;
}

function resolveDefaultShell(conn: RemoteConnection): string {
  switch (conn.type) {
    case 'ssh':
      return '/bin/bash';
    case 'docker':
      return (conn.config as DockerConfig).shell || '/bin/sh';
    case 'wsl':
      return (conn.config as WSLConfig).defaultShell || '/bin/bash';
    case 'devcontainer':
      return '/bin/bash';
    case 'tunnel':
      return '/bin/bash';
    default:
      return '/bin/sh';
  }
}

// ─── Reconnection ────────────────────────────────────────────────────────────

export async function reconnect(connectionId: string): Promise<RemoteConnection> {
  const conn = activeConnections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  if (conn.status === 'connected') {
    return conn;
  }

  switch (conn.type) {
    case 'ssh':
      return connectSSH(conn.config as SSHConfig);
    case 'docker':
      return connectDocker(conn.config as DockerConfig);
    case 'wsl':
      return connectWSL(conn.config as WSLConfig);
    case 'tunnel':
      return connectTunnel(conn.config as TunnelConfig);
    default:
      throw new Error(`Reconnection not supported for type: ${conn.type}`);
  }
}

export async function reconnectFromProfile(profileId: string): Promise<RemoteConnection> {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  switch (profile.type) {
    case 'ssh':
      return connectSSH(profile.config as SSHConfig);
    case 'docker':
      return connectDocker(profile.config as DockerConfig);
    case 'wsl':
      return connectWSL(profile.config as WSLConfig);
    case 'tunnel':
      return connectTunnel(profile.config as TunnelConfig);
    default:
      throw new Error(`Reconnection not supported for type: ${profile.type}`);
  }
}
