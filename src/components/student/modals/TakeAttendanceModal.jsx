import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import { courseShort } from '@/constants/courses'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import Avatar from '@/components/primitives/Avatar'
import { CalendarDays, Check, ClipboardList, X, UserCheck } from 'lucide-react'

/**
 * TakeAttendanceModal - shown only to a student who is the designated rep for a subject.
 * Lets the rep mark attendance for their classmates for today only.
 */
export default function TakeAttendanceModal({ classId, subject, onClose }) {
  const { students, classes, saveStudents } = useData()
  const { toast } = useUI()

  const cls   = classes.find(c => c.id === classId)
  const studs = useMemo(
    () => sortByLastName(students.filter(s => s.classId === classId || s.classIds?.includes(classId))),
    [students, classId]
  )

  const today = new Date().toLocaleDateString('en-CA')
  const todayLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // Initialise statuses from existing records for today
  const [statuses, setStatuses] = useState(() => {
    const init = {}
    studs.forEach(s => {
      const isPresent = (s.attendance?.[subject] || new Set()).has(today)
      const isExcuse  = !isPresent && (s.excuse?.[subject] || new Set()).has(today)
      init[s.id] = isPresent ? 'present' : isExcuse ? 'excuse' : 'absent'
    })
    return init
  })
  const [saving, setSaving] = useState(false)

  const presentCount = Object.values(statuses).filter(v => v === 'present').length
  const excuseCount  = Object.values(statuses).filter(v => v === 'excuse').length
  const absentCount  = studs.length - presentCount - excuseCount

  function setStatus(studentId, status) {
    setStatuses(prev => ({ ...prev, [studentId]: status }))
  }

  function setAll(status) {
    const next = {}
    studs.forEach(s => { next[s.id] = status })
    setStatuses(next)
  }

  async function saveDay() {
    setSaving(true)
    const updated = students.map(s => {
      if (s.classId !== classId && !s.classIds?.includes(classId)) return s
      const ns  = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) } }
      const att = new Set(ns.attendance[subject] || [])
      const exc = new Set(ns.excuse[subject]     || [])
      att.delete(today)
      exc.delete(today)
      const st = statuses[s.id] || 'absent'
      if (st === 'present') att.add(today)
      else if (st === 'excuse') exc.add(today)
      ns.attendance[subject] = att
      ns.excuse[subject]     = exc
      return ns
    })
    try {
      await saveStudents(updated, studs.map(s => s.id))
      toast('Attendance saved!', 'green')
      onClose()
    } catch (e) {
      toast('Saved locally - sync failed: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} size="lg" sheetOnMobile
      header={<ModalHeader flush icon={<UserCheck size={18} />} title="Take Attendance" subtitle={<>{subject} · <span title={cls?.name || ''}>{courseShort(cls?.name)}</span> {cls?.section}</>} />}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={saveDay} disabled={saving}>
          {saving ? 'Saving…' : 'Save Attendance'}
        </button>
      </>}
    >
      {/* Date banner */}
      <div className="rounded-lg p-3 mb-3 flex items-center justify-between flex-wrap gap-2"
        style={{ background: 'var(--accent)' }}>
        <div className="font-bold text-sm text-white">
          <CalendarDays size={14} className="inline-block mr-1 align-text-bottom" />
          {todayLabel}
        </div>
        <div className="flex gap-2">
          {[
            { count: presentCount, label: 'PRESENT' },
            { count: excuseCount,  label: 'EXCUSED' },
            { count: absentCount,  label: 'ABSENT' },
            { count: studs.length, label: 'TOTAL' },
          ].map(({ count, label }) => (
            <div key={label} className="text-center rounded-lg px-3 py-1"
              style={{ background: 'rgba(255,255,255,.15)' }}>
              <div className="text-base font-bold text-white">{count}</div>
              <div className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,.7)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button className="btn btn-green btn-sm" onClick={() => setAll('present')}>
          <Check size={13} className="inline-block mr-1" />All Present
        </button>
        <button className="btn btn-sm" style={{ background: 'var(--purple-l)', color: 'var(--purple)' }}
          onClick={() => setAll('excuse')}>
          <ClipboardList size={13} className="inline-block mr-1" />All Excused
        </button>
        <button className="btn btn-danger btn-sm" onClick={() => setAll('absent')}>
          <X size={13} className="inline-block mr-1" />All Absent
        </button>
      </div>

      {/* Student list */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-ink2 grid"
          style={{ background: 'var(--bg)', gridTemplateColumns: '1fr auto', borderBottom: '1px solid var(--border)' }}>
          <span>Student</span><span>Status</span>
        </div>
        {studs.length === 0 && (
          <div className="p-5 text-center text-ink3">No students in this class.</div>
        )}
        {studs.map(s => {
          const st = statuses[s.id] || 'absent'
          const iconBg    = st === 'present' ? 'var(--green-l)'  : st === 'excuse' ? 'var(--purple-l)' : 'var(--red-l)'
          const iconColor = st === 'present' ? 'var(--green)'    : st === 'excuse' ? 'var(--purple)'   : 'var(--red)'
          return (
            <div key={s.id} className="att-row-item flex items-center justify-between gap-3 px-3.5 py-2"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar photo={s.photo} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: iconBg, color: iconColor, transition: '.2s' }}>
                  {(s.name || '?').charAt(0).toUpperCase()}
                </Avatar>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{s.name}</div>
                  <div className="text-xs text-ink2">{s.id}</div>
                </div>
              </div>
              <div className="att-toggle flex gap-1">
                {(['present', 'excuse', 'absent']).map(opt => {
                  const active = st === opt
                  const activeCls = opt === 'present' ? 'active-present' : opt === 'excuse' ? 'active-excuse' : 'active-absent'
                  const label = opt === 'present'
                    ? <><Check size={11} className="inline-block mr-0.5" />Present</>
                    : opt === 'excuse'
                      ? <><ClipboardList size={11} className="inline-block mr-0.5" />Excuse</>
                      : <><X size={11} className="inline-block mr-0.5" />Absent</>
                  return (
                    <button key={opt} type="button"
                      className={`att-toggle-btn ${active ? activeCls : ''}`}
                      onClick={() => setStatus(s.id, opt)}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-ink2 mt-2.5">
        Toggle each student's status then click Save. <ClipboardList size={12} className="inline-block mx-0.5 align-text-bottom" />
        Excused counts separately from absent. Attendance is locked to today's date.
      </p>

    </Modal>
  )
}
