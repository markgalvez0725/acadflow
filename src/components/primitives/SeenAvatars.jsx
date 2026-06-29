import React from 'react'

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// "Seen by" read-receipt shown UNDER the last message a user sent. Renders a
// label + a stack of small reader avatars (photo or initials) + a "+N" overflow.
// Used for both the 1:1 case (one recipient) and group chats (many readers).
// `people` = [{ id, name, photo }]. `onClick` makes it open the members modal.
export default function SeenAvatars({ people = [], label = 'Seen by', max = 6, onClick }) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div
      className={`msg-seenby${onClick ? ' tappable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={onClick ? 'See who has seen this' : undefined}
    >
      <span className="msg-seenby-label">{label}</span>
      <div className="msg-seenby-stack">
        {shown.map(p => (
          <span className="msg-seenby-av" key={p.id}>
            {p.photo ? <img src={p.photo} alt="" /> : <span className="ini">{initials(p.name)}</span>}
          </span>
        ))}
      </div>
      {extra > 0 && <span className="msg-seenby-more">+{extra}</span>}
    </div>
  )
}
