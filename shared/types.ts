// Agent types
export type AgentStatus = 'active' | 'working' | 'idle' | 'error'

export interface Agent {
  id: string
  name: string
  role: string
  status: AgentStatus
  currentTask?: string
  progress?: number // 0-100
  model?: string
}

export interface AgentLogEntry {
  id: string
  agentId: string
  timestamp: number
  message: string
  type: 'info' | 'action' | 'delegation' | 'error'
}

// File types
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
}

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isModified: boolean
  aiModified: boolean
  isPinned?: boolean
}

// Chat types
export type ChatMode = 'agent' | 'chat'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
  model?: string
  timestamp: number
  taskProgress?: TaskProgress[]
}

export interface TaskProgress {
  name: string
  status: 'done' | 'working' | 'pending'
}

// Terminal types
export interface TerminalSession {
  id: string
  name: string
  type: 'shell' | 'agent-output'
}

// Settings types
export interface ModelConfig {
  provider: string
  modelId: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

export interface AppSettings {
  theme: 'dark'
  fontSize: number
  fontFamily: string
  models: ModelConfig[]
  activeModelId: string
  agentModelMapping: Record<string, string>
}

// Workspace settings types
export interface WorkspaceSettings {
  excludePatterns: string[]
  searchExcludes: string[]
  autoSave: boolean
  formatOnSave: boolean
  tabSize: number
  insertSpaces: boolean
  fileAssociations: Record<string, string>
}

// OMO types
export interface OmoMessage {
  type: 'agent-status' | 'agent-log' | 'file-edit' | 'task-complete' | 'error'
  payload: unknown
}
