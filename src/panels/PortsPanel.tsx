/**
 * Ports Panel — lists forwarded ports and network listeners.
 * Similar to VS Code's "Ports" tab in the bottom panel.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Globe, Plus, X, RefreshCw, ExternalLink, Copy, Check,
  Lock, Unlock, Eye, EyeOff, Wifi, WifiOff,
} from 'lucide-react'

interface ForwardedPort {
  id: string
  port: number
  label: string
  protocol: 'http' | 'https' | 'tcp'
  status: 'active' | 'inactive' | 'error'
  visibility: 'private' | 'public'
  source: 'auto' | 'user' | 'process'
  pid?: number
  processName?: string
  localAddress?: string
  remoteUrl?: string
  forwarded: boolean
}

const DEMO_PORTS: ForwardedPort[] = [
  {
    id: 'p-1',
    port: 3000,
    label: 'Dev Server',
    protocol: 'http',
    status: 'active',
    visibility: 'private',
    source: 'auto',
    pid: 12345,
    processName: 'node',
    localAddress: 'localhost:3000',
    forwarded: false,
  },
  {
    id: 'p-2',
    port: 5173,
    label: 'Vite HMR',
    protocol: 'http',
    status: 'active',
    visibility: 'private',
    source: 'auto',
    pid: 12346,
    processName: 'vite',
    localAddress: 'localhost:5173',
    forwarded: false,
  },
  {
    id: 'p-3',
    port: 8080,
    label: 'API Server',
    protocol: 'http',
    status: 'inactive',
    visibility: 'private',
    source: 'user',
    forwarded: false,
  },
]

export default function PortsPanel() {
  const [ports, setPorts] = useState<ForwardedPort[]>(DEMO_PORTS)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newPort, setNewPort] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    // In real implementation, query node-pty / electron for listening ports
    setTimeout(() => setIsRefreshing(false), 500)
  }, [])

  const addPort = () => {
    const portNum = parseInt(newPort)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) return
    setPorts(prev => [...prev, {
      id: `p-${Date.now()}`,
      port: portNum,
      label: newLabel || `Port ${portNum}`,
      protocol: 'http',
      status: 'inactive',
      visibility: 'private',
      source: 'user',
      forwarded: false,
    }])
    setNewPort('')
    setNewLabel('')
    setShowAddDialog(false)
  }

  const removePort = (id: string) => {
    setPorts(prev => prev.filter(p => p.id !== id))
  }

  const toggleVisibility = (id: string) => {
    setPorts(prev => prev.map(p =>
      p.id === id ? { ...p, visibility: p.visibility === 'private' ? 'public' : 'private' } : p
    ))
  }

  const toggleForward = (id: string) => {
    setPorts(prev => prev.map(p =>
      p.id === id ? { ...p, forwarded: !p.forwarded } : p
    ))
  }

  const copyUrl = (port: ForwardedPort) => {
    const url = `${port.protocol}://localhost:${port.port}`
    navigator.clipboard.writeText(url)
    setCopiedId(port.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const openInBrowser = (port: ForwardedPort) => {
    const url = `${port.protocol}://localhost:${port.port}`
    window.open(url, '_blank')
  }

  const statusColor = (s: ForwardedPort['status']) => {
    switch (s) {
      case 'active': return '#3fb950'
      case 'inactive': return '#8b949e'
      case 'error': return '#f85149'
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}>
        <button
          onClick={() => setShowAddDialog(!showAddDialog)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4,
          }}
          title="Forward a Port"
        >
          <Plus size={14} /> Forward a Port
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={refresh}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 2, display: 'flex',
          }}
          title="Refresh"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Add port dialog */}
      {showAddDialog && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={newPort}
            onChange={(e) => setNewPort(e.target.value)}
            placeholder="Port number"
            type="number"
            style={{
              width: 80, padding: '4px 8px', background: 'var(--bg-primary)',
              border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)',
              fontSize: 12, outline: 'none',
            }}
            onKeyDown={(e) => e.key === 'Enter' && addPort()}
            autoFocus
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (optional)"
            style={{
              flex: 1, padding: '4px 8px', background: 'var(--bg-primary)',
              border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)',
              fontSize: 12, outline: 'none',
            }}
            onKeyDown={(e) => e.key === 'Enter' && addPort()}
          />
          <button onClick={addPort} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
            Add
          </button>
          <button onClick={() => setShowAddDialog(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Table header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '40px 60px 1fr 80px 70px 60px 100px',
        padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
        borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <span></span>
        <span>Port</span>
        <span>Label</span>
        <span>Process</span>
        <span>Status</span>
        <span>Visibility</span>
        <span>Actions</span>
      </div>

      {/* Port rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ports.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <Wifi size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <div>No forwarded ports</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Click "Forward a Port" to get started</div>
          </div>
        ) : (
          ports.map((port) => (
            <div
              key={port.id}
              style={{
                display: 'grid', gridTemplateColumns: '40px 60px 1fr 80px 70px 60px 100px',
                padding: '6px 8px', fontSize: 12, alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {/* Forwarded indicator */}
              <span style={{ display: 'flex', justifyContent: 'center' }}>
                {port.forwarded ? (
                  <Globe size={14} style={{ color: 'var(--accent)' }} />
                ) : (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(port.status) }} />
                )}
              </span>

              {/* Port number */}
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600 }}>
                {port.port}
              </span>

              {/* Label */}
              <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {port.label}
              </span>

              {/* Process */}
              <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                {port.processName || '—'}
              </span>

              {/* Status */}
              <span style={{ color: statusColor(port.status), fontSize: 11, fontWeight: 500 }}>
                {port.status}
              </span>

              {/* Visibility */}
              <button
                onClick={() => toggleVisibility(port.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: port.visibility === 'public' ? 'var(--accent-orange)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 2, fontSize: 11,
                }}
                title={port.visibility === 'public' ? 'Make Private' : 'Make Public'}
              >
                {port.visibility === 'public' ? <Unlock size={12} /> : <Lock size={12} />}
                {port.visibility}
              </button>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  onClick={() => openInBrowser(port)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
                  title="Open in Browser"
                >
                  <ExternalLink size={13} />
                </button>
                <button
                  onClick={() => copyUrl(port)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
                  title="Copy URL"
                >
                  {copiedId === port.id ? <Check size={13} color="#3fb950" /> : <Copy size={13} />}
                </button>
                <button
                  onClick={() => toggleForward(port.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: port.forwarded ? 'var(--accent)' : 'var(--text-muted)' }}
                  title={port.forwarded ? 'Stop Forwarding' : 'Start Forwarding'}
                >
                  {port.forwarded ? <WifiOff size={13} /> : <Wifi size={13} />}
                </button>
                {port.source === 'user' && (
                  <button
                    onClick={() => removePort(port.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
