import React, { useRef, useState } from 'react'
import { Reply } from 'lucide-react'

// Wraps a single message bubble row for two touch gestures (Messenger / Telegram
// style): swipe the bubble sideways past a threshold to start a quoted reply, or
// press-and-hold to open the emoji reaction picker (`onLongPress`). On desktop,
// Reply and React both live in the per-bubble hover affordances instead.
// `side` ('sent' | 'received') sets the swipe direction.
const THRESHOLD = 52
const MAX = 78
const LONG_PRESS_MS = 450
const MOVE_CANCEL = 10 // px of drift that turns a hold into a swipe/scroll

export default function SwipeReply({ side = 'received', onReply, onLongPress, children }) {
  const [dx, setDx] = useState(0)
  const [animate, setAnimate] = useState(false)
  const start = useRef({ x: 0, y: 0 })
  const active = useRef(false)
  const fired = useRef(false)       // swipe-reply threshold reached this gesture
  const longTimer = useRef(null)
  const longFired = useRef(false)   // long-press already fired this gesture
  const dir = side === 'sent' ? -1 : 1 // sent bubbles swipe left, received swipe right

  function clearLong() { if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null } }

  function down(e) {
    if (e.pointerType !== 'touch') return // touch-only; mouse uses the hover affordances
    start.current = { x: e.clientX, y: e.clientY }
    active.current = true; fired.current = false; longFired.current = false; setAnimate(false)
    if (onLongPress) {
      clearLong()
      longTimer.current = setTimeout(() => {
        longTimer.current = null
        longFired.current = true
        active.current = false // cancel any in-progress swipe
        setAnimate(true); setDx(0)
        try { navigator.vibrate && navigator.vibrate(12) } catch (e2) {}
        onLongPress()
      }, LONG_PRESS_MS)
    }
  }
  function move(e) {
    if (!active.current && !longTimer.current) return
    const rx = e.clientX - start.current.x
    const ry = e.clientY - start.current.y
    // Any real movement means a swipe or a scroll, not a hold - cancel the timer.
    if (longTimer.current && (Math.abs(rx) > MOVE_CANCEL || Math.abs(ry) > MOVE_CANCEL)) clearLong()
    if (!active.current) return
    if (Math.abs(ry) > Math.abs(rx)) return // vertical → let the thread scroll
    const d = dir > 0 ? Math.max(0, Math.min(rx, MAX)) : Math.min(0, Math.max(rx, -MAX))
    setDx(d)
    if (!fired.current && Math.abs(d) >= THRESHOLD) {
      fired.current = true
      try { navigator.vibrate && navigator.vibrate(8) } catch (e2) {}
    }
  }
  function end() {
    clearLong()
    if (!active.current) { setDx(0); return } // long-press already consumed this gesture
    active.current = false
    if (fired.current && !longFired.current) onReply?.()
    setAnimate(true); setDx(0)
  }

  return (
    <div
      className="swipe-reply"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onContextMenu={e => { if (onLongPress) e.preventDefault() }}
    >
      <span className={`swipe-reply-cue ${side}`} style={{ opacity: Math.min(1, Math.abs(dx) / THRESHOLD) }} aria-hidden="true">
        <Reply size={16} />
      </span>
      <div style={{ transform: `translateX(${dx}px)`, transition: animate ? 'transform .18s ease' : 'none' }}>
        {children}
      </div>
    </div>
  )
}
