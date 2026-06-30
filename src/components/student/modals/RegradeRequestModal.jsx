import React, { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import Button from '@/components/ds/Button'
import { Select, Textarea } from '@/components/ds/Field'
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
 * as a normal message to the professor (type 'regrade_request') so it lands in
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
    if (text.length > MAX_REASON) { toast(`Reason too long - maximum ${MAX_REASON} characters.`, 'warn'); return }
    if (!fbReady || !db.current) { toast('Regrade requests require Firebase to be connected.', 'warn'); return }

    setSending(true)
    try {
      const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
      const gradeNote = currentGrade != null ? ` (current: ${currentGrade.toFixed(1)}%)` : ''
      const _ts = Date.now()
      const msg = {
        id: newId,
        from: s.id,
        to: 'admin',
        subject: `Regrade request: ${subject}${gradeNote}`,
        body: text,
        ts: _ts,
        lastActivityAt: _ts,
        read: [s.id],
        adminRead: false,
        replies: [],
        type: 'regrade_request',
        meta: { subject, currentGrade: currentGrade ?? null },
      }
      await setDoc(doc(db.current, 'messages', newId), msg)
      notifyAdminMessage(db.current, s.name || s.id, `Regrade request for ${subject}: ${text}`, 'message')
      toast('Regrade request sent to your professor.', 'green')
      onClose()
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={onClose} size="sm" sheetOnMobile
      header={<ModalHeader flush icon={<RefreshCw size={18} />} title="Request a Regrade" subtitle="Politely explain why you believe a grade should be reviewed. Your professor receives this in their messages and can reply to you." />}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>Cancel</Button>
        <Button size="sm" loading={sending} loadingText="Sending…" onClick={handleSubmit}>Send request</Button>
      </>}
    >
      <Select
        label="Subject"
        id="regrade-subject"
        value={subject}
        onChange={e => setSubject(e.target.value)}
      >
        {subjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
      </Select>

      {currentGrade != null && (
        <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 12 }}>
          Current grade: <strong>{currentGrade.toFixed(1)}%</strong>
        </div>
      )}

      <Textarea
        label="Reason"
        id="regrade-reason"
        rows={5}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="e.g. I believe Activity 3 was not counted, or my quiz score looks incorrect…"
        maxLength={MAX_REASON}
      />
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{reason.length}/{MAX_REASON}</div>
    </Modal>
  )
}
