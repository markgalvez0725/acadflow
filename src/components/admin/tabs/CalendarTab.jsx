import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { ChevronLeft, ChevronRight, CalendarDays, ClipboardList, FileQuestion, Megaphone, Clock3, Video, Radio } from 'lucide-react'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import PageHeader from '@/components/ds/PageHeader'
import MetricCard from '@/components/ds/MetricCard'
import { courseShort } from '@/constants/courses'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const EVENT_COLORS = {
  activity:     { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', text: '#2563eb', label: 'Activity',     Icon: ClipboardList },
  quiz:         { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', text: '#9333ea', label: 'Quiz',         Icon: FileQuestion },
  announcement: { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',  text: '#16a34a', label: 'Announcement', Icon: Megaphone },
  class:        { dot: '#f97316', bg: 'rgba(249,115,22,0.13)', text: '#ea580c', label: 'Class',        Icon: Video },
}

// Calendar event type -> destination tab. Classes navigate as type 'meeting'
// targets so the Online Classes row gets the same highlight the notification
// deep-links use.
const TAB_MAP = { activity: 'activities', quiz: 'quizzes', announcement: 'stream', class: 'onlineClasses' }

function toDateKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

// Short countdown for class rows ("in 45 m", "in 2 h", "in 3 d").
function fmtIn(ts, now) {
  const d = ts - now
  if (d <= 0) return 'now'
  const m = Math.round(d / 60000)
  if (m < 60) return `in ${m} m`
  if (m < 24 * 60) return `in ${Math.round(m / 60)} h`
  return `in ${Math.round(m / (24 * 60))} d`
}

// State chip for class events: live, ended, or a countdown.
function ClassChip({ ev }) {
  if (ev.live) return <span className="cal-chip cal-chip-live"><Radio size={10} /> Live now</span>
  if (ev.endedClass) return <span className="cal-chip cal-chip-ended">Ended</span>
  return <span className="cal-chip cal-chip-soon">{fmtIn(ev.ts, Date.now())}</span>
}

export default function CalendarTab() {
  const { activities, quizzes, announcements, meetings, classes, fbReady } = useData()
  const { setAdminTab, navigateToTarget } = useUI()

  const today = new Date()
  const todayKey = toDateKey(today.getTime())
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  // The day rail always shows a day - today until another one is picked.
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [filterClass, setFilterClass] = useState('all')

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  const eventMap = useMemo(() => {
    const map = {}
    function add(key, ev) {
      if (!map[key]) map[key] = []
      map[key].push(ev)
    }

    activities.forEach(a => {
      if (!a.deadline) return
      if (filterClass !== 'all' && a.classId !== filterClass) return
      const cls = classes.find(c => c.id === a.classId)
      add(toDateKey(a.deadline), {
        type: 'activity', id: a.id,
        title: a.title || 'Activity',
        subtitle: cls?.name || '',
        ts: a.deadline,
      })
    })

    quizzes.forEach(q => {
      if (!q.closeAt) return
      if (filterClass !== 'all' && !q.classIds?.includes(filterClass)) return
      const clsNames = (q.classIds || []).map(id => classes.find(c => c.id === id)?.name).filter(Boolean).join(', ')
      add(toDateKey(q.closeAt), {
        type: 'quiz', id: q.id,
        title: q.title || 'Quiz',
        subtitle: clsNames,
        ts: q.closeAt,
      })
    })

    announcements.forEach(a => {
      const ts = a.scheduledAt || a.createdAt
      if (!ts) return
      if (filterClass !== 'all' && a.classId && a.classId !== filterClass) return
      const cls = a.classId ? classes.find(c => c.id === a.classId) : null
      add(toDateKey(ts), {
        type: 'announcement', id: a.id,
        title: a.title || 'Announcement',
        subtitle: cls?.name || 'All Classes',
        ts,
      })
    })

    // Scheduled classes land on their day WITH the time; cancelled meetings
    // are deleted so they never appear, ended ones stay as history.
    meetings.forEach(mt => {
      if (!mt.scheduledAt) return
      if (mt.status !== 'scheduled' && mt.status !== 'live' && mt.status !== 'ended') return
      if (filterClass !== 'all' && mt.classId !== filterClass) return
      add(toDateKey(mt.scheduledAt), {
        type: 'class', id: mt.id,
        title: mt.title || 'Online class',
        subtitle: [mt.className, mt.subject].filter(Boolean).join(' · '),
        ts: mt.scheduledAt,
        live: mt.status === 'live',
        endedClass: mt.status === 'ended',
        provider: mt.provider === 'inapp' ? 'In-app room' : 'Meet link',
      })
    })

    return map
  }, [activities, quizzes, announcements, meetings, classes, filterClass])

  const { days, startOffset } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return { days: daysInMonth, startOffset: firstDay }
  }, [year, month])

  const selectedEvents = eventMap[selectedKey] || []

  // Count events in visible month for summary
  const monthEventCount = useMemo(() => {
    let count = 0
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${month}-${d}`
      count += (eventMap[key] || []).length
    }
    return count
  }, [eventMap, year, month, days])

  const monthTypeCounts = useMemo(() => {
    const counts = { activity: 0, quiz: 0, announcement: 0, class: 0 }
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${month}-${d}`
      ;(eventMap[key] || []).forEach(ev => {
        counts[ev.type] = (counts[ev.type] || 0) + 1
      })
    }
    return counts
  }, [eventMap, year, month, days])

  // Everything still ahead (live classes included even if they started).
  const upcomingAll = useMemo(() => {
    const now = Date.now()
    return Object.values(eventMap)
      .flat()
      .filter(ev => ev.ts >= now || ev.live)
      .sort((a, b) => a.ts - b.ts)
  }, [eventMap])
  const upcomingEvents = upcomingAll.slice(0, 5)

  // total grid cells, padded to complete final week row
  const totalCells = startOffset + days
  const trailingCells = (7 - (totalCells % 7)) % 7

  function goEvent(ev) {
    if (ev.type === 'announcement') { setAdminTab(TAB_MAP[ev.type]); return }
    navigateToTarget({
      side: 'admin',
      tab: TAB_MAP[ev.type],
      type: ev.type === 'class' ? 'meeting' : ev.type,
      id: ev.id,
    })
  }

  if (!fbReady) return <SkeletonRows />

  return (
    <div className="space-y-4">
      {/* Page header (shared pattern across content tabs) */}
      <PageHeader
        title="Calendar"
        subtitle="Track deadlines, quiz windows, classes, and stream activity by date."
        actions={<>
          <span className="badge badge-gray">{monthEventCount} this month</span>
          <span className="badge badge-gray">{upcomingAll.length} upcoming</span>
        </>}
      />

      {/* Summary stat cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <MetricCard
            key={type}
            Icon={color.Icon}
            color={{ activity: 'blue', quiz: 'purple', announcement: 'green', class: 'orange' }[type]}
            label={type === 'class' ? 'Classes' : color.label}
            value={monthTypeCounts[type] || 0}
            sub="this month"
          />
        ))}
      </div>

      {/* Month grid + always-on day rail (rail stacks below on tablet/mobile) */}
      <div className="cal2-grid">
        <div className="card card--static overflow-hidden p-0">
          {/* Header bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-1">
              <button className="icon-btn" onClick={prevMonth} aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <span className="font-bold text-ink text-base min-w-[140px] text-center select-none">
                {MONTHS[month]} {year}
              </span>
              <button className="icon-btn" onClick={nextMonth} aria-label="Next month">
                <ChevronRight size={16} />
              </button>
              <button
                className="link-btn text-xs ml-2"
                onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedKey(todayKey) }}
              >
                Today
              </button>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                {Object.entries(EVENT_COLORS).map(([type, { dot, label }]) => (
                  <span key={type} className="flex items-center gap-1.5 text-xs text-ink2">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
                    {label}
                  </span>
                ))}
              </div>
              <select
                className="form-input text-xs py-1.5 pr-7"
                value={filterClass}
                onChange={e => setFilterClass(e.target.value)}
              >
                <option value="all">All Classes</option>
                {activeClasses.map(c => (
                  <option key={c.id} value={c.id}>{courseShort(c.name)}{c.section ? ` - ${c.section}` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Day-of-week header (single letters on phones) */}
          <div className="grid grid-cols-7" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {DAYS.map((d, i) => (
              <div
                key={d}
                className="text-center text-[11px] font-semibold py-2.5 uppercase tracking-[0.06em]"
                style={{ color: i === 0 || i === 6 ? 'var(--ink3)' : 'var(--ink2)' }}
              >
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          {/* Calendar grid: text pills on wide screens, dot calendar on phones */}
          <div className="grid grid-cols-7">
            {Array.from({ length: startOffset }).map((_, i) => (
              <div
                key={'e' + i}
                className="min-h-[54px] sm:min-h-[88px]"
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
                  className="min-h-[54px] sm:min-h-[88px] p-1 sm:p-1.5 cursor-pointer transition-colors"
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
                  onClick={() => setSelectedKey(key)}
                >
                  <div
                    className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 mx-auto sm:mx-0"
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
                  <div className="hidden sm:block space-y-1">
                    {events.slice(0, 3).map((ev, idx) => {
                      const c = EVENT_COLORS[ev.type]
                      return (
                        <div
                          key={ev.id + idx}
                          className="truncate text-[10px] rounded px-1.5 py-0.5 leading-tight font-medium flex items-center gap-1"
                          style={{ background: c?.bg, color: ev.live ? '#ef4444' : c?.text }}
                          title={ev.title}
                        >
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: c?.dot, flexShrink: 0 }} />
                          <span className="truncate">
                            {ev.type === 'class' ? `${ev.live ? 'LIVE ' : ''}${fmtTime(ev.ts)} ${ev.title}` : ev.title}
                          </span>
                        </div>
                      )
                    })}
                    {events.length > 3 && (
                      <div className="text-[10px] text-ink3 pl-1 font-medium">+{events.length - 3} more</div>
                    )}
                  </div>
                  {/* Phones: category dots instead of crushed text pills */}
                  <div className="flex sm:hidden flex-wrap gap-[3px] justify-center pt-0.5">
                    {events.slice(0, 4).map((ev, idx) => (
                      <span key={idx} style={{ width: 5, height: 5, borderRadius: '50%', background: EVENT_COLORS[ev.type]?.dot }} />
                    ))}
                  </div>
                </div>
              )
            })}

            {Array.from({ length: trailingCells }).map((_, i) => (
              <div
                key={'t' + i}
                className="min-h-[54px] sm:min-h-[88px]"
                style={{ background: 'var(--surface2)', borderRight: (startOffset + days + i + 1) % 7 === 0 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
              />
            ))}
          </div>
        </div>

        {/* Day rail: selected day (defaults to today) + Up next */}
        <div className="cal2-rail">
          <div className="card card--static p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-ink text-sm flex items-center gap-2">
                <CalendarDays size={15} className="text-accent" />
                {fmtDate(selectedKey)}
              </h4>
              {selectedKey !== todayKey && (
                <button className="link-btn text-xs" onClick={() => setSelectedKey(todayKey)}>Today</button>
              )}
            </div>
            {selectedEvents.length === 0 ? (
              <p className="text-ink3 text-xs text-center py-3">Nothing on this day.</p>
            ) : (
              selectedEvents.map((ev, idx) => {
                const color = EVENT_COLORS[ev.type]
                const Icon = color.Icon
                return (
                  <div key={ev.id + idx} className="cal2-ag cursor-pointer" onClick={() => goEvent(ev)} title="Open">
                    <span className="cal2-agi" style={{ background: color.bg, color: color.text }}><Icon size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink truncate">{ev.title}</div>
                      <div className="text-[11px] text-ink2 truncate">
                        {[ev.subtitle, fmtTime(ev.ts), ev.provider].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {ev.type === 'class' && <ClassChip ev={ev} />}
                    <ChevronRight size={13} className="text-ink3 flex-shrink-0" />
                  </div>
                )
              })
            )}
          </div>

          <div className="card card--static p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-ink text-sm flex items-center gap-1.5">
                <Clock3 size={14} className="text-accent" /> Up next
              </span>
              <span className="text-[11px] text-ink3">Next {upcomingEvents.length || 0}</span>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-ink3 text-xs text-center py-2">No upcoming events yet.</p>
            ) : (
              upcomingEvents.map((ev, idx) => {
                const color = EVENT_COLORS[ev.type]
                const Icon = color.Icon
                return (
                  <div key={ev.id + idx} className="cal2-ag cursor-pointer" onClick={() => goEvent(ev)} title="Open">
                    <span className="cal2-agi" style={{ background: color.bg, color: color.text }}><Icon size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink truncate">{ev.title}</div>
                      <div className="text-[11px] text-ink2 truncate">{ev.subtitle || color.label}</div>
                    </div>
                    {ev.type === 'class' && ev.live
                      ? <ClassChip ev={ev} />
                      : <span className="text-[11px] text-ink3 whitespace-nowrap">{new Date(ev.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
