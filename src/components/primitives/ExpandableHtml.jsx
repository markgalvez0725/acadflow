import React, { useState, useRef, useLayoutEffect } from 'react'

// Renders pre-sanitized HTML and adds a "See more / See less" control when the
// content is taller than `collapsedHeight`. The caller is responsible for
// sanitizing `html` (e.g. via sanitizeAnnouncementHtml) before passing it in.
export default function ExpandableHtml({ html, className = 'ann-message', collapsedHeight = 140, style }) {
  const ref = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Small tolerance so a post that barely fits doesn't show a pointless toggle.
    setOverflowing(el.scrollHeight > collapsedHeight + 8)
  }, [html, collapsedHeight])

  const collapsed = overflowing && !expanded

  return (
    <div className="expandable-html">
      <div
        ref={ref}
        className={`${className}${collapsed ? ' expandable-html--clamped' : ''}`}
        style={{ ...style, maxHeight: collapsed ? collapsedHeight : 'none' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflowing && (
        <button
          type="button"
          className="expandable-html__toggle"
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}
