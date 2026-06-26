import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { activeClassIds } from '@/utils/active'
import { deadlineLabel, deadlineColor } from '@/utils/deadlines'
import { subjectColor } from '@/utils/subjectColor'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import StandingRing from '@/components/primitives/StandingRing'
import {
  ClipboardList, ChevronRight, ListChecks, AlertTriangle, ArrowRightCircle,
  Layers, CheckCircle2, Flame, CalendarClock, Calendar, Check, Award,
} from 'lucide-react'

// Cross-subject assignment tracker: one place to see every activity's status
// (To do / Submitted / Graded / Missed) across all current classes. Submission
// still happens in the Activities tab — tapping a row jumps there. The ring and
// "Workload Watch" planner are deterministic, recomputed from the same rows the
// list renders, so they can never disagree with what's on screen.

const WEEK = 7 * 86400000

const FILTERS = [
  { key: 'todo',      label: 'To do' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'graded',    label: 'Graded' },
  { key: 'all',       label: 'All' },
]

// Urgency/status buckets, rendered in this fixed order (empty ones drop out).
const BUCKETS = [
  { key: 'overdue',   label: 'Overdue',       Icon: Flame,         color: 'var(--red)' },
  { key: 'week',      label: 'Due this week', Icon: CalendarClock, color: 'var(--gold-var)' },
  { key: 'upcoming',  label: 'Upcoming',      Icon: Calendar,      color: 'var(--ink3)' },
  { key: 'submitted', label: 'Submitted',     Icon: Check,         color: 'var(--accent)' },
  { key: 'graded',    label: 'Graded',        Icon: Award,         color: 'var(--green)' },
]

function statusOf(act, studentId) {
  const sub = (act.submissions || {})[studentId] || {}
  const maxScore = act.maxScore || 100
  if (sub.score != null) {
    const ratio = sub.score / maxScore
    return {
      group: 'graded',
      label: `Graded · ${sub.score}/${maxScore}`,
      badgeCls: ratio >= 0.75 ? 'badge-green' : ratio >= 0.6 ? 'badge-yellow' : 'badge-red',
    }
  }
  if (sub.link) return { group: 'submitted', label: 'Submitted', badgeCls: 'badge-blue' }
  const isPast = act.deadline ? Date.now() > act.deadline : false
  if (isPast) return { group: 'todo', label: 'Missed', badgeCls: 'badge-red', missed: true }
  return { group: 'todo', label: 'To do', badgeCls: 'badge-gray' }
}

function bucketOf(r, now) {
  const g = r.status.group
  if (g === 'submitted') return 'submitted'
  if (g === 'graded') return 'graded'
  if (r.status.missed) return 'overdue'
  if (r.act.deadline && r.act.deadline - now <= WEEK) return 'week'
  return 'upcoming'
}


