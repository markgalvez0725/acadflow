import React from 'react'
import { cn } from '@/utils/cn'

// Consistent empty-state pattern: framed icon, title, supporting line, and an
// optional call-to-action slot. `Icon` is a lucide component. This is the single
// canonical empty state for the whole app - admin and student tabs both render it
// so the look (framed accent circle + title + helper line) never drifts.
//
// Props:
//   Icon     lucide icon component (optional)
//   title    bold headline (names the space, e.g. "No activities yet")
//   text     one supporting line
//   action   optional CTA node (button/link) rendered below the text
//   tone     'accent' (default, framed accent circle) | 'muted' (neutral circle,
//            e.g. "no search results")
//   compact  tighter padding for inline / in-card contexts (charts, small panels)
export default function EmptyState({ Icon, title, text, action, tone = 'accent', compact = false }) {
  return (
    <div className={cn('empty-cta', compact && 'empty-cta--compact')} role="status">
      {Icon && (
        <div className={cn('ec-ic', tone === 'muted' && 'ec-ic--muted')} aria-hidden="true">
          <Icon size={26} />
        </div>
      )}
      {title && <b>{title}</b>}
      {text && <span>{text}</span>}
      {action}
    </div>
  )
}
