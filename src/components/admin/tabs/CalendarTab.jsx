import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const EVENT_COLORS = {
  activity:     { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', text: '#2563eb', label: 'Activity' },
  quiz:         { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', text: '#9333ea', label: 'Quiz' },
  announcement: { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',  text: '#16a34a', label: 'Announcement' },
}

const TAB_MAP = { activity: 'activities', quiz: 'quizzes', announcement: 'stream' }

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

export default function CalendarTab() {
  const { activities, quizzes, announcements, classes } = useData()
  const { setAdminTab } = useUI()

  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedKey, setSelectedKey] = useState(null)
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

    return map
  }, [activities, quizzes, announcements, classes, filterClass])

  const { days, startOffset } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return { days: daysInMonth, startOffset: firstDay }
  }, [year, month])

  const todayKey = toDateKey(today.getTime())
  const selectedEvents = selectedKey ? (eventMap[selectedKey] || []) : []

  // Count events in visible month for summary
  const monthEventCount = useMemo(() => {
    let count = 0
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${month}-${d}`
      count += (eventMap[key] || []).length
    }
    return count
  }, [eventMap, year, month, days])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Month nav */}
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

          <div className="flex items-center gap-3 flex-wrap">
            {/* Event count badge */}
            {monthEventCount > 0 && (
              <span className="text-xs text-ink2 bg-surface2 px-2 py-0.5 rounded-full">
                {monthEventCount} event{monthEventCount !== 1 ? 's' : ''} this month
              </span>
            )}

            {/* Legend */}
            <div className="flex items-center gap-3">
              {Object.entries(EVENT_COLORS).map(([type, { dot, label }]) => (
                <span key={type} className="flex items-center gap-1 text-xs text-ink2">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
                  {label}
                </span>
              ))}
            </div>

            {/* Class filter */}
            <select
              className="form-input text-xs py-1 pr-7"
              value={filterClass}
              onChange={e => { setFilterClass(e.target.value); setSelectedKey(null) }}
            >
              <option value="all">All Classes</option>
              {activeClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden p-0">
        {/* Day headers */}
        <div className="grid grid-cols-7 bg-surface2 border-b border-line">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-ink2 py-2.5 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={'e' + i} className="min-h-[80px] border-b border-r border-line bg-surface2/30" />
          ))}

          {Array.from({ length: days }).map((_, i) => {
            const dayNum = i + 1
            const key = `${year}-${month}-${dayNum}`
            const events = eventMap[key] || []
            const isToday = key === todayKey
            const isSelected = key === selectedKey
            const hasEvents = events.length > 0

            return (
              <div
                key={key}
                className={`min-h-[80px] border-b border-r border-line p-1.5 cursor-pointer transition-all
                  ${isSelected ? 'bg-accent/10 ring-1 ring-inset ring-accent/30' : hasEvents ? 'hover:bg-surface2' : 'hover:bg-surface2/60'}
                `}
                onClick={() => setSelectedKey(isSelected ? null : key)}
              >
                <div className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 transition-colors
                  ${isToday ? 'bg-accent text-white shadow-sm' : isSelected ? 'text-accent' : 'text-ink'}
                `}>
                  {dayNum}
                </div>
                <div className="space-y-0.5">
                  {events.slice(0, 3).map((ev, idx) => (
                    <div
                      key={ev.id + idx}
                      className="truncate text-[10px] rounded-sm px-1 leading-[15px] font-medium"
                      style={{ background: EVENT_COLORS[ev.type]?.dot, color: '#fff' }}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {events.length > 3 && (
                    <div className="text-[10px] text-ink3 pl-0.5 font-medium">+{events.length - 3} more</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedKey && (
        <div className="card p-4">
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
                return (
                  <div
                    key={ev.id + idx}
                    className="flex items-center gap-3 p-3 rounded-lg border border-line"
                    style={{ borderLeftWidth: 3, borderLeftColor: color.dot }}
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
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {ev.subtitle && <span className="text-xs text-ink2">{ev.subtitle}</span>}
                        <span className="text-xs text-ink3">{fmtTime(ev.ts)}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary text-xs py-1 px-3 flex-shrink-0"
                      onClick={() => { setAdminTab(TAB_MAP[ev.type] || 'dashboard'); setSelectedKey(null) }}
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
    </div>
  )
}
