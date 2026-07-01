import React, { useState, useRef, useEffect } from 'react'
import { SmilePlus, Plus } from 'lucide-react'
import EmojiIcon from '@/components/primitives/EmojiIcon'
import { QUICK_REACTIONS, MORE_REACTIONS, reactionEntries } from '@/utils/reactions'

// The smiley affordance beside a bubble that opens the reaction bar. `active`
// reflects whether this bubble's bar is currently open. The bar itself is
// rendered inline by ReactionBar (below), not anchored to this button.
export function ReactionTrigger({ active, onToggle }) {
  return (
    <button
      type="button"
      className={`msg-react-trigger${active ? ' on' : ''}`}
      onClick={onToggle}
      aria-label="Add reaction"
      aria-expanded={!!active}
    >
      <SmilePlus size={15} />
    </button>
  )
}

// Telegram-style reaction bar, rendered INLINE in the message flow (so it is
// never clipped or out of range): five one-tap reactions plus a "+" that expands
// the full curated grid. `side` ('sent' | 'received') aligns it under the bubble;
// `onPick(emoji)` applies a reaction, `onClose()` dismisses it (outside tap / Esc).
export function ReactionBar({ side = 'received', onPick, onClose }) {
  const [more, setMore] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    // Briefly ignore the first outside event: the finger release that ends a
    // long-press would otherwise dismiss the bar the instant it opens.
    let ignore = true
    const t = setTimeout(() => { ignore = false }, 350)
    const onDown = e => { if (!ignore && wrapRef.current && !wrapRef.current.contains(e.target)) onClose?.() }
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className={`msg-react-bar ${side}`}>
      <div className={`msg-react-bar-inner${more ? ' grid' : ''}`} ref={wrapRef} role="menu">
        {more ? (
          <div className="msg-react-grid">
            {MORE_REACTIONS.map(emoji => (
              <button key={emoji} type="button" className="msg-react-emoji" onClick={() => onPick?.(emoji)} aria-label={`React ${emoji}`}>
                <EmojiIcon emoji={emoji} size={26} />
              </button>
            ))}
          </div>
        ) : (
          <div className="msg-react-quick">
            {QUICK_REACTIONS.map(emoji => (
              <button key={emoji} type="button" className="msg-react-emoji" onClick={() => onPick?.(emoji)} aria-label={`React ${emoji}`}>
                <EmojiIcon emoji={emoji} size={24} />
              </button>
            ))}
            <button type="button" className="msg-react-more-btn" onClick={() => setMore(true)} aria-label="More reactions">
              <Plus size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// The reaction count chips that sit under a bubble. Your own reaction is tinted
// and tapping it removes you; tapping someone else's chip joins it. Renders
// nothing when the bubble has no reactions.
export function ReactionPills({ reactions, myId, side = 'received', onToggle, onView }) {
  // Tap a pill toggles your reaction; a long-press (touch) or right-click
  // (desktop) opens the reaction viewer via onView, without breaking the tap.
  const pressTimer = useRef(null)
  const longFired = useRef(false)
  const entries = reactionEntries(reactions)
  if (!entries.length) return null

  const startPress = e => {
    if (!onView || (e && e.button)) return // primary button / touch only
    longFired.current = false
    clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => { longFired.current = true; onView() }, 450)
  }
  const cancelPress = () => clearTimeout(pressTimer.current)
  const handleClick = emoji => {
    if (longFired.current) { longFired.current = false; return } // the long-press already opened the viewer
    onToggle?.(emoji)
  }

  return (
    <div className={`msg-react-pills ${side}`} onContextMenu={onView ? (e => { e.preventDefault(); onView() }) : undefined}>
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(myId)
        return (
          <button
            key={emoji}
            type="button"
            className={`msg-react-pill${mine ? ' mine' : ''}`}
            onClick={() => handleClick(emoji)}
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            title={onView ? 'Tap to toggle · long-press or right-click to see who reacted' : (mine ? 'Remove your reaction' : 'React')}
          >
            <EmojiIcon emoji={emoji} size={15} />
            <span className="msg-react-count">{ids.length}</span>
          </button>
        )
      })}
    </div>
  )
}
