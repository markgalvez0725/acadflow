import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import {
  Sparkles, Bug, Lightbulb, MessageSquare, Send, CheckCircle2, Clock, Archive,
  ShieldCheck, Wand2, AlertTriangle,
} from 'lucide-react'

const MAX_MESSAGE = 2000

// The kinds of feedback a student can send. Kept in sync with the labels the
// professor sees in the Feedback Hub.
const CATEGORIES = [
  { key: 'enhancement', label: 'Enhancement', Icon: Sparkles,       hint: 'An idea to make AcadFlow better' },
  { key: 'bug',         label: 'Bug report',  Icon: Bug,            hint: 'Something is broken or behaving oddly' },
  { key: 'request',     label: 'Request',     Icon: Lightbulb,      hint: 'Ask for a feature or change' },
  { key: 'general',     label: 'General',     Icon: MessageSquare,  hint: 'Any other comment' },
]

function StatusPill({ status }) {
  const map = {
    new:      { label: 'Sent',     Icon: Clock,       cls: 'fb-pill fb-pill-new' },
    reviewed: { label: 'Reviewed', Icon: CheckCircle2, cls: 'fb-pill fb-pill-reviewed' },
    archived: { label: 'Archived', Icon: Archive,     cls: 'fb-pill fb-pill-archived' },
  }
  const s = map[status] || map.new
  return <span className={s.cls}><s.Icon size={12} /> {s.label}</span>
}

// Professor-acknowledgement ring (deterministic; mirrors the reviewed/total stat).
function ReviewedRing({ handled, total, color }) {
  const rate = total ? handled / total : 0
  const C = 2 * Math.PI * 34
  const off = C * (1 - Math.max(0, Math.min(1, rate)))
  return (
    <svg width="64" height="64" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="34" fill="none" stroke="var(--border)" strokeWidth="9" />
      <circle cx="42" cy="42" r="34" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 42 42)" />
      <text x="42" y="39" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--ink)">{handled}/{total}</text>
      <text x="42" y="54" textAnchor="middle" fontSize="8" fill="var(--ink3)">reviewed</text>
    </svg>
  )
}

