import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'
import { useUI } from '@/context/UIContext'
import { Sparkles, Bug, Lightbulb, MessageSquare, Search, CheckCircle2, Clock, Archive, RotateCcw } from 'lucide-react'

const CAT_META = {
  enhancement: { label: 'Enhancement', Icon: Sparkles },
  bug:         { label: 'Bug report',  Icon: Bug },
  request:     { label: 'Request',     Icon: Lightbulb },
  general:     { label: 'General',     Icon: MessageSquare },
}

const FILTERS = [
  { key: 'new',      label: 'New' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'archived', label: 'Archived' },
  { key: 'all',      label: 'All' },
]

function StatusPill({ status }) {
  const map = {
    new:      { label: 'New',      Icon: Clock,        cls: 'fb-pill fb-pill-new' },
    reviewed: { label: 'Reviewed', Icon: CheckCircle2, cls: 'fb-pill fb-pill-reviewed' },
    archived: { label: 'Archived', Icon: Archive,      cls: 'fb-pill fb-pill-archived' },
  }
  const s = map[status] || map.new
  return <span className={s.cls}><s.Icon size={12} /> {s.label}</span>
}

export default function FeedbackHubTab() {
  const { studentFeedback = [], updateFeedbackStatus, students = [] } = useData()
  const { toast } = useUI()
  const [filter, setFilter] = useState('new')
  const [q, setQ] = useState('')

  const counts = useMemo(() => ({
    new:      studentFeedback.filter(f => f.status === 'new').length,
    reviewed: studentFeedback.filter(f => f.status === 'reviewed').length,
    archived: studentFeedback.filter(f => f.status === 'archived').length,
    all:      studentFeedback.length,
  }), [studentFeedback])

  const list = useMemo(() => {
    let out = [...studentFeedback].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    if (filter !== 'all') out = out.filter(f => (f.status || 'new') === filter)
    const term = q.trim().toLowerCase()
    if (term) {
      out = out.filter(f =>
        `${f.studentName || ''} ${f.category || ''} ${f.subject || ''} ${f.message || ''}`
          .toLowerCase().includes(term)
      )
    }
    return out
  }, [studentFeedback, filter, q])

  async function setStatus(f, status, label) {
    try {
      await updateFeedbackStatus(f.id, status)
      toast(label, 'success')
    } catch (e) {
      toast('Could not update: ' + (e?.message || 'try again'), 'error')
    }
  }

  return (
    <div className="feedback-hub">
      <PageHeader
        title="Feedback"
        subtitle={`${counts.new} new · ${counts.all} total`}
      />
      <div className="sec-hdr mb-3" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}{counts[f.key] ? ` (${counts[f.key]})` : ''}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 'min(280px, 60vw)', marginLeft: 'auto' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
          <input
            className="input"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search feedback…"
            style={{ paddingLeft: 30 }}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          Icon={MessageSquare}
          tone={q ? 'muted' : 'accent'}
          title={q ? 'No matching feedback.' : filter === 'new' ? 'No new feedback. You\'re all caught up.' : 'No feedback here.'}
          text="Student bug reports, ideas, and requests land here."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map(f => {
            const cat = CAT_META[f.category] || CAT_META.general
            const when = new Date(f.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            return (
              <div key={f.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                    <cat.Icon size={14} /> {cat.label}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600 }}>{f.studentName || f.studentId}<VerifiedBadge studentId={f.studentId} students={students} size={13} /></span>
                  {f.subject && <span style={{ fontSize: 12, color: 'var(--ink2)' }}>· {f.subject}</span>}
                  <span style={{ marginLeft: 'auto' }}><StatusPill status={f.status} /></span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{f.message}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{when}</span>
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                    {f.status !== 'reviewed' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setStatus(f, 'reviewed', 'Marked as reviewed.')}>
                        <CheckCircle2 size={14} style={{ marginRight: 4 }} /> Reviewed
                      </button>
                    )}
                    {f.status !== 'archived'
                      ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => setStatus(f, 'archived', 'Archived.')}>
                          <Archive size={14} style={{ marginRight: 4 }} /> Archive
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => setStatus(f, 'new', 'Restored to New.')}>
                          <RotateCcw size={14} style={{ marginRight: 4 }} /> Restore
                        </button>
                      )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
