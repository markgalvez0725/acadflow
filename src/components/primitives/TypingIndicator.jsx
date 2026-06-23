import React from 'react'

// "X is typing…" with animated dots (Messenger-style). `typers` = [{ id, name }].
export default function TypingIndicator({ typers = [] }) {
  if (!typers.length) return null
  const names = typers.map(t => t.name)
  let label
  if (names.length === 1) label = `${names[0]} is typing`
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing`
  else label = `${names[0]} and ${names.length - 1} others are typing`
  return (
    <div className="typing-indicator" aria-live="polite">
      <span className="typing-dots"><i /><i /><i /></span>
      <span className="typing-label">{label}…</span>
    </div>
  )
}
