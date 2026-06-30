import React, { useState, useRef, useEffect } from 'react'
import { SmilePlus, Plus } from 'lucide-react'
import EmojiIcon from '@/components/primitives/EmojiIcon'
import { QUICK_REACTIONS, MORE_REACTIONS, reactionEntries } from '@/utils/reactions'

// Telegram-style reaction picker: a smiley trigger that opens a quick bar of six
// one-tap reactions, with a "+" that expands the full curated grid. `side`
// ('sent' | 'received') anchors the popover to the bubble's edge; `onPick(emoji)`
// applies the chosen reaction. Reused by both the student and professor threads.
//
// Open state is optionally controlled (`open` + `onOpenChange`) so a long-press on
// the bubble can open the SAME popover; left uncontrolled, the smiley trigger
// drives it on its own.
export function ReactionPicker({ side = 'received', onPick, open, onOpenChange }) {
  const controlled = open !== undefined
  const [openS, setOpenS] = useState(false)
  const isOpen = controlled ? open : openS
  const [more, setMore] = useState(false)
  const wrapRef = useRef(null)

  function setOpen(v) { if (controlled) onOpenChange?.(v); else setOpenS(v) }
  function close() { setOpen(false); setMore(false) }
  function pick(emoji) { onPick?.(emoji); close() }

  // Collapse the "more" grid whenever the popover closes.
  useEffect(() => { if (!isOpen) setMore(false) }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    // Briefly ignore the first outside event: a long-press releases its finger
    // right after opening, and that touchend/synthetic-mousedown would otherwise
    // close the popover the same instant it appeared.
    let ignore = true
    const t = setTimeout(() => { ignore = false }, 350)
    const onDown = e => { if (ignore) return; if (wrapRef.current && !wrapRef.current.contains(e.target)) close() }
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [isOpen])

  return (
    <span className="msg-react-wrap" ref={wrapRef}>
      <button
        type="button"
        className="msg-react-trigger"
        onClick={() => (isOpen ? close() : setOpen(true))}
        aria-label="Add reaction"
        aria-expanded={isOpen}
      >
        <SmilePlus size={15} />
      </button>
      {isOpen && (
        <div className={`msg-react-pop ${side}${more ? ' more' : ''}`} role="menu">
          {more ? (
            <div className="msg-react-grid">
              {MORE_REACTIONS.map(emoji => (
                <button key={emoji} type="button" className="msg-react-emoji" onClick={() => pick(emoji)} aria-label={`React ${emoji}`}>
                  <EmojiIcon emoji={emoji} size={26} />
                </button>
              ))}
            </div>
          ) : (
            <div className="msg-react-quick">
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} type="button" className="msg-react-emoji" onClick={() => pick(emoji)} aria-label={`React ${emoji}`}>
                  <EmojiIcon emoji={emoji} size={23} />
                </button>
              ))}
              <button type="button" className="msg-react-more-btn" onClick={() => setMore(true)} aria-label="More reactions">
                <Plus size={15} />
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

// The reaction count chips that sit under a bubble. Your own reaction is tinted
// and tapping it removes you; tapping someone else's chip joins it. Renders
// nothing when the bubble has no reactions.
export function ReactionPills({ reactions, myId, side = 'received', onToggle }) {
  const entries = reactionEntries(reactions)
  if (!entries.length) return null
  return (
    <div className={`msg-react-pills ${side}`}>
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(myId)
        return (
          <button
            key={emoji}
            type="button"
            className={`msg-react-pill${mine ? ' mine' : ''}`}
            onClick={() => onToggle?.(emoji)}
            title={mine ? 'Remove your reaction' : 'React'}
          >
            <EmojiIcon emoji={emoji} size={15} />
            <span className="msg-react-count">{ids.length}</span>
          </button>
        )
      })}
    </div>
  )
}
