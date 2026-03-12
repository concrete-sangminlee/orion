/**
 * Real-time collaboration hooks.
 * Provides presence awareness, cursor sharing, and collaborative editing support.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

/* ── Types ─────────────────────────────────────────────── */

export interface CollaboratorInfo {
  id: string
  name: string
  avatar?: string
  color: string
  cursor?: CursorPosition
  selection?: SelectionRange
  file?: string
  lastActive: number
  isTyping: boolean
}

export interface CursorPosition {
  line: number
  column: number
  file: string
}

export interface SelectionRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  file: string
}

export interface CollaborationSession {
  id: string
  name: string
  host: string
  participants: CollaboratorInfo[]
  createdAt: number
  accessLevel: 'read' | 'write'
  maxParticipants: number
}

export interface EditOperation {
  type: 'insert' | 'delete' | 'replace'
  file: string
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  text?: string
  userId: string
  timestamp: number
  version: number
}

export interface ChatMessage {
  id: string
  userId: string
  userName: string
  text: string
  timestamp: number
  type: 'message' | 'system' | 'code'
}

/* ── Collaborator Colors ──────────────────────────────── */

const COLLAB_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#F1948A', '#85929E', '#73C6B6',
]

function getCollaboratorColor(index: number): string {
  return COLLAB_COLORS[index % COLLAB_COLORS.length]
}

/* ── Connection State ─────────────────────────────────── */

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface CollabState {
  connectionState: ConnectionState
  session: CollaborationSession | null
  collaborators: CollaboratorInfo[]
  localUser: CollaboratorInfo | null
  chatMessages: ChatMessage[]
  pendingOps: EditOperation[]
  documentVersions: Map<string, number>
}

/* ── WebSocket Manager ────────────────────────────────── */

