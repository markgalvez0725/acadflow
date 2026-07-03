import React, { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import Modal from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { getInitials, sortByLastName } from '@/utils/format'

const CYCLE = { present: 'late', late: 'absent', absent: 'present' }
const LABEL = { present: 'Present', late: 'Late', absent: 'Absent' }

// Attendance prefilled from an in-app class's join log (professor only).
// Opens automatically right after End class, and again anytime from the
// ended row in Online Classes. Statuses come from real join times:
//   joined                         -> Present
//   joined past the late threshold -> Late
//   never joined                   -> Absent
// Every pill is tappable to override before saving. Save writes through the
// SAME attendance model the Attendance tab uses - the attendance Set per
// subject, with Late kept a subset of attended (so rates and grades behave
// exactly as a hand-marked day). Absent adds nothing and never clears an
// excuse the student already has for that date.
export default function ClassAttendanceModal({ meeting, onClose }) {
  const { students, saveStudents, patchMeeting } = useData()
  const { toast } = useUI()
  const [thr, setThr] = useState(10)
  const [over, setOver] = useState({}) // studentId -> manual status override
  const [saving, setSaving] = useState(false)

  const subject = meeting?.subject || ''
  const startAt = meeting?.scheduledAt || meeting?.createdAt || Date.now()
  const dateStr = new Date(startAt).toLocaleDateString('en-CA')
  const dateNice = new Date(startAt).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeNice = new Date(startAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  const roster = useMemo(() => sortByLastName(
    (students || []).filter(s => s.classId === meeting?.classId || s.classIds?.includes(meeting?.classId))
  ), [students, meeting?.classId])

  // Earliest join time per student (the log can carry several sightings when
  // someone rejoined; earliest is what Late is judged on).
  const joined = useMemo(() => {
    const map = new Map()
    for (const e of meeting?.joinLog || []) {
      const cur = map.get(e.uid)
      if (cur === undefined || (e.joinedAt || 0) < cur) map.set(e.uid, e.joinedAt || 0)
    }
    return map
  }, [meeting?.joinLog])

  function autoStatus(s) {
    if (!joined.has(s.id)) return 'absent'
    return joined.get(s.id) > startAt + thr * 60000 ? 'late' : 'present'
  }
  const statusOf = s => over[s.id] || autoStatus(s)
  const wasExcused = s => (s.excuse?.[subject] || new Set()).has(dateStr)

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0 }
    for (const s of roster) c[statusOf(s)]++
    return c
  }, [roster, over, thr, joined]) // eslint-disable-line react-hooks/exhaustive-deps

  function cycle(s) {
    setOver(o => ({ ...o, [s.id]: CYCLE[statusOf(s)] }))
  }

  async function save() {
    if (saving || !roster.length) return
    setSaving(true)
    try {
      const ids = new Set(roster.map(s => s.id))
      const updated = students.map(s => {
        if (!ids.has(s.id)) return s
        const st = statusOf(s)
        const ns = { ...s, attendance: { ...s.attendance }, excuse: { ...s.excuse }, late: { ...s.late } }
        const att = new Set(ns.attendance[subject] || [])
        const exc = new Set(ns.excuse[subject] || [])
        const lat = new Set(ns.late[subject] || [])
        att.delete(dateStr)
        lat.delete(dateStr)
        if (st === 'present') { att.add(dateStr); exc.delete(dateStr) }
        else if (st === 'late') { att.add(dateStr); lat.add(dateStr); exc.delete(dateStr) }
        ns.attendance[subject] = att
        ns.excuse[subject] = exc
        ns.late[subject] = lat
        return ns
      })
      await saveStudents(updated, [...ids])
      try { await patchMeeting(meeting, { attMarkedAt: Date.now() }) } catch { /* row chip only */ }
      toast(`Attendance saved for ${dateNice}.`, 'success')
      onClose()
    } catch (e) {
      toast('Could not save attendance: ' + (e?.message || 'sync failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="md"
      padded={false}
      title="Attendance from this class"
      subtitle={[meeting?.className, subject, `${dateNice}, ${timeNice}`].filter(Boolean).join(' · ')}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Skip for now</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !roster.length || !subject}>
            {saving ? 'Saving…' : 'Save to Attendance'}
          </button>
        </>
      )}
    >
      <div className="catt">
        <div className="catt-top">
          <span className="catt-chip ok">Present {counts.present}</span>
          <span className="catt-chip la">Late {counts.late}</span>
          <span className="catt-chip ab">Absent {counts.absent}</span>
          <span className="catt-thr">
            <Clock size={12} /> Late after
            <span className="catt-seg">
              {[5, 10, 15].map(v => (
                <button key={v} type="button" className={thr === v ? 'on' : ''} onClick={() => setThr(v)}>{v}m</button>
              ))}
            </span>
          </span>
        </div>
        {!subject && (
          <div className="catt-note">
            This class was scheduled without a subject, so there is no attendance column to write into. You can still see who joined below.
          </div>
        )}
        <div className="catt-list">
          {roster.map(s => {
            const st = statusOf(s)
            const at = joined.get(s.id)
            const notes = [
              at ? `Joined ${new Date(at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : 'Did not join',
              over[s.id] ? 'edited by you' : '',
              st === 'absent' && subject && wasExcused(s) ? 'has an excuse for this day' : '',
            ].filter(Boolean).join(' · ')
            return (
              <div key={s.id} className="catt-row">
                <span className="catt-av" aria-hidden="true">
                  {s.photo ? <img src={s.photo} alt="" /> : getInitials(s.name)}
                </span>
                <div className="catt-body">
                  <b>{s.name}</b>
                  <span>{notes}</span>
                </div>
                <button type="button" className={`catt-pill ${st}`} onClick={() => cycle(s)} title="Tap to change: Present, Late, Absent">
                  {LABEL[st]}
                </button>
              </div>
            )
          })}
          {roster.length === 0 && <div className="catt-note">No students are enrolled in this class.</div>}
        </div>
        <div className="catt-hint">
          Prefilled from who actually joined the room. Late is measured from the scheduled start and still counts as attended, exactly like a hand-marked day in the Attendance tab.
        </div>
      </div>
    </Modal>
  )
}
