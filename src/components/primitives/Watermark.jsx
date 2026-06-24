import React, { useMemo } from 'react'

// A faint, tiled, diagonal watermark drawn over sensitive content (message
// threads). It carries the viewer's identity so any screenshot — including ones
// the app cannot detect (iOS/Android) — is traceable back to the student. It is
// purely decorative and never intercepts pointer events.
export default function Watermark({ label, rows = 14, cols = 6 }) {
  const text = (label || '').trim()
  const grid = useMemo(() => Array.from({ length: rows }), [rows])
  const line = useMemo(() => Array.from({ length: cols }), [cols])
  if (!text) return null
  return (
    <div className="msg-watermark" aria-hidden="true">
      {grid.map((_, i) => (
        <div className="msg-watermark-row" key={i}>
          {line.map((__, j) => <span key={j}>{text}</span>)}
        </div>
      ))}
    </div>
  )
}
