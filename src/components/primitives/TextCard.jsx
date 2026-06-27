import React from 'react'

// Instagram-style "text as image" card for a text-only announcement (the
// look of a news org's statement post). Deterministic tint picked from the
// post id so each card is stable but the feed stays varied. Pure presentational.

const TINTS = [
  { bg: 'linear-gradient(160deg,#eef2ff,#e0e7ff)', ink: '#3730a3', sub: '#6366f1' },
  { bg: 'linear-gradient(160deg,#ecfeff,#cffafe)', ink: '#155e75', sub: '#0891b2' },
  { bg: 'linear-gradient(160deg,#fef2f2,#fee2e2)', ink: '#991b1b', sub: '#ef4444' },
  { bg: 'linear-gradient(160deg,#f0fdf4,#dcfce7)', ink: '#166534', sub: '#22c55e' },
  { bg: 'linear-gradient(160deg,#fffbeb,#fef3c7)', ink: '#92400e', sub: '#f59e0b' },
  { bg: 'linear-gradient(160deg,#faf5ff,#f3e8ff)', ink: '#6b21a8', sub: '#a855f7' },
]

function tintFor(seed = '') {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TINTS[Math.abs(h) % TINTS.length]
}

export default function TextCard({ seed, dateLabel, title, body, footer, onClick }) {
  const t = tintFor(seed)
  return (
    <button type="button" className="s-textcard" onClick={onClick} style={{ background: t.bg, color: t.ink }} aria-label={title || 'Open announcement'}>
      <div className="s-textcard-inner">
        {dateLabel && <div className="s-textcard-date" style={{ color: t.sub }}>{dateLabel}</div>}
        {title && <div className="s-textcard-title">{title}</div>}
        {body && <div className="s-textcard-body">{body}</div>}
      </div>
      {footer && <div className="s-textcard-foot" style={{ color: t.sub }}>{footer}</div>}
    </button>
  )
}
