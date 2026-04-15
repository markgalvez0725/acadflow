import React, { useState, useEffect } from 'react'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // must match AuthContext

function formatTs(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return time
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export default function SessionChip({ name, loginTime, lastLogin }) {
  const [remaining, setRemaining] = useState(SESSION_TIMEOUT_MS)

  useEffect(() => {
    if (!loginTime) return

    function calc() {
      // Remaining = timeout - time since last activity update
      // We approximate by reading the stored session ts
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

  let countdownColor = 'var(--ink2)'
  if (mins < 2) countdownColor = '#ef4444'
  else if (mins < 5) countdownColor = '#f59e0b'

  const loginStr   = formatTs(loginTime)
  const lastStr    = lastLogin ? formatTs(lastLogin) : 'First login'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 1,
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '4px 10px',
      fontSize: 10,
      lineHeight: 1.4,
      color: 'var(--ink2)',
      userSelect: 'none',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 11 }}>{name}</span>
        {loginStr && (
          <span style={{ color: 'var(--ink3)' }}>· In: <span style={{ color: 'var(--ink2)' }}>{loginStr}</span></span>
        )}
        <span style={{ color: 'var(--ink3)' }}>· Last: <span style={{ color: 'var(--ink2)' }}>{lastStr}</span></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: countdownColor, flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{ fontWeight: 600, color: countdownColor, fontVariantNumeric: 'tabular-nums' }}>
          {countdownStr} remaining
        </span>
      </div>
    </div>
  )
}
