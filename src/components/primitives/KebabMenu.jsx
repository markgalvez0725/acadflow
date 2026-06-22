import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

const MENU_WIDTH = 180

// Three-dots overflow menu. `items` is an array of { label, onClick, danger }
// (falsy entries are skipped). The dropdown is portaled to <body> with fixed
// positioning so it is never clipped by scroll/overflow containers (e.g. tables).
export default function KebabMenu({ items, label = 'Actions', size = 18 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState(null)
  const btnRef  = useRef(null)
  const menuRef = useRef(null)

  const visible = (items || []).filter(Boolean)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top: r.bottom + 4, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const onMove = () => setOpen(false) // close on scroll/resize (position would go stale)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  if (!visible.length) return null

  return (
    <div className="kebab" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="kebab-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ fontSize: size }}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
      >⋮</button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="kebab-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, right: 'auto', margin: 0, zIndex: 1200 }}
          onClick={e => e.stopPropagation()}
        >
          {visible.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              type="button"
              className={`kebab-item${it.danger ? ' kebab-item--danger' : ''}`}
              onClick={() => { setOpen(false); it.onClick?.() }}
            >{it.label}</button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
