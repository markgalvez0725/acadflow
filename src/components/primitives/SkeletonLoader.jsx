import React from 'react'

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

export default function SkeletonLoader({ variant = 'rows', count }) {
  if (variant === 'stat-grid') return <SkeletonStatGrid count={count} />
  if (variant === 'card')      return <SkeletonCard count={count} />
  return <SkeletonRows count={count} />
}
