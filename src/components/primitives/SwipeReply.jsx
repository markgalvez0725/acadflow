import React, { useRef, useState } from 'react'
import { Reply } from 'lucide-react'

// Wraps a single message bubble row for the touch swipe-to-reply gesture
// (Messenger-style): swipe the bubble sideways past a threshold to start a quoted
// reply. On desktop, Reply now lives in the per-bubble kebab menu instead of a
// hover button. `side` ('sent' | 'received') sets the swipe direction.
const THRESHOLD = 52
const MAX = 78

export default function SwipeReply({ side = 'received', onReply, children }) {
  const [dx, setDx] = useState(0)
  const [animate, setAnimate] = useState(false)
  const start = useRef({ x: 0, y: 0 })
  const active = useRef(false)
  const fired = useRef(false)
  const dir = side === 'sent' ? -1 : 1 // sent bubbles swipe left, received swipe right

  function down(e) {
    if (e.pointerType !== 'touch') return // swipe is touch-only; mouse uses the hover button
    start.current = { x: e.clientX, y: e.clientY }
    active.current = true; fired.current = false; setAnimate(false)
  }
  function move(e) {
    if (!active.current) return
    const rx = e.clientX - start.current.x
    const ry = e.clientY - start.current.y
    if (Math.abs(ry) > Math.abs(rx)) return // vertical → let the thread scroll
    const d = dir > 0 ? Math.max(0, Math.min(rx, MAX)) : Math.min(0, Math.max(rx, -MAX))
    setDx(d)
    if (!fired.current && Math.abs(d) >= THRESHOLD) {
      fired.current = true
      try { navigator.vibrate && navigator.vibrate(8) } catch (e2) {}
    }
  }
  function end() {
    if (!active.current) return
    active.current = false
    if (fired.current) onReply?.()
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
