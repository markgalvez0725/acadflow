import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { activeClassIds } from '@/utils/active'
import { deadlineLabel, deadlineColor } from '@/utils/deadlines'
import { subjectColor } from '@/utils/subjectColor'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import { ClipboardList, ChevronRight } from 'lucide-react'

// Cross-subject assignment tracker: one place to see every activity's status
// (To do / Submitted / Graded / Missed) across all current classes. Submission
// still happens in the Activities tab — tapping a row jumps there.

const FILTERS = [
  { key: 'todo',      label: 'To do' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'graded',    label: 'Graded' },
  { key: 'all',       label: 'All' },
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

export default function AssignmentsTab({ student: s, classes }) {
  const { activities, semester, fbReady } = useData()
  const { setStudentTab } = useUI()

  const [filter, setFilter] = useState('todo')
  const [subjectFilter, setSubjectFilter] = useState('all')

  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])

  // All activities for the student's active classes, decorated with status.
  const rows = useMemo(() => {
    const now = Date.now()
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

  const visible = rows.filter(r =>
    (filter === 'all' || r.status.group === filter) &&
    (subjectFilter === 'all' || r.act.subject === subjectFilter)
  )

  if (!fbReady) return <SkeletonRows />

  const now = Date.now()

  return (
    <div className="student-assignments">
      <div className="sec-hdr mb-3">
        <div className="sec-title sec-title-ic"><ClipboardList /> Assignment tracker</div>
        <span className="text-xs text-ink2">{counts.todo} to do · {counts.submitted} submitted · {counts.graded} graded</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div className="seg" role="tablist" aria-label="Filter assignments" style={{ display: 'inline-flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 10 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className="btn btn-sm"
              onClick={() => setFilter(f.key)}
              style={{
                border: 'none',
                background: filter === f.key ? 'var(--surface)' : 'transparent',
                color: filter === f.key ? 'var(--ink)' : 'var(--ink2)',
                fontWeight: filter === f.key ? 700 : 500,
                boxShadow: filter === f.key ? 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,.08))' : 'none',
              }}
            >
              {f.label} <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(({ act, status }) => {
            const showDue = status.group === 'todo' && act.deadline
            const color = act.deadline ? deadlineColor(act.deadline, now) : 'var(--ink3)'
            return (
              <button
                key={act.id}
                type="button"
                className="card"
                onClick={() => setStudentTab('activities')}
                aria-label={`${act.title}${act.subject ? ' — ' + act.subject : ''}, ${status.label}. Open Activities.`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', width: '100%', border: '1px solid var(--border)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{act.title}</span>
                    <span className={`badge ${status.badgeCls}`}>{status.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: subjectColor(act.subject).color, flexShrink: 0 }} />
                    <span>{act.subject || 'General'}
                    {act.deadline && <> · Due {new Date(act.deadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</>}</span>
                  </div>
                </div>
                {showDue && (
                  <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>
                    {deadlineLabel(act.deadline, now)}
                  </span>
                )}
                <ChevronRight size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
