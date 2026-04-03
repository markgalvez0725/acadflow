import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const EVENT_COLORS = {
  activity:     { dot: '#3b82f6', label: 'Activity' },
  quiz:         { dot: '#a855f7', label: 'Quiz' },
  announcement: { dot: '#22c55e', label: 'Announcement' },
}

function toDateKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export default function CalendarTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements } = useData()

  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedKey, setSelectedKey] = useState(null)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
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

    // Activities with deadlines
    activities.forEach(a => {
      if (!a.deadline) return
      if (!studentClassIds.includes(a.classId)) return
      const cls = classes?.find(c => c.id === a.classId)
      const submitted = !!(a.submissions || {})[student?.id]?.link
      const past = Date.now() > a.deadline
      add(toDateKey(a.deadline), {
        type: 'activity', id: a.id,
        title: a.title || 'Activity',
        subtitle: cls ? cls.name : '',
        ts: a.deadline,
        submitted,
        past,
      })
    })

    // Quizzes (deadline = closeAt)
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
        taken,
        past,
      })
    })

    // Announcements (scheduled or created date)
    announcements.forEach(a => {
      const ts = a.scheduledAt || a.createdAt
      if (!ts) return
      const isForStudent = !a.classId || studentClassIds.includes(a.classId)
      if (!isForStudent) return
      const cls = a.classId ? classes?.find(c => c.id === a.classId) : null
      add(toDateKey(ts), {
        type: 'announcement', id: a.id,
        title: a.title || 'Announcement',
        subtitle: cls ? cls.name : 'All Classes',
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

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button className="icon-btn" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-ink text-base min-w-[160px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button className="icon-btn" onClick={nextMonth} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
          <button
            className="link-btn text-xs ml-2"
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
          >
            Today
          </button>
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
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-line">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-ink2 py-2">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={'e' + i} className="min-h-[64px] border-b border-r border-line" />
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
                className={`min-h-[64px] border-b border-r border-line p-1 cursor-pointer transition-colors
                  ${isSelected ? 'bg-accent/10' : 'hover:bg-surface2'}
                `}
                onClick={() => setSelectedKey(isSelected ? null : key)}
              >
                <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-0.5
                  ${isToday ? 'bg-accent text-white' : 'text-ink'}
                `}>
                  {dayNum}
                </div>
                <div className="space-y-0.5">
                  {events.slice(0, 2).map((ev, idx) => (
                    <div
                      key={ev.id + idx}
                      className="truncate text-[10px] rounded px-1 text-white leading-4"
                      style={{ background: EVENT_COLORS[ev.type]?.dot }}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {events.length > 2 && (
                    <div className="text-[10px] text-ink3 pl-1">+{events.length - 2}</div>
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
            <button className="icon-btn text-xs" onClick={() => setSelectedKey(null)}>✕</button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-ink3 text-sm">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev, idx) => {
                const statusLabel =
                  ev.type === 'activity' ? (ev.submitted ? '✓ Submitted' : ev.past ? 'Past due' : 'Open') :
                  ev.type === 'quiz'     ? (ev.taken ? '✓ Taken' : ev.past ? 'Closed' : 'Open') :
                  null

                return (
                  <div key={ev.id + idx} className="flex items-start gap-3 p-2 rounded-lg bg-surface2">
                    <span
                      className="flex-shrink-0"
                      style={{ width: 10, height: 10, borderRadius: '50%', background: EVENT_COLORS[ev.type]?.dot, marginTop: 4 }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-ink">{ev.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-line text-ink2 capitalize">{ev.type}</span>
                        {statusLabel && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium
                            ${statusLabel.startsWith('✓') ? 'bg-green-100 text-green-700' :
                              statusLabel.includes('due') || statusLabel === 'Closed' ? 'bg-red-100 text-red-600' :
                              'bg-blue-100 text-blue-600'}
                          `}>
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      {ev.subtitle && <div className="text-xs text-ink2 mt-0.5">{ev.subtitle}</div>}
                      <div className="text-xs text-ink3 mt-0.5">{fmtTime(ev.ts)}</div>
                    </div>
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
