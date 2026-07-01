import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import {
  ChevronLeft, ChevronRight, CalendarDays, X, CalendarPlus, ClipboardList, FileQuestion,
  Megaphone, Clock3, ShieldCheck, AlertTriangle, ArrowRight, CalendarClock, CalendarCheck,
} from 'lucide-react'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import { buildICS, downloadICS } from '@/utils/ics'
import { activeClassIds } from '@/utils/active'
import { annReaches, annClassIds } from '@/utils/announce'

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

// Relative-day label for the Schedule Watch validator.
function relDay(ts, now) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0)
  const d1 = new Date(ts); d1.setHours(0, 0, 0, 0)
  const diff = Math.round((d1 - d0) / 86400000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return `in ${diff} days`
}

function shortDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const TAB_MAP = { activity: 'activities', quiz: 'quizzes', announcement: 'stream' }

export default function CalendarTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements, fbReady, semester } = useData()
  const { setStudentTab, toast, navigateToTarget } = useUI()

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

  const studentClassIds = useMemo(
    () => activeClassIds(student, classes, semester),
    [student, classes, semester]
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
        type: 'activity', id: a.id, classId: a.classId,
        title: a.title || 'Activity',
        subtitle: cls?.name || '',
        ts: a.deadline,
        submitted, past,
      })
    })

    quizzes.forEach(q => {
      if (q.status === 'draft') return
      if (!q.closeAt) return
      if (!q.classIds?.some(id => studentClassIds.includes(id))) return
      const taken = !!(q.submissions || {})[student?.id]
      const past = Date.now() > q.closeAt
      add(toDateKey(q.closeAt), {
        type: 'quiz', id: q.id, classId: q.classIds?.find(id => studentClassIds.includes(id)) || null,
        title: q.title || 'Quiz',
        subtitle: '',
        ts: q.closeAt,
        taken, past,
      })
    })

    announcements.forEach(a => {
      const ts = a.scheduledAt || a.createdAt
      if (!ts) return
      if (!annReaches(a, studentClassIds)) return
      const myId = annClassIds(a).find(id => studentClassIds.includes(id))
      const cls = myId ? classes?.find(c => c.id === myId) : null
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
    for (let d = 1; d <= days; d++) count += (eventMap[`${year}-${month}-${d}`] || []).length
    return count
  }, [eventMap, year, month, days])

  const monthTypeCounts = useMemo(() => {
    const counts = { activity: 0, quiz: 0, announcement: 0 }
    for (let d = 1; d <= days; d++) {
      ;(eventMap[`${year}-${month}-${d}`] || []).forEach(ev => { counts[ev.type] = (counts[ev.type] || 0) + 1 })
    }
    return counts
  }, [eventMap, year, month, days])

  const upcomingEvents = useMemo(() => {
    const now = Date.now()
    return Object.values(eventMap).flat().filter(ev => ev.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 5)
  }, [eventMap])

  // Deterministic "Schedule Watch" - past-due, next-up, busy days in the next 7
  // days. Recomputed from the same event map the grid renders. no network calls.
  const watch = useMemo(() => {
    const now = Date.now()
    const horizon = now + 7 * 86400000
    const all = Object.values(eventMap).flat()
    const pastDue = all
      .filter(ev => (ev.type === 'activity' && ev.past && !ev.submitted) || (ev.type === 'quiz' && ev.past && !ev.taken))
      .filter(ev => now - ev.ts <= 30 * 86400000)
      .sort((a, b) => b.ts - a.ts)
    const weekAhead = all.filter(ev => ev.ts >= now && ev.ts <= horizon).sort((a, b) => a.ts - b.ts)
    const next = all.filter(ev => ev.ts >= now).sort((a, b) => a.ts - b.ts)[0]
    const byDay = {}
    weekAhead.forEach(ev => { const k = toDateKey(ev.ts); (byDay[k] ||= []).push(ev) })
    let busy = null
    Object.entries(byDay).forEach(([k, evs]) => { if (evs.length >= 2 && (!busy || evs.length > busy.n)) busy = { k, n: evs.length } })

    const f = []
    if (pastDue.length)
      f.push({ tone: 'bad', Icon: AlertTriangle, lead: `${pastDue.length} past due`, text: ` - ${pastDue[0].title}${pastDue.length > 1 ? ` +${pastDue.length - 1}` : ''}, not ${pastDue[0].type === 'quiz' ? 'taken' : 'submitted'}.` })
    if (next)
      f.push({ tone: 'info', Icon: ArrowRight, lead: 'Next up', text: ` - ${next.title}, ${relDay(next.ts, now)}.` })
    if (busy)
      f.push({ tone: 'warn', Icon: CalendarClock, lead: 'Busy day', text: ` - ${shortDay(busy.k)} has ${busy.n} deadlines.` })
    if (!f.length)
      f.push({ tone: 'good', Icon: CalendarCheck, lead: 'Clear week', text: ' - nothing due in the next 7 days.' })
    const lead = weekAhead.length
      ? `${weekAhead.length} event${weekAhead.length > 1 ? 's' : ''} in the next 7 days.`
      : 'Nothing scheduled this week.'
    return { findings: f.slice(0, 4), lead }
  }, [eventMap])

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
      {/* Header */}
      <div className="cal2-head">
        <div>
          <div className="cal2-title">Your calendar</div>
          <div className="cal2-sub">{monthEventCount} this month · {upcomingEvents.length} upcoming</div>
        </div>
        <button
          onClick={exportCalendar}
          className="btn btn-secondary text-xs"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
          title="Download an .ics file to subscribe in Google / Apple / Outlook Calendar"
        >
          <CalendarPlus size={14} /> Add to calendar
        </button>
      </div>

      <div className="cal2-grid">
        {/* Calendar card */}
        <div className="card overflow-hidden p-0" style={{ border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-1">
              <button className="icon-btn" onClick={prevMonth} aria-label="Previous month"><ChevronLeft size={16} /></button>
              <span className="font-bold text-ink text-sm min-w-[124px] text-center select-none">{MONTHS[month]} {year}</span>
              <button className="icon-btn" onClick={nextMonth} aria-label="Next month"><ChevronRight size={16} /></button>
              <button className="link-btn text-xs ml-1" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedKey(null) }}>Today</button>
            </div>
            <div className="cal2-legend">
              {Object.entries(EVENT_COLORS).map(([type, { dot, label }]) => (
                <span key={type} className="cal2-leg">
                  <span className="cal2-leg-dot" style={{ background: dot }} />
                  {label} <strong style={{ color: 'var(--ink)' }}>{monthTypeCounts[type] || 0}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {DAYS.map((d, i) => (
              <div key={d} className="text-center text-[10px] font-semibold py-2 uppercase tracking-[0.06em]" style={{ color: i === 0 || i === 6 ? 'var(--ink3)' : 'var(--ink2)' }}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: startOffset }).map((_, i) => (
              <div key={'e' + i} className="min-h-[52px]" style={{ background: 'var(--surface2)', borderRight: (startOffset + i + 1) % 7 === 0 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
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
                  className="min-h-[52px] p-1 cursor-pointer transition-colors"
                  style={{
                    borderRight: col === 6 ? 'none' : '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                    background: isSelected ? 'var(--accent-l)' : isWeekend ? 'color-mix(in srgb, var(--surface2) 55%, transparent)' : 'transparent',
                    boxShadow: isSelected ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isWeekend ? 'color-mix(in srgb, var(--surface2) 55%, transparent)' : 'transparent' }}
                  onClick={() => setSelectedKey(isSelected ? null : key)}
                >
                  <div className="text-[11px] font-bold w-[22px] h-[22px] flex items-center justify-center rounded-full mb-0.5" style={isToday ? { background: 'var(--accent)', color: '#fff' } : isSelected ? { color: 'var(--accent)' } : { color: 'var(--ink)' }}>
                    {dayNum}
                  </div>
                  <div className="space-y-0.5">
                    {events.slice(0, 2).map((ev, idx) => {
                      const c = EVENT_COLORS[ev.type]
                      return (
                        <div key={ev.id + idx} className="truncate text-[9px] rounded px-1 py-0.5 leading-tight font-medium flex items-center gap-1" style={{ background: c?.bg, color: c?.text }} title={ev.title}>
                          <span style={{ width: 4, height: 4, borderRadius: '50%', background: c?.dot, flexShrink: 0 }} />
                          <span className="truncate">{ev.title}</span>
                        </div>
                      )
                    })}
                    {events.length > 2 && <div className="text-[9px] text-ink3 pl-1 font-medium">+{events.length - 2}</div>}
                  </div>
                </div>
              )
            })}

            {Array.from({ length: trailingCells }).map((_, i) => (
              <div key={'t' + i} className="min-h-[52px]" style={{ background: 'var(--surface2)', borderRight: (startOffset + days + i + 1) % 7 === 0 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
            ))}
          </div>
        </div>

        {/* Side rail: Schedule Watch + Upcoming */}
        <div className="cal2-rail">
          <div className="sact-card sact-watch">
            <div className="sact-watch-h">
              <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
              <span className="sact-watch-title">Schedule Watch</span>
              <span className="sact-chip-tag">on-device</span>
            </div>
            <div className="sact-watch-lead">{watch.lead}</div>
            {watch.findings.map((fd, i) => (
              <div key={i} className={`sact-find sact-find-${fd.tone}`}>
                <fd.Icon size={15} />
                <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
              </div>
            ))}
          </div>

          <div className="sact-card" style={{ padding: 13 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-ink text-sm flex items-center gap-1.5"><Clock3 size={14} className="text-accent" /> Upcoming</span>
              <span className="text-[11px] text-ink3">Next 5</span>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-ink3 text-xs text-center py-2">No upcoming events yet.</p>
            ) : (
              upcomingEvents.map((ev, idx) => {
                const color = EVENT_COLORS[ev.type]
                const Icon = color.Icon
                return (
                  <div key={ev.id + idx} className="cal2-ag">
                    <span className="cal2-agi" style={{ background: color.bg, color: color.text }}><Icon size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink truncate">{ev.title}</div>
                      <div className="text-[11px] text-ink2 truncate">{ev.subtitle || color.label}</div>
                    </div>
                    <span className="text-[11px] text-ink3 whitespace-nowrap">{new Date(ev.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Selected day detail (full width, below the grid) */}
      {selectedKey && (
        <div className="card p-4" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-ink text-sm flex items-center gap-2"><CalendarDays size={15} className="text-accent" /> {fmtDate(selectedKey)}</h4>
            <button className="icon-btn text-ink3 hover:text-ink" onClick={() => setSelectedKey(null)} aria-label="Close"><X size={14} /></button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-ink3 text-sm text-center py-4">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev, idx) => {
                const color = EVENT_COLORS[ev.type]
                const statusLabel =
                  ev.type === 'activity' ? (ev.submitted ? 'Submitted' : ev.past ? 'Past due' : 'Open') :
                  ev.type === 'quiz'     ? (ev.taken ? 'Taken' : ev.past ? 'Closed' : 'Open') : null
                const statusStyle =
                  statusLabel === 'Submitted' || statusLabel === 'Taken'   ? { bg: 'rgba(34,197,94,0.12)', text: '#15803d' }
                  : statusLabel === 'Past due' || statusLabel === 'Closed' ? { bg: 'rgba(239,68,68,0.12)', text: '#dc2626' }
                  : statusLabel === 'Open'                                 ? { bg: 'rgba(59,130,246,0.12)', text: '#2563eb' } : null

                return (
                  <div key={ev.id + idx} className="flex items-center gap-3 p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-ink">{ev.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize" style={{ background: color.bg, color: color.text }}>{color.label}</span>
                        {statusLabel && statusStyle && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: statusStyle.bg, color: statusStyle.text }}>{statusLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {ev.subtitle && <span className="text-xs text-ink2">{ev.subtitle}</span>}
                        <span className="text-xs text-ink3">{fmtTime(ev.ts)}</span>
                      </div>
                    </div>
                    <button className="btn btn-secondary text-xs py-1 px-3 flex-shrink-0" onClick={() => {
                      setSelectedKey(null)
                      if (ev.type === 'activity' || ev.type === 'quiz') navigateToTarget({ side: 'student', tab: TAB_MAP[ev.type], type: ev.type, id: ev.id, classId: ev.classId })
                      else setStudentTab(TAB_MAP[ev.type] || 'overview')
                    }}>View →</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
