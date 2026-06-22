import React, { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import { notifyAdminMessage } from '@/firebase/messageNotify'
import { computeFinalGradeFromTerms } from '@/utils/grades'
import { RefreshCw } from 'lucide-react'

const MAX_REASON = 1500

// Current final percentage for a subject, mirroring how GradesTab derives it.
function currentGradeFor(student, sub) {
  const comp = student.gradeComponents?.[sub] || {}
  const pct = computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null)
  return pct ?? student.grades?.[sub] ?? null
}

/**
 * Lets a student raise a structured grade-appeal / regrade request. It is sent
 * as a normal message to the teacher (type 'regrade_request') so it lands in
 * the existing Messages inbox and can be replied to like any conversation.
 */
export default function RegradeRequestModal({ student: s, subjects = [], onClose }) {
  const { db, fbReady } = useData()
  const { toast } = useUI()
  const [subject, setSubject] = useState(subjects[0] || '')
  const [reason, setReason]   = useState('')
  const [sending, setSending] = useState(false)

  const currentGrade = subject ? currentGradeFor(s, subject) : null

  async function handleSubmit() {
    const text = reason.trim()
    if (!subject) { toast('Please choose a subject.', 'warn'); return }
    if (!text)    { toast('Please explain why you are requesting a regrade.', 'warn'); return }
    if (text.length > MAX_REASON) { toast(`Reason too long — maximum ${MAX_REASON} characters.`, 'warn'); return }
    if (!fbReady || !db.current) { toast('Regrade requests require Firebase to be connected.', 'warn'); return }

    setSending(true)
    try {
      const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
      const gradeNote = currentGrade != null ? ` (current: ${currentGrade.toFixed(1)}%)` : ''
      const msg = {
        id: newId,
        from: s.id,
        to: 'admin',
        subject: `Regrade request: ${subject}${gradeNote}`,
        body: text,
        ts: Date.now(),
        read: [s.id],
        adminRead: false,
        replies: [],
        type: 'regrade_request',
        meta: { subject, currentGrade: currentGrade ?? null },
      }
      await setDoc(doc(db.current, 'messages', newId), msg)
      notifyAdminMessage(db.current, s.name || s.id, `Regrade request for ${subject}: ${text}`, 'message')
      toast('Regrade request sent to your teacher.', 'green')
      onClose()
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={onClose} size="sm">
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><RefreshCw size={18} /> Request a Regrade</h3>
      <p className="modal-sub">
        Politely explain why you believe a grade should be reviewed. Your teacher receives this in their messages and can reply to you.
      </p>

      <label className="field-label" htmlFor="regrade-subject">Subject</label>
      <select
        id="regrade-subject"
        className="input"
        value={subject}
        onChange={e => setSubject(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        {subjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
      </select>

      {currentGrade != null && (
        <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 12 }}>
          Current grade: <strong>{currentGrade.toFixed(1)}%</strong>
        </div>
      )}

      <label className="field-label" htmlFor="regrade-reason">Reason</label>
      <textarea
        id="regrade-reason"
        className="input"
        rows={5}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="e.g. I believe Activity 3 was not counted, or my quiz score looks incorrect…"
        maxLength={MAX_REASON}
        style={{ resize: 'vertical' }}
      />
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{reason.length}/{MAX_REASON}</div>

      <div className="flex justify-end gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={sending}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={sending}>
          {sending ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </Modal>
  )
}
