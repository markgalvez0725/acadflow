import React from 'react'

// Consistent empty-state pattern: framed icon, title, supporting line, and an
// optional call-to-action slot. `Icon` is a lucide component.
export default function EmptyState({ Icon, title, text, action }) {
  return (
    <div className="empty-cta">
      {Icon && <div className="ec-ic"><Icon size={26} /></div>}
      {title && <b>{title}</b>}
      {text && <span>{text}</span>}
      {action}
    </div>
  )
}
