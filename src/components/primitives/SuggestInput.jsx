import React, { useState } from 'react'

// ── Suggestion input ─────────────────────────────────────────────────────────
// A text input with a self-managed suggestion popover, replacing the native
// <datalist> pickers. Chrome dismisses a datalist popup whenever the option
// list re-renders under it - and option lists here derive from live state
// (typed drafts, Firestore snapshots), so the native dropdown kept closing
// mid-pick. This popover's open state is owned by React: it opens on focus,
// filters as you type, and closes only on pick, blur, Enter, or Escape.
//
// Props:
//   value / onChange(text)  - controlled text, like a plain input.
//   options: string[]       - suggestions; the exact current text is hidden.
//   onCommit(text)          - fires on blur, Enter, and pick; hook it when a
//                             value should save on settle (the role editor).
//   onEnterEmpty()          - Enter with no highlighted option, after commit;
//                             lets a form keep its "Enter submits" behavior.

export default function SuggestInput({
  value = '', onChange, options = [], placeholder, className = 'input',
  ariaLabel, onCommit, onEnterEmpty, autoFocus = false,
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)

  const q = String(value).trim().toLowerCase()
  const shown = !q ? options : options.filter(o => {
    const k = o.toLowerCase()
    return k.includes(q) && k !== q
  })

  function pick(opt) {
    onChange?.(opt)
    onCommit?.(opt)
    setOpen(false)
    setHi(-1)
  }

  function close(commit) {
    setOpen(false)
    setHi(-1)
    if (commit) onCommit?.(value)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHi(h => Math.min(h + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi(h => Math.max(h - 1, -1))
    } else if (e.key === 'Escape') {
      close(false)
    } else if (e.key === 'Enter') {
      if (open && hi >= 0 && shown[hi]) {
        e.preventDefault()
        pick(shown[hi])
        return
      }
      close(true)
      onEnterEmpty?.()
    }
  }

  return (
    <span className="sug-wrap">
      <input
        className={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-autocomplete="list"
        value={value}
        onChange={e => { onChange?.(e.target.value); setOpen(true); setHi(-1) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => close(true)}
        onKeyDown={onKeyDown}
      />
      {open && shown.length > 0 && (
        <span className="sug-pop" role="listbox">
          {shown.map((o, i) => (
            <button
              key={o.toLowerCase()}
              type="button"
              role="option"
              aria-selected={i === hi}
              tabIndex={-1}
              className={`sug-opt${i === hi ? ' hi' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
