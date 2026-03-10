import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/store/chat'
import { v4 as uuid } from 'uuid'
import type { ChatMessage } from '@shared/types'

const models = ['Claude Opus', 'GPT-5.3', 'Kimi K2.5', 'Gemini']

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1">
        {message.role === 'user' ? (
          <span className="text-text-secondary text-[10px]">You</span>
        ) : (
          <>
            <span className="text-accent-blue text-[10px]">{message.agentName || 'AI'}</span>
            {message.model && (
              <span className="text-text-muted text-[10px]">via {message.model}</span>
            )}
          </>
        )}
      </div>
      <div className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
        message.role === 'user'
          ? 'bg-bg-secondary rounded-bl-sm'
          : 'bg-accent-blue/5 border border-accent-blue/10 rounded-bl-sm'
      }`}>
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.taskProgress && (
          <div className="bg-bg-primary rounded-md p-2 mt-2 text-[11px]">
            {message.taskProgress.map((task, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={
                  task.status === 'done' ? 'text-accent-green' :
                  task.status === 'working' ? 'text-accent-blue' : 'text-text-muted'
                }>
                  {task.status === 'done' ? '✓' : task.status === 'working' ? '⟳' : '◌'}
                </span>
                <span>{task.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel() {
  const { messages, mode, selectedModel, addMessage, setMode, setModel } = useChatStore()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')

    // Send to OMO
    window.api.omoSend({
      type: 'chat',
      payload: { message: input.trim(), mode, model: selectedModel },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="h-full flex flex-col border-l border-border-primary bg-bg-primary">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-border-primary flex items-center">
        <span className="text-text-primary font-semibold text-sm">✦ AI Chat</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setMode('agent')}
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              mode === 'agent' ? 'bg-accent-green text-white' : 'bg-bg-secondary text-text-secondary'
            }`}
          >
            Agent
          </button>
          <button
            onClick={() => setMode('chat')}
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              mode === 'chat' ? 'bg-accent-blue text-white' : 'bg-bg-secondary text-text-secondary'
            }`}
          >
            Chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 p-3 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted text-xs">
            <p>Ask anything about your code</p>
            <p className="mt-1 text-text-muted/60">Use @file to reference files</p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border-primary">
        <div className="bg-bg-secondary border border-border-primary rounded-xl flex items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (Ctrl+L)"
            rows={1}
            className="flex-1 bg-transparent text-xs text-text-primary px-3.5 py-2.5 resize-none outline-none placeholder:text-text-muted"
          />
          <button
            onClick={handleSend}
            className="text-accent-blue px-3 py-2.5 text-sm hover:text-accent-blue/80"
          >
            ↑
          </button>
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {models.map((model) => (
            <button
              key={model}
              onClick={() => setModel(model)}
              className={`text-[9px] px-2 py-0.5 rounded-full ${
                selectedModel === model
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'bg-bg-secondary text-text-secondary'
              }`}
            >
              {model}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
