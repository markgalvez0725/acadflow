import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { deserializeStudents } from '@/utils/attendance'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import Modal from '@/components/primitives/Modal'
import { Plus, Pencil, School } from 'lucide-react'

const PER_PAGE = 10

// ── Add Class Modal ───────────────────────────────────────────────────
function AddClassModal({ onClose }) {
  const { classes, students, saveClasses, saveStudents } = useData()
  const { toast } = useUI()
  const [name, setName]         = useState('')
  const [section, setSection]   = useState('')
  const [room, setRoom]         = useState('')
  const [schedule, setSchedule] = useState('')
  const [subjects, setSubjects] = useState('')
  const [err, setErr]           = useState('')
  const [saving, setSaving]     = useState(false)

  async function handleAdd() {
    setErr('')
    const subs = subjects.split(',').map(s => s.trim()).filter(Boolean)
    if (!name.trim() || !section.trim()) { setErr('Course name and section are required.'); return }
    if (!subs.length) { setErr('At least one subject is required.'); return }
    if (classes.find(c => c.name.toLowerCase() === name.trim().toLowerCase() && c.section.toLowerCase() === section.trim().toLowerCase())) {
      setErr(`Class "${name.trim()} ${section.trim()}" already exists.`); return
    }
    setSaving(true)
    try {
      const newClass = {
        id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
        name: name.trim(),
        section: section.trim(),
        room: room.trim() || 'TBA',
        schedule: schedule.trim() || 'TBA',
        subjects: subs,
      }
      await saveClasses([...classes, newClass])
      toast('Class added!', 'green')
      onClose()
    } catch (e) {
      setErr('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3><Plus size={18} className="inline-block mr-1 align-text-bottom" />Add New Class</h3>
      <p className="modal-sub">Fill in the class details below.</p>
      <div className="input-row">
        <div className="field">
          <label>Course Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="BS Computer Science" />
        </div>
        <div className="field">
          <label>Year &amp; Section <span className="text-red-500">*</span></label>
          <input value={section} onChange={e => setSection(e.target.value)} placeholder="2-A" />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Room Assigned</label>
          <input value={room} onChange={e => setRoom(e.target.value)} placeholder="Room 301-B" />
        </div>
        <div className="field">
          <label>Schedule</label>
          <input value={schedule} onChange={e => setSchedule(e.target.value)} placeholder="MWF 8:00–9:30 AM" />
        </div>
      </div>
      <div className="field">
        <label>
          Subjects <span className="text-red-500">*</span>{' '}
          <span className="font-normal text-xs text-ink2">(comma-separated)</span>
        </label>
        <input value={subjects} onChange={e => setSubjects(e.target.value)} placeholder="Calculus, Physics, Programming, English, PE" />
      </div>
      {err && <div className="err-msg mb-2">{err}</div>}
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
          {saving ? 'Saving…' : 'Add Class'}
        </button>
      </div>
    </Modal>
  )
}

// ── Edit Class Modal ──────────────────────────────────────────────────
function EditClassModal({ cls, onClose }) {
  const { classes, students, saveClasses, saveStudents } = useData()
  const { toast, openDialog } = useUI()
  const [name, setName]         = useState(cls.name)
  const [section, setSection]   = useState(cls.section)
  const [room, setRoom]         = useState(cls.room || '')
  const [schedule, setSchedule] = useState(cls.schedule || '')
  const [subjects, setSubjects] = useState(cls.subjects.join(', '))
  const [err, setErr]           = useState('')
  const [saving, setSaving]     = useState(false)

  async function handleSave() {
    setErr('')
    const subs = subjects.split(',').map(s => s.trim()).filter(Boolean)
    if (!name.trim() || !section.trim()) { setErr('Course name and section are required.'); return }
    if (!subs.length) { setErr('At least one subject is required.'); return }
    if (classes.find(c => c.id !== cls.id && c.name.toLowerCase() === name.trim().toLowerCase() && c.section.toLowerCase() === section.trim().toLowerCase())) {
      setErr(`Class "${name.trim()} ${section.trim()}" already exists.`); return
    }

    const removedSubs = cls.subjects.filter(s => !subs.includes(s))
    const addedSubs   = subs.filter(s => !cls.subjects.includes(s))

    if (removedSubs.length) {
      const affected = students.filter(s => s.classId === cls.id)
      const hasData  = affected.some(s =>
        removedSubs.some(sub => s.grades?.[sub] != null || (s.attendance?.[sub] && s.attendance[sub].size > 0))
      )
      if (hasData) {
        const ok = await openDialog({
          title: 'Remove subjects with data?',
          msg: `Removing "${removedSubs.join('", "')}" will permanently delete all grades and attendance records for those subjects. This cannot be undone.`,
          type: 'danger',
          confirmLabel: 'Remove & Delete Data',
          showCancel: true,
        })
        if (!ok) return
      }
    }

    setSaving(true)
    try {
      const updatedClasses = classes.map(c => {
        if (c.id !== cls.id) return c
        return { ...c, name: name.trim(), section: section.trim(), room: room.trim() || 'TBA', schedule: schedule.trim() || 'TBA', subjects: subs }
      })

      let updatedStudents = students
      const affectedStudentIds = []

      if (removedSubs.length || addedSubs.length) {
        updatedStudents = students.map(s => {
          if (s.classId !== cls.id) return s
          const ns = { ...s, grades: { ...s.grades }, attendance: { ...s.attendance }, excuse: { ...s.excuse } }
          if (s.gradeComponents) ns.gradeComponents = { ...s.gradeComponents }
          if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }
          removedSubs.forEach(sub => {
            delete ns.grades[sub]
            delete ns.attendance[sub]
            delete ns.excuse[sub]
            if (ns.gradeComponents) delete ns.gradeComponents[sub]
            if (ns.gradeUploadedAt) delete ns.gradeUploadedAt[sub]
          })
          addedSubs.forEach(sub => {
            if (ns.grades[sub] === undefined)  ns.grades[sub] = null
            if (!ns.attendance[sub])           ns.attendance[sub] = new Set()
            if (!ns.excuse[sub])               ns.excuse[sub] = new Set()
          })
          affectedStudentIds.push(s.id)
          return ns
        })
      }

      await saveClasses(updatedClasses)
      if (affectedStudentIds.length) {
        await saveStudents(updatedStudents, affectedStudentIds)
      }
      toast('Class updated!', 'green')
      onClose()
    } catch (e) {
      setErr('Saved locally but Firebase sync failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3><Pencil size={18} className="inline-block mr-1 align-text-bottom" />Edit Class</h3>
      <p className="modal-sub">Update class details and subjects below.</p>
      <div className="input-row">
        <div className="field">
          <label>Course Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="BS Computer Science" />
        </div>
        <div className="field">
          <label>Year &amp; Section <span className="text-red-500">*</span></label>
          <input value={section} onChange={e => setSection(e.target.value)} placeholder="2-A" />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Room Assigned</label>
          <input value={room} onChange={e => setRoom(e.target.value)} placeholder="Room 301-B" />
        </div>
        <div className="field">
          <label>Schedule</label>
          <input value={schedule} onChange={e => setSchedule(e.target.value)} placeholder="MWF 8:00–9:30 AM" />
        </div>
      </div>
      <div className="field">
        <label>
          Subjects <span className="text-red-500">*</span>{' '}
          <span className="font-normal text-xs text-ink2">(comma-separated)</span>
        </label>
        <input value={subjects} onChange={e => setSubjects(e.target.value)} placeholder="Calculus, Physics, Programming" />
      </div>
      {err && <div className="err-msg mb-2">{err}</div>}
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </Modal>
  )
}

// ── Classes Tab ───────────────────────────────────────────────────────
export default function ClassesTab() {
  const { classes, students, saveClasses, saveStudents } = useData()
  const { toast, openDialog } = useUI()
  const [page, setPage]           = useState(1)
  const [showAdd, setShowAdd]     = useState(false)
  const [editClass, setEditClass] = useState(null)

  const slice = useMemo(
    () => classes.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [classes, page]
  )

  async function handleDelete(cls) {
    const studsInClass = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
    const msg = studsInClass > 0
      ? `Delete "${cls.name} ${cls.section}"? ${studsInClass} student${studsInClass !== 1 ? 's' : ''} will be unassigned. This cannot be undone.`
      : `Delete "${cls.name} ${cls.section}"? This cannot be undone.`
    const ok = await openDialog({ title: 'Delete this class?', msg, type: 'danger', confirmLabel: 'Delete Class', showCancel: true })
    if (!ok) return

    const classesBackup  = classes.slice()
    const unassigned     = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id))
    const updatedClasses = classes.filter(c => c.id !== cls.id)
    const updatedStudents = students.map(s => {
      const newStudent = { ...s }
      if (s.classId === cls.id) newStudent.classId = null
      if (s.classIds?.includes(cls.id)) newStudent.classIds = s.classIds.filter(id => id !== cls.id)
      return newStudent
    })

    try {
      await saveClasses(updatedClasses)
      if (unassigned.length) await saveStudents(updatedStudents, unassigned.map(s => s.id))
      if (page > 1 && slice.length === 1) setPage(p => p - 1)
    } catch (e) {
      toast('Could not delete class: ' + e.message, 'red')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="sec-hdr mb-3">
        <div className="sec-title">Classes</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Class</button>
        </div>
      </div>

      {/* Table */}
      {!classes.length ? (
        <div className="empty"><div className="empty-icon"><School size={32} /></div>No classes yet.</div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Section</th>
                  <th>Room</th>
                  <th>Schedule</th>
                  <th>Subjects</th>
                  <th>Students</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {slice.map(cls => {
                  const cnt = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
                  return (
                    <tr key={cls.id}>
                      <td><strong>{cls.name}</strong></td>
                      <td><Badge variant="blue">{cls.section}</Badge></td>
                      <td>{cls.room}</td>
                      <td style={{ fontSize: 12 }}>{cls.schedule}</td>
                      <td><small className="text-ink2">{cls.subjects?.join(', ')}</small></td>
                      <td>{cnt}</td>
                      <td>
                        <div className="flex gap-1.5 flex-wrap">
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditClass(cls)}><Pencil size={13} className="inline-block mr-1" />Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cls)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={classes.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}

      {/* Modals */}
      {showAdd  && <AddClassModal onClose={() => setShowAdd(false)} />}
      {editClass && <EditClassModal cls={editClass} onClose={() => setEditClass(null)} />}
    </div>
  )
}
