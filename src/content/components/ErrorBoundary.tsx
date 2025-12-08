import React, { Component, ErrorInfo, ReactNode } from 'react'
import { createLogger } from '../../lib/core/debug'

const log = createLogger('ErrorBoundary')

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error('ChatOverlay Error Boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '340px',
            padding: '24px',
            background: 'rgba(20, 20, 20, 0.90)',
            backdropFilter: 'blur(20px)',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <h2 style={{ color: '#ef4444', marginBottom: '12px', fontSize: '18px', fontWeight: 'bold' }}>
            Chat Error
          </h2>
          <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px', marginBottom: '16px' }}>
            The chat overlay encountered an error. Try reloading the page.
          </p>
          <details style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Error details</summary>
            <pre style={{
              background: 'rgba(255, 255, 255, 0.1)',
              padding: '8px',
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '200px',
              color: 'rgba(255, 255, 255, 0.6)'
            }}>
              {this.state.error?.toString()}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.90)',
              color: '#1a1a1a',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
