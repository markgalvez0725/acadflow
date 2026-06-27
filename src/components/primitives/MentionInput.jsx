import React, { useRef, useState } from 'react'
import { findMentionQuery, applyMention, matchCandidates } from '@/utils/mentions'
import { courseShort } from '@/constants/courses'

// A text input with an @mention autocomplete dropdown. Controlled via
// value/onChange; calls onEnter when Enter is pressed (and no suggestion is
// being chosen). candidates: [{ id, name, photo? }].
//   multiline - render a <textarea> (Enter sends, Shift+Enter = newline)
//   onType    - fired on every change (e.g. typing-presence) after onChange
//   onBlur    - extra blur handler (the dropdown still closes on its own)
export default function MentionInput({
  value, onChange, onEnter, candidates = [],
  placeholder, disabled, className = 'form-input', style, inputRef: extRef,
  multiline = false, rows = 1, onType, onBlur: extBlur,
}) {
  const innerRef = useRef(null)
  const ref = extRef || innerRef
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const q = open ? findMentionQuery(value || '', caret) : null
  const suggestions = q ? matchCandidates(q.query, candidates) : []
  const showList = !!q && suggestions.length > 0

  function syncCaret(e) {
    const pos = e.target.selectionStart ?? (value || '').length
    setCaret(pos)
    setOpen(true)
  }

  function choose(cand) {
    const { text, caret: nextCaret } = applyMention(value || '', caret, cand.name)
    onChange(text)
    setOpen(false)
    setActive(0)
    // Restore focus + caret after the controlled update.
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus()
        try { ref.current.setSelectionRange(nextCaret, nextCaret) } catch (e) { /* ignore */ }
        setCaret(nextCaret)
      }
    })
  }

  function onKeyDown(e) {
    if (showList) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggestions[active]); return }
      if (e.key === 'Escape')    { e.preventDefault(); setOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter?.() }
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {showList && (
        <div
          role="listbox"
          style={{
            position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.15))',
            zIndex: 50, overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
          }}
        >
          {suggestions.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); choose(c) }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: i === active ? 'var(--surface2)' : 'transparent',
                color: 'var(--ink)', fontSize: 13,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                background: 'var(--accent-l)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
              }}>{c.photo
                ? <img src={c.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (c.name?.charAt(0)?.toUpperCase() || '?')}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{courseShort(c.name)}</span>
            </button>
          ))}
        </div>
      )}
      {React.createElement(multiline ? 'textarea' : 'input', {
        ref,
        className,
        rows: multiline ? rows : undefined,
        style: { width: '100%', ...style },
        placeholder,
        value,
        disabled,
        onChange: e => { onChange(e.target.value); setCaret(e.target.selectionStart ?? 0); setOpen(true); onType?.() },
        onKeyDown,
        onKeyUp: syncCaret,
        onClick: syncCaret,
        onBlur: e => { setTimeout(() => setOpen(false), 120); extBlur?.(e) },
      })}
    </div>
  )
}
