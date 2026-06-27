import React, { useState, useRef, useLayoutEffect } from 'react'

// Instagram-style "text as image" card for a text-only announcement. Renders
// the SAME sanitized rich-editor HTML (headings, bold, highlight, lists, links,
// tables, code) as the announcement body, with a per-post color accent and a
// date/title header. Collapses tall content behind a "See more" that expands
// inline (no modal). Deterministic accent from the post id keeps the feed varied
// but stable.

const ACCENTS = ['#6366f1', '#0891b2', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']

function accentFor(seed = '') {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return ACCENTS[Math.abs(h) % ACCENTS.length]
}

export default function TextCard({ seed, dateLabel, title, html, footer }) {
  const [open, setOpen] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const scrollRef = useRef(null)
  const accent = accentFor(seed)

  // Measure once in the collapsed state to decide whether "See more" is needed.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && !open) setOverflowing(el.scrollHeight > el.clientHeight + 4)
  }, [html, title, open])

  return (
    <div className="s-textcard" style={{ borderTop: `3px solid ${accent}` }}>
      <div ref={scrollRef} className={`s-textcard-scroll${open ? ' open' : ''}`}>
        {dateLabel && <div className="s-textcard-date" style={{ color: accent }}>{dateLabel}</div>}
        {title && <div className="s-textcard-title">{title}</div>}
        {html && <div className="ann-message s-textcard-body" dangerouslySetInnerHTML={{ __html: html }} />}
        {footer && <div className="s-textcard-foot" style={{ color: accent }}>{footer}</div>}
        {!open && overflowing && <div className="s-textcard-fade" />}
      </div>
      {overflowing && (
        <button type="button" className="s-textcard-more" onClick={() => setOpen(o => !o)}>
          {open ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}
