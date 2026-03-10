export interface OmoBridgeMessage {
  type: 'chat' | 'agent-command' | 'cancel'
  payload: {
    message?: string
    mode?: 'agent' | 'chat'
    model?: string
    projectPath?: string
    files?: string[]
  }
}

export interface OmoEvent {
  type: 'agent-status' | 'agent-log' | 'file-edit' | 'chat-response' | 'task-complete' | 'error' | 'ollama-status'
  payload: unknown
}