class CollaborationManager {
  private ws: WebSocket | null = null
  private state: CollabState = {
    connectionState: 'disconnected',
    session: null,
    collaborators: [],
    localUser: null,
    chatMessages: [],
    pendingOps: [],
    documentVersions: new Map(),
  }
  private listeners = new Set<(state: CollabState) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  subscribe(listener: (state: CollabState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach(l => l({ ...this.state }))
  }

  private setState(partial: Partial<CollabState>): void {
    Object.assign(this.state, partial)
    this.notify()
  }

  async connect(serverUrl: string, sessionId: string, userName: string): Promise<void> {
    if (this.ws) this.disconnect()

    this.setState({ connectionState: 'connecting' })

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${serverUrl}/collab/${sessionId}?name=${encodeURIComponent(userName)}`)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
          this.setState({ connectionState: 'connected' })
          this.startHeartbeat()
          resolve()
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data))
        }

        this.ws.onclose = () => {
          this.stopHeartbeat()
          if (this.state.connectionState !== 'disconnected') {
            this.attemptReconnect(serverUrl, sessionId, userName)
          }
        }

        this.ws.onerror = () => {
          this.setState({ connectionState: 'error' })
          reject(new Error('WebSocket connection failed'))
        }
      } catch (err) {
        this.setState({ connectionState: 'error' })
        reject(err)
      }
    })
  }

  disconnect(): void {
    this.setState({ connectionState: 'disconnected' })
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setState({
      session: null,
      collaborators: [],
      localUser: null,
      chatMessages: [],
      pendingOps: [],
    })
  }

  private attemptReconnect(serverUrl: string, sessionId: string, userName: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState({ connectionState: 'error' })
      return
    }

    this.setState({ connectionState: 'reconnecting' })
    this.reconnectAttempts++

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectTimer = setTimeout(() => {
      this.connect(serverUrl, sessionId, userName).catch(() => {
        this.attemptReconnect(serverUrl, sessionId, userName)
      })
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', timestamp: Date.now() })
    }, 15000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'session-info':
        this.setState({
          session: msg.session,
          localUser: {
            id: msg.userId,
            name: msg.userName,
            color: getCollaboratorColor(msg.colorIndex || 0),
            lastActive: Date.now(),
            isTyping: false,
          },
        })
        break

      case 'participant-joined':
        this.setState({
          collaborators: [
            ...this.state.collaborators,
            {
              id: msg.userId,
              name: msg.userName,
              color: getCollaboratorColor(this.state.collaborators.length + 1),
              lastActive: Date.now(),
              isTyping: false,
            },
          ],
        })
        this.addSystemMessage(`${msg.userName} joined the session`)
        break

      case 'participant-left':
        this.setState({
          collaborators: this.state.collaborators.filter(c => c.id !== msg.userId),
        })
        this.addSystemMessage(`${msg.userName} left the session`)
        break

      case 'cursor-update':
        this.setState({
          collaborators: this.state.collaborators.map(c =>
            c.id === msg.userId ? { ...c, cursor: msg.cursor, file: msg.cursor?.file, lastActive: Date.now() } : c
          ),
        })
        break

      case 'selection-update':
        this.setState({
          collaborators: this.state.collaborators.map(c =>
            c.id === msg.userId ? { ...c, selection: msg.selection, lastActive: Date.now() } : c
          ),
        })
        break

      case 'typing-indicator':
        this.setState({
          collaborators: this.state.collaborators.map(c =>
            c.id === msg.userId ? { ...c, isTyping: msg.isTyping, lastActive: Date.now() } : c
          ),
        })
        break

      case 'edit-operation':
        this.applyRemoteEdit(msg.operation)
        break

      case 'chat-message':
        this.setState({
          chatMessages: [
            ...this.state.chatMessages.slice(-199),
            {
              id: msg.id,
              userId: msg.userId,
              userName: msg.userName,
              text: msg.text,
              timestamp: msg.timestamp,
              type: 'message',
            },
          ],
        })
        break

      case 'sync':
        // Full document sync from server
        this.state.documentVersions.set(msg.file, msg.version)
        break
    }
  }

  private addSystemMessage(text: string): void {
    this.setState({
      chatMessages: [
        ...this.state.chatMessages.slice(-199),
        {
          id: `sys-${Date.now()}`,
          userId: 'system',
          userName: 'System',
          text,
          timestamp: Date.now(),
          type: 'system',
        },
      ],
    })
  }

  private applyRemoteEdit(operation: EditOperation): void {
    // Dispatch to editor for OT merge
    window.dispatchEvent(new CustomEvent('orion:collab-edit', { detail: operation }))
    this.state.documentVersions.set(operation.file, operation.version)
  }

  // Public methods for sending updates
  sendCursorUpdate(cursor: CursorPosition): void {
    this.send({ type: 'cursor-update', cursor })
  }

  sendSelectionUpdate(selection: SelectionRange): void {
    this.send({ type: 'selection-update', selection })
  }

  sendTypingIndicator(isTyping: boolean): void {
    this.send({ type: 'typing-indicator', isTyping })
  }

  sendEditOperation(operation: Omit<EditOperation, 'userId' | 'timestamp' | 'version'>): void {
    const file = operation.file
    const version = (this.state.documentVersions.get(file) || 0) + 1
    this.state.documentVersions.set(file, version)

    const fullOp: EditOperation = {
      ...operation,
      userId: this.state.localUser?.id || '',
      timestamp: Date.now(),
      version,
    }

    this.send({ type: 'edit-operation', operation: fullOp })
  }

  sendChatMessage(text: string): void {
    this.send({
      type: 'chat-message',
      text,
      timestamp: Date.now(),
    })
  }

  createSession(name: string): void {
    this.send({ type: 'create-session', name })
  }

  getShareLink(): string {
    return this.state.session
      ? `orion://collab/${this.state.session.id}`
      : ''
  }
}

// Singleton
const manager = new CollaborationManager()

/* ── React Hooks ──────────────────────────────────────── */

/** Main collaboration hook */
export function useCollaboration() {
  const [state, setState] = useState<CollabState>({
    connectionState: 'disconnected',
    session: null,
    collaborators: [],
    localUser: null,
    chatMessages: [],
    pendingOps: [],
    documentVersions: new Map(),
  })

  useEffect(() => {
    return manager.subscribe(setState)
  }, [])

  const connect = useCallback(async (serverUrl: string, sessionId: string, userName: string) => {
    await manager.connect(serverUrl, sessionId, userName)
  }, [])

  const disconnect = useCallback(() => {
    manager.disconnect()
  }, [])

  const sendChatMessage = useCallback((text: string) => {
    manager.sendChatMessage(text)
  }, [])

  const shareLink = useMemo(() => manager.getShareLink(), [state.session])

  return {
    ...state,
    connect,
    disconnect,
    sendChatMessage,
    shareLink,
    isConnected: state.connectionState === 'connected',
    isReconnecting: state.connectionState === 'reconnecting',
  }
}

/** Hook for tracking collaborator cursors in the editor */
export function useCollaboratorCursors(currentFile: string) {
  const [cursors, setCursors] = useState<CollaboratorInfo[]>([])

  useEffect(() => {
    return manager.subscribe((state) => {
      const relevant = state.collaborators.filter(
        c => c.cursor?.file === currentFile || c.selection?.file === currentFile
      )
      setCursors(relevant)
    })
  }, [currentFile])

  const updateCursor = useCallback((line: number, column: number) => {
    manager.sendCursorUpdate({ line, column, file: currentFile })
  }, [currentFile])

  const updateSelection = useCallback((startLine: number, startColumn: number, endLine: number, endColumn: number) => {
    manager.sendSelectionUpdate({ startLine, startColumn, endLine, endColumn, file: currentFile })
  }, [currentFile])

  const setTyping = useCallback((isTyping: boolean) => {
    manager.sendTypingIndicator(isTyping)
  }, [])

  return { cursors, updateCursor, updateSelection, setTyping }
}

/** Hook for collaborative editing operations */
export function useCollaborativeEditing(file: string) {
  const sendEdit = useCallback((
    type: 'insert' | 'delete' | 'replace',
    range: EditOperation['range'],
    text?: string
  ) => {
    manager.sendEditOperation({ type, file, range, text })
  }, [file])

  useEffect(() => {
    const handler = (event: CustomEvent<EditOperation>) => {
      if (event.detail.file === file) {
        // Apply remote edit to local editor
        // This will be handled by the editor component
      }
    }
    window.addEventListener('orion:collab-edit', handler as EventListener)
    return () => window.removeEventListener('orion:collab-edit', handler as EventListener)
  }, [file])

  return { sendEdit }
}

/** Hook for presence avatars in the editor */
export function usePresence() {
  const [participants, setParticipants] = useState<CollaboratorInfo[]>([])

  useEffect(() => {
    return manager.subscribe((state) => {
      setParticipants(state.collaborators)
    })
  }, [])

  return participants
}
