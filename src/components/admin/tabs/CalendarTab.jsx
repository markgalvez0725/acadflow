import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const EVENT_COLORS = {
  activity:     { bg: 'bg-blue-500',   dot: '#3b82f6', label: 'Activity' },
  quiz:         { bg: 'bg-purple-500', dot: '#a855f7', label: 'Quiz' },
  announcement: { bg: 'bg-green-500',  dot: '#22c55e', label: 'Announcement' },
}

function toDateKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
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
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // Build event map: dateKey → array of events
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
        subtitle: cls ? cls.name : '',
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
        subtitle: cls ? cls.name : 'All Classes',
        ts,
      })
    })

    return map
  }, [activities, quizzes, announcements, classes, filterClass])

  // Build calendar grid
  const { days, startOffset } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return { days: daysInMonth, startOffset: firstDay }
  }, [year, month])

  const todayKey = toDateKey(today.getTime())

  const selectedEvents = selectedKey ? (eventMap[selectedKey] || []) : []

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            className="icon-btn"
            onClick={prevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-ink text-base min-w-[160px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button
            className="icon-btn"
            onClick={nextMonth}
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="link-btn text-xs ml-2"
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
          >
            Today
          </button>
        </div>

        {/* Class filter */}
        <div className="flex items-center gap-2">
          <select
            className="form-input text-sm py-1"
            value={filterClass}
            onChange={e => setFilterClass(e.target.value)}
          >
            <option value="all">All Classes</option>
            {activeClasses.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-ink2">
        {Object.entries(EVENT_COLORS).map(([type, { dot, label }]) => (
          <span key={type} className="flex items-center gap-1">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden p-0">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-line">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-ink2 py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells before month start */}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={'e' + i} className="min-h-[70px] border-b border-r border-line" />
          ))}

          {Array.from({ length: days }).map((_, i) => {
            const dayNum = i + 1
            const key = `${year}-${month}-${dayNum}`
            const events = eventMap[key] || []
            const isToday = key === todayKey
            const isSelected = key === selectedKey

            return (
              <div
                key={key}
                className={`min-h-[70px] border-b border-r border-line p-1 cursor-pointer transition-colors
                  ${isSelected ? 'bg-accent/10' : 'hover:bg-surface2'}
                `}
                onClick={() => setSelectedKey(isSelected ? null : key)}
              >
                <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday ? 'bg-accent text-white' : 'text-ink'}
                `}>
                  {dayNum}
                </div>
                <div className="space-y-0.5">
                  {events.slice(0, 3).map((ev, idx) => (
                    <div
                      key={ev.id + idx}
                      className="truncate text-[10px] rounded px-1 text-white leading-4"
                      style={{ background: EVENT_COLORS[ev.type]?.dot }}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {events.length > 3 && (
                    <div className="text-[10px] text-ink3 pl-1">+{events.length - 3} more</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedKey && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-ink text-sm flex items-center gap-2">
              <CalendarDays size={16} />
              {(() => {
                const [y, m, d] = selectedKey.split('-').map(Number)
                return new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
              })()}
            </h4>
            <button className="icon-btn" onClick={() => setSelectedKey(null)}>✕</button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-ink3 text-sm">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev, idx) => (
                <div key={ev.id + idx} className="flex items-start gap-3 p-2 rounded-lg bg-surface2">
                  <span
                    className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: EVENT_COLORS[ev.type]?.dot, marginTop: 4 }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-ink truncate">{ev.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-line text-ink2 capitalize">{ev.type}</span>
                    </div>
                    {ev.subtitle && <div className="text-xs text-ink2 mt-0.5">{ev.subtitle}</div>}
                    <div className="text-xs text-ink3 mt-0.5">{fmtTime(ev.ts)}</div>
                  </div>
                  <button
                    className="link-btn text-xs flex-shrink-0"
                    onClick={() => setAdminTab(ev.type === 'announcement' ? 'stream' : ev.type + 's')}
                  >
                    View →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