export default function FeedbackTab({ student }) {
  const { studentFeedback = [], submitStudentFeedback } = useData()
  const { toast } = useUI()
  const [category, setCategory] = useState('enhancement')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // Only the signed-in student's own submissions (the Firestore listener returns
  // the whole collection, so filter client-side).
  const mine = useMemo(() =>
    studentFeedback
      .filter(f => f.studentId === student?.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [studentFeedback, student?.id]
  )

  // Standing over the student's own feedback - recomputed from `mine`, so the
  // ring and Feedback Watch can't disagree with the history list.
  const stats = useMemo(() => {
    const total = mine.length
    const reviewed = mine.filter(f => f.status === 'reviewed').length
    const archived = mine.filter(f => f.status === 'archived').length
    const awaiting = mine.filter(f => f.status === 'new' || !f.status).length
    const byCat = {}
    mine.forEach(f => { byCat[f.category] = (byCat[f.category] || 0) + 1 })
    let top = null
    Object.entries(byCat).forEach(([k, n]) => { if (!top || n > top.n) top = { k, n } })
    return { total, reviewed, archived, awaiting, handled: reviewed + archived, top }
  }, [mine])

  const ringColor = stats.total === 0 ? 'var(--ink3)' : stats.handled === stats.total ? 'var(--green)' : 'var(--accent)'

  // Deterministic "Feedback Watch" findings.
  const watch = useMemo(() => {
    if (!stats.total) {
      return {
        findings: [{ tone: 'info', Icon: MessageSquare, lead: 'No feedback yet', text: ' - your ideas help shape AcadFlow.' }],
        lead: 'Share your first idea or bug report.',
      }
    }
    const f = []
    if (stats.handled)
      f.push({ tone: 'good', Icon: CheckCircle2, lead: `${stats.handled} reviewed`, text: ' by your professor.' })
    if (stats.awaiting)
      f.push({ tone: 'info', Icon: Clock, lead: `${stats.awaiting} awaiting`, text: ' review.' })
    if (stats.top) {
      const cat = CATEGORIES.find(c => c.key === stats.top.k) || CATEGORIES[3]
      f.push({ tone: 'info', Icon: cat.Icon, lead: 'Most sent', text: ` - ${cat.label.toLowerCase()}s.` })
    }
    return { findings: f.slice(0, 4), lead: `${stats.total} sent · ${stats.handled} reviewed.` }
  }, [stats])

  // Deterministic draft helper - reacts to the chosen type + message length.
  const draftTip = useMemo(() => {
    const len = message.trim().length
    if (len > 0 && len < 15) return { warn: true, Icon: AlertTriangle, text: 'Add a bit more detail so your professor can act on it.' }
    if (category === 'bug') return { warn: false, Icon: Wand2, text: 'Helpful bug reports include what you did, what happened, and what you expected.' }
    if (category === 'enhancement' || category === 'request') return { warn: false, Icon: Wand2, text: 'Say what to change and why it would help. The clearer it is, the faster your professor can act.' }
    return { warn: false, Icon: Wand2, text: 'Tell your professor anything on your mind - every comment helps.' }
  }, [category, message])

  async function handleSubmit(e) {
    e?.preventDefault?.()
    const text = message.trim()
    if (!text) { toast('Please write your feedback first.', 'warn'); return }
    setSending(true)
    try {
      await submitStudentFeedback({ student, category, subject: subject.trim(), message: text })
      toast('Thanks! Your feedback was sent to your professor.', 'success')
      setSubject(''); setMessage(''); setCategory('enhancement')
    } catch (err) {
      toast('Could not send feedback: ' + (err?.message || 'try again'), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="feedback-tab" style={{ maxWidth: 920 }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Feedback hub</div>

      <div className="fb2-top">
        {/* Send feedback form */}
        <section className="card" style={{ padding: 18 }}>
          <div className="sec-hdr mb-3">
            <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageSquare size={18} /> Send feedback
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 14 }}>
            Spotted a bug, have an idea, or want to request something? It goes straight to your professor's Feedback Hub.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <button
                    type="button"
                    key={c.key}
                    className={`fb-cat${category === c.key ? ' active' : ''}`}
                    onClick={() => setCategory(c.key)}
                    title={c.hint}
                  >
                    <c.Icon size={16} />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="fb-subject">Subject <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="fb-subject"
                className="input"
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Grades tab, quiz timer, login…"
                maxLength={120}
              />
            </div>

            <div>
              <label className="label" htmlFor="fb-message">Your feedback</label>
              <textarea
                id="fb-message"
                className="input"
                rows={5}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Be specific. For bugs, describe what happened and what you expected."
                maxLength={MAX_MESSAGE}
                style={{ resize: 'vertical' }}
              />
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                {message.length}/{MAX_MESSAGE}
              </div>
            </div>

            {/* Deterministic draft helper */}
            <div className={`fb-tip${draftTip.warn ? ' fb-tip-warn' : ''}`}>
              <draftTip.Icon size={15} />
              <span>{draftTip.text}</span>
            </div>

            <div>
              <button className="btn btn-primary" type="submit" disabled={sending}>
                <Send size={15} style={{ marginRight: 6 }} />
                {sending ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        </section>

        {/* Feedback Watch rail */}
        <div className="card" style={{ padding: 14 }}>
          <div className="sact-watch-h">
            <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Feedback Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          {stats.total > 0 && (
            <div className="fb2-ring-row">
              <ReviewedRing handled={stats.handled} total={stats.total} color={ringColor} />
              <div className="fb2-ring-meta">
                <strong>{stats.total} sent</strong><br />
                {stats.handled} reviewed<br />
                {stats.awaiting} awaiting
              </div>
            </div>
          )}
          <div className="sact-watch-lead">{watch.lead}</div>
          {watch.findings.map((fd, i) => (
            <div key={i} className={`sact-find sact-find-${fd.tone}`}>
              <fd.Icon size={15} />
              <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Your feedback history */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title">Your feedback</div>
        </div>
        {mine.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><MessageSquare size={36} /></div>
            You haven't sent any feedback yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mine.map(f => {
              const cat = CATEGORIES.find(c => c.key === f.category) || CATEGORIES[3]
              const when = new Date(f.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              return (
                <div key={f.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      <cat.Icon size={14} /> {cat.label}
                    </span>
                    {f.subject && <span style={{ fontSize: 12, color: 'var(--ink2)' }}>· {f.subject}</span>}
                    <span style={{ marginLeft: 'auto' }}><StatusPill status={f.status} /></span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{f.message}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>{when}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
