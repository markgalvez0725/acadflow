import React from 'react'
import { cn } from '@/utils/cn'

// Single canonical card container. Wraps the existing `.card` surface (frosted
// glass + border + radius) and adds optional header/footer slots.
//
// The key behaviour change: a plain Card does NOT lift on hover. Only a card
// marked `interactive` (one that the user can click) gets the hover lift, so
// the lift reads as "this is clickable" instead of decorating every static
// panel. Pass `as` to render a different element (e.g. "button" / "a") when the
// whole card is the click target.
//
// Props:
//   interactive  enables the hover lift + pointer cursor (use for clickable cards)
//   header       optional node rendered in a bordered header row
//   footer       optional node rendered in a bordered footer row
//   pad          wrap the body in `.card-pad` padding (default true)
//   as           element/component to render as (default 'div')
//   ...props     forwarded to the root element (onClick, role, etc.)
export default function Card({
  interactive = false,
  header,
  footer,
  pad = true,
  as: Tag = 'div',
  className,
  children,
  ...props
}) {
  return (
    <Tag
      className={cn('card', interactive ? 'card--interactive' : 'card--static', className)}
      {...props}
    >
      {header && <div className="card-h">{header}</div>}
      {pad ? <div className="card-pad">{children}</div> : children}
      {footer && <div className="card-f">{footer}</div>}
    </Tag>
  )
}
