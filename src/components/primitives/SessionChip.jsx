import React, { useState, useEffect } from 'react'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // must match AuthContext

function pad(n) {
  return String(n).padStart(2, '0')
}

export default function SessionChip({ name, loginTime, lastLogin }) {
  const [remaining, setRemaining] = useState(SESSION_TIMEOUT_MS)

  useEffect(() => {
    if (!loginTime) return

    function calc() {
      let ts = loginTime
      try {
        const raw = localStorage.getItem('cp_session')
        if (raw) {
          const sess = JSON.parse(raw)
          if (sess?.ts) ts = sess.ts
        }
      } catch (e) {}
      const elapsed = Date.now() - ts
      setRemaining(Math.max(0, SESSION_TIMEOUT_MS - elapsed))
    }

    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [loginTime])

  const totalSecs = Math.floor(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const countdownStr = `${pad(mins)}:${pad(secs)}`

  let dotColor = '#22c55e'
  if (mins < 2) dotColor = '#ef4444'
  else if (mins < 5) dotColor = '#f59e0b'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 20,
      padding: '4px 10px 4px 8px',
      fontSize: 11,
      color: 'var(--ink2)',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 7, height: 7,
        borderRadius: '50%',
        background: dotColor,
        boxShadow: `0 0 6px ${dotColor}`,
        flexShrink: 0,
        display: 'inline-block',
      }} />
      <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 11 }}>{name}</span>
      <span style={{
        fontWeight: 700,
        color: mins < 5 ? dotColor : 'var(--ink3)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 10,
      }}>
        {countdownStr}
      </span>
    </div>
  )
}
