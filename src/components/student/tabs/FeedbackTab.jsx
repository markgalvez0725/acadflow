import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Sparkles, Bug, Lightbulb, MessageSquare, Send, CheckCircle2, Clock, Archive } from 'lucide-react'

const MAX_MESSAGE = 2000

// The kinds of feedback a student can send. Kept in sync with the labels the
// teacher sees in the Feedback Hub.
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

  async function handleSubmit(e) {
    e?.preventDefault?.()
    const text = message.trim()
    if (!text) { toast('Please write your feedback first.', 'warn'); return }
    setSending(true)
    try {
      await submitStudentFeedback({ student, category, subject: subject.trim(), message: text })
      toast('Thanks! Your feedback was sent to your teacher.', 'success')
      setSubject(''); setMessage(''); setCategory('enhancement')
    } catch (err) {
      toast('Could not send feedback: ' + (err?.message || 'try again'), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="feedback-tab" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
      <section className="card" style={{ padding: 18 }}>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} /> Send feedback
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 14 }}>
          Spotted a bug, have an idea, or want to request something? Tell your teacher directly —
          it goes straight to their Feedback Hub.
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

          <div>
            <button className="btn btn-primary" type="submit" disabled={sending}>
              <Send size={15} style={{ marginRight: 6 }} />
              {sending ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </form>
      </section>

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
