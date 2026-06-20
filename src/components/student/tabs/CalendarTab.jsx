import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { ChevronLeft, ChevronRight, CalendarDays, X, CalendarPlus, ClipboardList, FileQuestion, Megaphone, Clock3 } from 'lucide-react'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import { buildICS, downloadICS } from '@/utils/ics'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const EVENT_COLORS = {
  activity:     { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', text: '#2563eb', label: 'Activity',     Icon: ClipboardList },
  quiz:         { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', text: '#9333ea', label: 'Quiz',         Icon: FileQuestion },
  announcement: { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',  text: '#16a34a', label: 'Announcement', Icon: Megaphone },
}

function toDateKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

const TAB_MAP = { activity: 'activities', quiz: 'quizzes', announcement: 'stream' }

export default function CalendarTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements, fbReady } = useData()
  const { setStudentTab, toast } = useUI()

  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedKey, setSelectedKey] = useState(null)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  const studentClassIds = useMemo(() =>
    student?.classIds?.length ? student.classIds : (student?.classId ? [student.classId] : []),
    [student]
  )

  const eventMap = useMemo(() => {
    const map = {}
    function add(key, ev) {
      if (!map[key]) map[key] = []
      map[key].push(ev)
    }

    activities.forEach(a => {
      if (!a.deadline) return
      if (!studentClassIds.includes(a.classId)) return
      const cls = classes?.find(c => c.id === a.classId)
      const submitted = !!(a.submissions || {})[student?.id]?.link
      const past = Date.now() > a.deadline
      add(toDateKey(a.deadline), {
        type: 'activity', id: a.id,
        title: a.title || 'Activity',
        subtitle: cls?.name || '',
        ts: a.deadline,
        submitted, past,
      })
    })

    quizzes.forEach(q => {
      if (!q.closeAt) return
      if (!q.classIds?.some(id => studentClassIds.includes(id))) return
      const taken = !!(q.submissions || {})[student?.id]
      const past = Date.now() > q.closeAt
      add(toDateKey(q.closeAt), {
        type: 'quiz', id: q.id,
        title: q.title || 'Quiz',
        subtitle: '',
        ts: q.closeAt,
        taken, past,
      })
    })

    announcements.forEach(a => {
      const ts = a.scheduledAt || a.createdAt
      if (!ts) return
      const isForStudent = !a.classId || studentClassIds.includes(a.classId)
      if (!isForStudent) return
      const cls = a.classId ? classes?.find(c => c.id === a.classId) : null
      add(toDateKey(ts), {
        type: 'announcement', id: a.id,
        title: a.title || 'Announcement',
        subtitle: cls?.name || 'All Classes',
        ts,
      })
    })

    return map
  }, [activities, quizzes, announcements, studentClassIds, student?.id, classes])

  const { days, startOffset } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return { days: daysInMonth, startOffset: firstDay }
  }, [year, month])

  const todayKey = toDateKey(today.getTime())
  const selectedEvents = selectedKey ? (eventMap[selectedKey] || []) : []

  const monthEventCount = useMemo(() => {
    let count = 0
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${month}-${d}`
      count += (eventMap[key] || []).length
    }
    return count
  }, [eventMap, year, month, days])

  const monthTypeCounts = useMemo(() => {
    const counts = { activity: 0, quiz: 0, announcement: 0 }
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${month}-${d}`
      ;(eventMap[key] || []).forEach(ev => {
        counts[ev.type] = (counts[ev.type] || 0) + 1
      })
    }
    return counts
  }, [eventMap, year, month, days])

  const upcomingEvents = useMemo(() => {
    const now = Date.now()
    return Object.values(eventMap)
      .flat()
      .filter(ev => ev.ts >= now)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 5)
  }, [eventMap])

  // total grid cells, padded to complete final week row
  const totalCells = startOffset + days
  const trailingCells = (7 - (totalCells % 7)) % 7

  function exportCalendar() {
    const all = Object.values(eventMap).flat().sort((a, b) => a.ts - b.ts)
    if (!all.length) { toast?.('No events to export yet.', 'info'); return }
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const icsEvents = all.map(ev => {
      const label = EVENT_COLORS[ev.type]?.label || 'Event'
      return {
        uid: `${ev.type}-${ev.id}`,
        title: `[${label}] ${ev.title}`,
        description: [ev.subtitle, ev.type === 'activity' ? 'Activity deadline' : ev.type === 'quiz' ? 'Quiz closes' : 'Announcement']
          .filter(Boolean).join(' - '),
        start: ev.ts,
        url: origin,
      }
    })
    downloadICS('acadflow-calendar', buildICS(icsEvents, 'AcadFlow Calendar'))
    toast?.(`Exported ${icsEvents.length} event${icsEvents.length !== 1 ? 's' : ''} to your calendar.`, 'success')
  }

  if (!fbReady) return <SkeletonRows />

  return (
    <div className="space-y-4 pb-4">
      {/* Hero header */}
      <div
        className="card"
        style={{
          padding: 18,
          background: 'linear-gradient(135deg, var(--accent-l), transparent 70%)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent)', color: '#fff', flexShrink: 0 }}
            >
              <CalendarDays size={20} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Study Timeline</div>
              <h3 className="text-base font-bold text-ink mt-0.5">Your Calendar</h3>
              <p className="text-xs text-ink2 mt-0.5">See due dates, quiz closings, and important announcements in one place.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}>
              {monthEventCount} this month
            </span>
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}>
              {upcomingEvents.length} upcoming
            </span>
            <button
              onClick={exportCalendar}
              className="btn btn-secondary text-xs"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
              title="Download an .ics file to subscribe in Google / Apple / Outlook Calendar"
            >
              <CalendarPlus size={14} />
              Add to Calendar
            </button>
          </div>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.entries(EVENT_COLORS).map(([type, color]) => {
          const Icon = color.Icon
          return (
            <div
              key={type}
              className="card flex items-center gap-3"
              style={{ padding: 14, borderLeft: `3px solid ${color.dot}` }}
            >
              <div
                className="flex items-center justify-center"
                style={{ width: 38, height: 38, borderRadius: 10, background: color.bg, color: color.text, flexShrink: 0 }}
              >
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink3">{color.label}</div>
                <div className="text-xl font-bold text-ink leading-tight">{monthTypeCounts[type] || 0}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Calendar card: header + grid in one surface */}
      <div className="card overflow-hidden p-0" style={{ border: '1px solid var(--border)' }}>
        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1">
            <button className="icon-btn" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span className="font-bold text-ink text-base min-w-[150px] text-center select-none">
              {MONTHS[month]} {year}
            </span>
            <button className="icon-btn" onClick={nextMonth} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
            <button
              className="link-btn text-xs ml-2"
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedKey(null) }}
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-3">
            {Object.entries(EVENT_COLORS).map(([type, { dot, label }]) => (
              <span key={type} className="flex items-center gap-1.5 text-xs text-ink2">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          {DAYS.map((d, i) => (
            <div
              key={d}
              className="text-center text-[11px] font-semibold py-2.5 uppercase tracking-[0.06em]"
              style={{ color: i === 0 || i === 6 ? 'var(--ink3)' : 'var(--ink2)' }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div
              key={'e' + i}
              className="min-h-[72px]"
              style={{ background: 'var(--surface2)', borderRight: (startOffset + i + 1) % 7 === 0 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
            />
          ))}

          {Array.from({ length: days }).map((_, i) => {
            const dayNum = i + 1
            const cellIndex = startOffset + i
            const col = cellIndex % 7
            const isWeekend = col === 0 || col === 6
            const key = `${year}-${month}-${dayNum}`
            const events = eventMap[key] || []
            const isToday = key === todayKey
            const isSelected = key === selectedKey

            return (
              <div
                key={key}
                className="min-h-[72px] p-1 cursor-pointer transition-colors"
                style={{
                  borderRight: col === 6 ? 'none' : '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  background: isSelected
                    ? 'var(--accent-l)'
                    : isWeekend ? 'color-mix(in srgb, var(--surface2) 55%, transparent)' : 'transparent',
                  boxShadow: isSelected ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = isWeekend
                    ? 'color-mix(in srgb, var(--surface2) 55%, transparent)'
                    : 'transparent'
                }}
                onClick={() => setSelectedKey(isSelected ? null : key)}
              >
                <div
                  className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-0.5"
                  style={
                    isToday
                      ? { background: 'var(--accent)', color: '#fff' }
                      : isSelected
                        ? { color: 'var(--accent)' }
                        : { color: 'var(--ink)' }
                  }
                >
                  {dayNum}
                </div>
                <div className="space-y-1">
                  {events.slice(0, 2).map((ev, idx) => {
                    const c = EVENT_COLORS[ev.type]
                    return (
                      <div
                        key={ev.id + idx}
                        className="truncate text-[10px] rounded px-1.5 py-0.5 leading-tight font-medium flex items-center gap-1"
                        style={{ background: c?.bg, color: c?.text }}
                        title={ev.title}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: c?.dot, flexShrink: 0 }} />
                        <span className="truncate">{ev.title}</span>
                      </div>
                    )
                  })}
                  {events.length > 2 && (
                    <div className="text-[10px] text-ink3 pl-1 font-medium">+{events.length - 2}</div>
                  )}
                </div>
              </div>
            )
          })}

          {Array.from({ length: trailingCells }).map((_, i) => (
            <div
              key={'t' + i}
              className="min-h-[72px]"
              style={{ background: 'var(--surface2)', borderRight: (startOffset + days + i + 1) % 7 === 0 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
            />
          ))}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedKey && (
        <div className="card p-4" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-ink text-sm flex items-center gap-2">
              <CalendarDays size={15} className="text-accent" />
              {fmtDate(selectedKey)}
            </h4>
            <button
              className="icon-btn text-ink3 hover:text-ink"
              onClick={() => setSelectedKey(null)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-ink3 text-sm text-center py-4">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev, idx) => {
                const color = EVENT_COLORS[ev.type]
                const statusLabel =
                  ev.type === 'activity' ? (ev.submitted ? 'Submitted' : ev.past ? 'Past due' : 'Open') :
                  ev.type === 'quiz'     ? (ev.taken ? 'Taken' : ev.past ? 'Closed' : 'Open') :
                  null

                const statusStyle =
                  statusLabel === 'Submitted' || statusLabel === 'Taken'
                    ? { bg: 'rgba(34,197,94,0.12)', text: '#15803d' }
                  : statusLabel === 'Past due' || statusLabel === 'Closed'
                    ? { bg: 'rgba(239,68,68,0.12)', text: '#dc2626' }
                  : statusLabel === 'Open'
                    ? { bg: 'rgba(59,130,246,0.12)', text: '#2563eb' }
                  : null

                return (
                  <div
                    key={ev.id + idx}
                    className="flex items-center gap-3 p-3 rounded-lg"
                    style={{ border: '1px solid var(--border)', borderLeftWidth: 3, borderLeftColor: color.dot }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-ink">{ev.title}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize"
                          style={{ background: color.bg, color: color.text }}
                        >
                          {color.label}
                        </span>
                        {statusLabel && statusStyle && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: statusStyle.bg, color: statusStyle.text }}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {ev.subtitle && <span className="text-xs text-ink2">{ev.subtitle}</span>}
                        <span className="text-xs text-ink3">{fmtTime(ev.ts)}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary text-xs py-1 px-3 flex-shrink-0"
                      onClick={() => { setStudentTab(TAB_MAP[ev.type] || 'overview'); setSelectedKey(null) }}
                    >
                      View →
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Upcoming agenda */}
      <div className="card p-4" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-ink text-sm flex items-center gap-2">
            <Clock3 size={15} className="text-accent" /> Upcoming Agenda
          </h4>
          <span className="text-xs text-ink3">Next 5 events</span>
        </div>
        {upcomingEvents.length === 0 ? (
          <p className="text-ink3 text-sm text-center py-2">No upcoming events yet.</p>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map((ev, idx) => {
              const color = EVENT_COLORS[ev.type]
              const Icon = color.Icon
              return (
                <div
                  key={ev.id + idx}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ border: '1px solid var(--border)', borderLeftWidth: 3, borderLeftColor: color.dot }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 32, height: 32, borderRadius: 9, background: color.bg, color: color.text, flexShrink: 0 }}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink truncate">{ev.title}</div>
                    <div className="text-xs text-ink2 truncate">{ev.subtitle || color.label}</div>
                  </div>
                  <span className="text-xs text-ink3 whitespace-nowrap">{new Date(ev.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