export default function AssignmentsTab({ student: s, classes }) {
  const { activities, semester, fbReady } = useData()
  const { setStudentTab } = useUI()

  const [filter, setFilter] = useState('todo')
  const [subjectFilter, setSubjectFilter] = useState('all')

  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])

  // All activities for the student's active classes, decorated with status.
  const rows = useMemo(() => {
    return (activities || [])
      .filter(a => enrolledIds.includes(a.classId))
      .map(a => ({ act: a, status: statusOf(a, s.id) }))
      .sort((a, b) => {
        // Urgency-first: overdue/soonest deadlines float up; undated sink.
        const da = a.act.deadline ?? Infinity
        const db = b.act.deadline ?? Infinity
        if (da !== db) return da - db
        return (b.act.createdAt || 0) - (a.act.createdAt || 0)
      })
  }, [activities, enrolledIds, s.id])

  const subjects = useMemo(
    () => [...new Set(rows.map(r => r.act.subject).filter(Boolean))].sort(),
    [rows]
  )

  const counts = useMemo(() => {
    const c = { todo: 0, submitted: 0, graded: 0, all: rows.length }
    rows.forEach(r => { c[r.status.group]++ })
    return c
  }, [rows])

  const ring = useMemo(() => {
    const total = rows.length
    const done = counts.submitted + counts.graded
    const rate = total ? Math.round((done / total) * 100) : 0
    const overdue = rows.filter(r => r.status.missed).length
    const color = rate >= 75 ? 'var(--green)' : rate >= 50 ? 'var(--gold-var)' : 'var(--red)'
    return { total, done, rate, overdue, color }
  }, [rows, counts])

  // Deterministic "Workload Watch" planner — what to do, in what order.
  const watch = useMemo(() => {
    const now = Date.now()
    const todo    = rows.filter(r => r.status.group === 'todo')
    const overdue = todo.filter(r => r.status.missed)
    const open    = todo.filter(r => !r.status.missed)
    const next    = open.filter(r => r.act.deadline).sort((a, b) => a.act.deadline - b.act.deadline)[0]
    const bySub = {}
    open.forEach(r => { const sub = r.act.subject || 'General'; bySub[sub] = (bySub[sub] || 0) + 1 })
    let heavy = null
    Object.entries(bySub).forEach(([sub, n]) => { if (!heavy || n > heavy.n) heavy = { sub, n } })

    const f = []
    if (overdue.length) {
      const subs = [...new Set(overdue.map(r => r.act.subject || 'General'))]
      f.push({ tone: 'bad', Icon: AlertTriangle, lead: `${overdue.length} overdue`, text: ` — ${subs.slice(0, 2).join(', ')}${subs.length > 2 ? '…' : ''}.` })
    }
    if (next)
      f.push({ tone: 'info', Icon: ArrowRightCircle, lead: 'Do next', text: ` — ${next.act.title} (${next.act.subject || 'General'}), ${deadlineLabel(next.act.deadline, now)}.` })
    if (heavy && heavy.n >= 2)
      f.push({ tone: 'warn', Icon: Layers, lead: 'Heaviest load', text: ` — ${heavy.sub} has ${heavy.n} still to do.` })
    if (!f.length)
      f.push({ tone: 'good', Icon: CheckCircle2, lead: "You're all caught up", text: ' — no pending work across your subjects.' })

    const action = overdue.length + open.length
    const lead = action
      ? `${action} item${action > 1 ? 's' : ''} need${action > 1 ? '' : 's'} action — here's the order to tackle them.`
      : "Nothing pending — you're all caught up."
    return { findings: f.slice(0, 4), lead }
  }, [rows])

  const visible = useMemo(() => rows.filter(r =>
    (filter === 'all' || r.status.group === filter) &&
    (subjectFilter === 'all' || r.act.subject === subjectFilter)
  ), [rows, filter, subjectFilter])

  const grouped = useMemo(() => {
    const now = Date.now()
    const map = {}
    visible.forEach(r => { const b = bucketOf(r, now); (map[b] ||= []).push(r) })
    return BUCKETS.map(b => ({ ...b, items: map[b.key] || [] })).filter(b => b.items.length)
  }, [visible])

  if (!fbReady) return <SkeletonRows />

  const now = Date.now()

  return (
    <div className="student-assignments">
      <div className="sec-hdr mb-3">
        <div className="sec-title sec-title-ic"><ClipboardList /> Assignment tracker</div>
        <span className="text-xs text-ink2">{counts.todo} to do · {counts.submitted} submitted · {counts.graded} graded</span>
      </div>

      {/* Workload ring + Workload Watch */}
      <div className="sact-top">
        <div className="sact-card sact-ring-card">
          <StandingRing rate={ring.rate} color={ring.color} />
          <div className="sact-ring-meta">
            <strong>{ring.done} of {ring.total} done</strong><br />
            {counts.todo} to do{ring.overdue ? ` · ${ring.overdue} overdue` : ''}<br />
            across {subjects.length} subject{subjects.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="sact-card sact-watch">
          <div className="sact-watch-h">
            <ListChecks size={17} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Workload Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          <div className="sact-watch-lead">{watch.lead}</div>
          {watch.findings.map((fd, i) => (
            <div key={i} className={`sact-find sact-find-${fd.tone}`}>
              <fd.Icon size={16} />
              <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter pills + subject select */}
      <div className="sact-pills" style={{ alignItems: 'center' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`sact-pill ${filter === f.key ? 'on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
        {subjects.length > 1 && (
          <select
            className="class-selector"
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            aria-label="Filter by subject"
            style={{ marginLeft: 'auto' }}
          >
            <option value="all">All subjects</option>
            {subjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
          </select>
        )}
      </div>

      {!visible.length ? (
        <div className="empty">
          <div className="empty-icon"><ClipboardList size={40} /></div>
          {filter === 'todo' ? 'Nothing to do — you’re all caught up.' : 'No assignments here yet.'}
        </div>
      ) : (
        grouped.map((b, bi) => (
          <div key={b.key}>
            <div className={`sact-group-h ${bi === 0 ? 'first' : ''}`}>
              <b.Icon size={13} style={{ color: b.color }} /> {b.label} <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{b.items.length}</span>
            </div>
            <div className="sact-rowcard">
              {b.items.map(({ act, status }) => {
                const showDue = status.group === 'todo' && act.deadline
                const color = act.deadline ? deadlineColor(act.deadline, now) : 'var(--ink3)'
                return (
                  <button
                    key={act.id}
                    type="button"
                    className="sact-row"
                    onClick={() => setStudentTab('activities')}
                    aria-label={`${act.title}${act.subject ? ' — ' + act.subject : ''}, ${status.label}. Open Activities.`}
                  >
                    <span className="sact-dot" style={{ background: subjectColor(act.subject).color }} />
                    <div className="sact-row-main">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="sact-row-title">{act.title}</span>
                        <span className={`badge ${status.badgeCls}`}>{status.label}</span>
                      </div>
                      <div className="sact-row-meta">
                        {act.subject || 'General'}
                        {act.deadline && <> · Due {new Date(act.deadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</>}
                      </div>
                    </div>
                    {showDue && (
                      <span className="sact-row-due" style={{ color }}>{deadlineLabel(act.deadline, now)}</span>
                    )}
                    <ChevronRight size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
                  </button>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
