import React from 'react'
import { AlertTriangle } from 'lucide-react'
import ErrorState from '@/components/ds/ErrorState'

export class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('[AcadFlow] Tab error:', error, info?.componentStack)
  }
  render() {
    if (this.state.error) {
      const isDev = !!(import.meta.env && import.meta.env.DEV)
      // A tab-level render crash: the design-system stylesheet is intact here
      // (only the app-level ErrorBoundary must avoid CSS classes), so reuse the
      // shared ErrorState for a consistent framed-icon look + retry.
      return (
        <div>
          <ErrorState
            Icon={AlertTriangle}
            title="Something went wrong loading this tab"
            text="An unexpected error occurred. Try again, or switch tabs and come back."
            onRetry={() => this.setState({ error: null })}
          />
          {isDev && (
            <pre style={{ margin: '0 16px', fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--ink3)', opacity: .8 }}>
              {this.state.error?.message}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

export function SkeletonRows({ count = 5 }) {
  return (
    <div className="sk-wrap" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk sk-row" />
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div style={{ padding: '8px 0' }} role="status" aria-busy="true" aria-label="Loading">
      {/* thead placeholder */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="sk" style={{ height: 28, flex: i === 0 ? 2 : 1, borderRadius: 6 }} />
        ))}
      </div>
      {/* tbody rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="sk" style={{ height: 40, flex: j === 0 ? 2 : 1, borderRadius: 8 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div style={{ padding: '8px 0' }} role="status" aria-busy="true" aria-label="Loading">
      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sk sk-stat" />
        ))}
      </div>
      {/* Bar chart placeholder */}
      <div className="sk-bar-wrap" style={{ marginBottom: 20 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="sk-bar" style={{ height: `${40 + i * 14}px` }} />
        ))}
      </div>
      {/* Table rows */}
      <SkeletonTable rows={4} cols={4} />
    </div>
  )
}
