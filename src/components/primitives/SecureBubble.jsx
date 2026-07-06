import React, { useState } from 'react'
import { Lock } from 'lucide-react'

// A "smart-locked" message body: blurred by default, revealed only while the
// reader presses and holds (or focuses + presses Space/Enter). Releasing
// re-hides it. This keeps sensitive content off the screen unless the reader
// deliberately looks, shrinking the window a screenshot or shoulder-surfer can
// capture. Copy / long-press callout are disabled.
//
// `restricted` = a classmate's private note to the professor inside a group
// chat: the bubble acknowledges a message exists, but there is NO reveal and
// the real body is never mounted in this DOM (a fixed placeholder renders
// instead, so length doesn't leak either).
export default function SecureBubble({ text, restricted = false }) {
  const [shown, setShown] = useState(false)
  if (restricted) {
    return (
      <div className="msg-secure restricted" aria-label="Private message - only the professor can read this">
        <span className="msg-secure-text">{'• • • • • •'}</span>
        <span className="msg-secure-hint"><Lock size={11} /> Only the professor can see this</span>
      </div>
    )
  }
  const reveal = () => setShown(true)
  const hide = () => setShown(false)
  return (
    <div
      className={`msg-secure${shown ? ' revealed' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={shown ? 'Private message, revealed' : 'Private message - press and hold to reveal'}
      title={shown ? 'Release to hide' : 'Press and hold to reveal'}
      onPointerDown={reveal}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShown(s => !s) } }}
    >
      <span className="msg-secure-text">{text}</span>
      {!shown && <span className="msg-secure-hint"><Lock size={11} /> Hold to reveal</span>}
    </div>
  )
}
