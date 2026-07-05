import React, { useMemo, useState } from 'react'
import { X, HelpCircle, CheckCircle, Trash2, Plus } from 'lucide-react'

// Silent question queue: students ask without interrupting (optionally
// anonymous), +1 questions they share, and nothing scrolls away like chat.
// The professor works the list top-down (most-plussed first) and marks each
// answered; answered ones collapse into a dim group at the bottom.
function timeAgo(at) {
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)}h ago`
}

export default function MeetingQuestions({ open, questions, self, isAdmin, onAsk, onPlus, onAnswer, onDelete, onClose }) {
  const [draft, setDraft] = useState('')
  const [anon, setAnon] = useState(false)
  const [busy, setBusy] = useState(false)

  const { openQs, doneQs } = useMemo(() => {
    const plusCount = q => Object.keys(q.plus || {}).length
    const list = [...(questions || [])]
    return {
      openQs: list.filter(q => !q.answered)
        .sort((a, b) => (plusCount(b) - plusCount(a)) || ((a.at || 0) - (b.at || 0))),
      doneQs: list.filter(q => q.answered).sort((a, b) => (b.at || 0) - (a.at || 0)),
    }
  }, [questions])

  if (!open) return null

  async function submit(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onAsk(text, anon)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  function row(q, done) {
    const plussed = !!(q.plus || {})[self?.uid]
    const mine = q.uid === self?.uid
    const n = Object.keys(q.plus || {}).length
    return (
      <div key={q.id} className={`mr-qq-item${done ? ' done' : ''}`}>
        <div className="mr-qq-body">
          <p className="mr-qq-text">{q.text}</p>
          <span className="mr-qq-meta">
            {q.anon ? 'Anonymous' : q.name || 'Student'}{mine ? ' (you)' : ''} · {timeAgo(q.at || 0)}
            {n > 0 && <b> · {n} also asking</b>}
          </span>
        </div>
        {!done && !isAdmin && !mine && (
          <button
            className={`mr-qq-plus${plussed ? ' on' : ''}`}
            disabled={plussed}
            onClick={() => onPlus(q)}
            title="I have this question too"
          >
            <Plus size={13} /> 1
          </button>
        )}
        {!done && isAdmin && (
          <button className="mr-qq-act" onClick={() => onAnswer(q)} title="Mark as answered">
            <CheckCircle size={16} />
          </button>
        )}
        {isAdmin && (
          <button className="mr-qq-act mr-qq-del" onClick={() => onDelete(q)} title="Remove this question">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mr-people mr-qq" role="complementary" aria-label="Class questions">
      <div className="mr-people-head">
        <HelpCircle size={16} aria-hidden="true" /> Questions
        {openQs.length > 0 && <span className="mr-qq-count">{openQs.length} open</span>}
        <button className="mr-people-x" onClick={onClose} aria-label="Close the questions panel"><X size={16} /></button>
      </div>
      <div className="mr-otl-body">
        {openQs.length === 0 && (
          <p className="mr-otl-empty">
            {isAdmin
              ? 'No open questions. Students can ask here silently at any time.'
              : 'No questions yet. Ask below - the class will not be interrupted.'}
          </p>
        )}
        {openQs.map(q => row(q, false))}
        {doneQs.length > 0 && <p className="mr-otl-sub">Answered ({doneQs.length})</p>}
        {doneQs.map(q => row(q, true))}
      </div>
      {!isAdmin && (
        <div className="mr-otl-foot">
          <form className="mr-otl-add" onSubmit={submit}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Type your question…"
              maxLength={200}
              aria-label="Your question"
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Ask"><Plus size={15} /></button>
          </form>
          <label className="mr-qq-anon">
            <input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} />
            Ask anonymously
          </label>
        </div>
      )}
    </div>
  )
}
