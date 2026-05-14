import React from 'react'

export class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--red)', background: 'var(--red-l)', borderRadius: 'var(--radius)', margin: 8 }}>
          <strong>Something went wrong loading this tab.</strong>
          <pre style={{ marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap', color: 'inherit', opacity: .8 }}>
            {this.state.error?.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-pad">
          <div className="sk sk-stat" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonRows({ count = 5 }) {
  return (
    <div className="sk-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk sk-row" />
      ))}
    </div>
  )
}

export function SkeletonCard({ count = 3 }) {
  return (
    <div className="sk-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk sk-card" />
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div style={{ padding: '8px 0' }}>
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
    <div style={{ padding: '8px 0' }}>
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

export default function SkeletonLoader({ variant = 'rows', count }) {
  if (variant === 'stat-grid') return <SkeletonStatGrid count={count} />
  if (variant === 'card')      return <SkeletonCard count={count} />
  if (variant === 'table')     return <SkeletonTable rows={count} />
  if (variant === 'dashboard') return <SkeletonDashboard />
  return <SkeletonRows count={count} />
}
