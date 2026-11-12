import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  copied: boolean
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, copied: false }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ errorInfo: info })
    console.error('[Orion ErrorBoundary] Uncaught error:', error)
    console.error('[Orion ErrorBoundary] Component stack:', info.componentStack)
  }

  handleReload = (): void => {
    // Through the main process, which asks about unsaved edits first.
    window.api.reloadWindow()
  }

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false })
  }

  handleCopyError = async (): Promise<void> => {
    const { error, errorInfo } = this.state
    const info = [
      `Orion Error Report`,
      `---`,
      `Error: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || 'No stack trace'}`,
      errorInfo?.componentStack ? `Component Stack: ${errorInfo.componentStack}` : '',
      `---`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `UserAgent: ${navigator.userAgent}`,
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(info)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      // fallback
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            width: '100vw',
            background: 'var(--bg-primary, #0d1117)',
            color: 'var(--text-primary, #e6edf3)',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: '90%',
              padding: '40px 36px',
              background: 'var(--bg-secondary, #161b22)',
              border: '1px solid var(--border, #21262d)',
              borderRadius: 'var(--radius-lg, 12px)',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.5px',
                marginBottom: 20,
                background: 'linear-gradient(135deg, var(--accent, #58a6ff), #a78bfa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Orion
            </div>

            <div
              style={{
                width: 48,
                height: 48,
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: 'rgba(248, 81, 73, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--accent-red, #f85149)',
              }}
              aria-hidden="true"
            >
              !
            </div>

            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Something went wrong
            </h2>

            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary, #8b949e)',
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Orion encountered an unexpected error. You can reload the window, copy the error details for a bug report, or try dismissing this message.
            </p>

            {this.state.error && (
              <pre
                style={{
                  fontSize: 11,
                  color: 'var(--accent-red, #f85149)',
                  background: 'var(--bg-tertiary, #010409)',
                  border: '1px solid var(--border, #21262d)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  padding: 14,
                  marginBottom: 20,
                  textAlign: 'left',
                  overflow: 'auto',
                  maxHeight: 140,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-mono, monospace)',
                  lineHeight: 1.5,
                }}
              >
                {this.state.error.message}
              </pre>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '8px 22px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  background: 'var(--accent, #58a6ff)',
                  border: 'none',
                  borderRadius: 'var(--radius-md, 6px)',
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              >
                Reload Window
              </button>
              <button
                onClick={this.handleCopyError}
                style={{
                  padding: '8px 22px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: this.state.copied ? 'var(--accent, #58a6ff)' : 'var(--text-secondary, #8b949e)',
                  background: 'var(--bg-hover, #1c2128)',
                  border: '1px solid var(--border, #21262d)',
                  borderRadius: 'var(--radius-md, 6px)',
                  cursor: 'pointer',
                  transition: 'color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-hover, #1c2128)' }}
              >
                {this.state.copied ? 'Copied!' : 'Copy Error Info'}
              </button>
              <button
                onClick={this.handleDismiss}
                style={{
                  padding: '8px 22px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary, #8b949e)',
                  background: 'transparent',
                  border: '1px solid var(--border, #21262d)',
                  borderRadius: 'var(--radius-md, 6px)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                Dismiss
              </button>
            </div>

            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--border, #21262d)',
                fontSize: 11,
                color: 'var(--text-muted, #484f58)',
              }}
            >
              <a
                href="https://github.com/nicepkg/orion/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent, #58a6ff)',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Report this issue on GitHub
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
