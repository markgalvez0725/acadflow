import React, { useState, useEffect, useMemo } from 'react'

/**
 * SemesterCalendarChip
 * A modern navbar badge showing:
 *  – A mini calendar icon with the current day number
 *  – The semester label (e.g. "1st Semester AY 2026-2027")
 *  – Days remaining / elapsed info when start/end dates are set
 */
export default function SemesterCalendarChip({ semester, className = '' }) {
  const [now, setNow] = useState(() => new Date())

  // Refresh once per minute so the day stays accurate
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const label = semester
    ? semester.label || `${semester.term} AY ${semester.year}`
    : null

  const dayNum   = now.getDate()
  const monthAbb = now.toLocaleString('default', { month: 'short' }).toUpperCase()

  const daysDetail = useMemo(() => {
    if (!semester) return null
    const status = semester.status

    if (status === 'active' && semester.endDate) {
      const end    = new Date(semester.endDate)
      end.setHours(23, 59, 59, 999)
      const diff = Math.ceil((end - now) / 86_400_000)
      if (diff > 1)  return `${diff} days left`
      if (diff === 1) return '1 day left'
      if (diff === 0) return 'Last day'
    }

    if (status === 'upcoming' && semester.startDate) {
      const start = new Date(semester.startDate)
      const diff  = Math.ceil((start - now) / 86_400_000)
      if (diff > 0) return `starts in ${diff}d`
    }

    return null
  }, [semester, now])

  if (!semester || !label) return null

  const isActive   = semester.status === 'active'
  const isUpcoming = semester.status === 'upcoming'

  // Colour tokens
  const chipCls = isActive
    ? 'bg-[var(--accent-l)] text-[var(--accent)]'
    : isUpcoming
    ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-[var(--surface2)] text-[var(--ink3)]'

  return (
    <div
      className={`hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold select-none ${chipCls} ${className}`}
      title={`Semester: ${label}${daysDetail ? ` · ${daysDetail}` : ''}`}
    >
      {/* ── Mini calendar icon ── */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
          border: '1.5px solid currentColor',
          overflow: 'hidden',
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        {/* Month strip */}
        <span
          style={{
            width: '100%',
            textAlign: 'center',
            fontSize: 5,
            fontWeight: 800,
            letterSpacing: '0.03em',
            background: 'currentColor',
            color: '#fff',
            paddingTop: 1,
            paddingBottom: 1,
          }}
        >
          {monthAbb}
        </span>
        {/* Day number */}
        <span
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 8,
            fontWeight: 700,
          }}
        >
          {dayNum}
        </span>
      </span>

      {/* ── Semester label ── */}
      <span>{label}</span>

      {/* ── Days detail ── */}
      {daysDetail && (
        <span style={{ opacity: 0.65, fontSize: '0.65rem', fontWeight: 600 }}>
          · {daysDetail}
        </span>
      )}
    </div>
  )
}
