import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import Modal from '@/components/primitives/Modal'
import KebabMenu from '@/components/primitives/KebabMenu'
import { Plus, Pencil, School, Archive, ArchiveRestore, CalendarDays, Users, LockOpen, Lock, CheckCircle2, Copy, FileText, Trash2, Clock, MapPin, Search } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { buildClassReportCards } from '@/export/reportCard'
import { courseOptions } from '@/constants/courses'

const PER_PAGE = 12

// Suggest the next section label when duplicating (2-A → 2-B, Sec1 → Sec2).
function suggestNextSection(section = '') {
  const letter = section.match(/^(.*?)([A-Za-z])$/)
  if (letter) return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1)
  const num = section.match(/^(.*?)(\d+)$/)
  if (num) return num[1] + (parseInt(num[2], 10) + 1)
  return ''
}

// ── Add Class Modal ───────────────────────────────────────────────────
function AddClassModal({ onClose, prefill = null }) {
  const { classes, saveClasses, semester } = useData()
  const { toast } = useUI()
  const isDuplicate = !!prefill
  const [name, setName]                 = useState(prefill?.name || '')
  const [section, setSection]           = useState(prefill?.section || '')
  const [room, setRoom]                 = useState(prefill?.room || '')
  const [schedule, setSchedule]         = useState(prefill?.schedule || '')
  const [subjects, setSubjects]         = useState(prefill?.subjects || '')
  const [courseReq, setCourseReq]       = useState(prefill?.courseReq || '')
  const [enrollmentOpen, setEnrollmentOpen] = useState(
    prefill ? !!prefill.enrollmentOpen : semester?.status === 'active'
  )
  const autoSemLabel = semester ? (semester.label || `${semester.term} AY ${semester.year}`) : null
  const [err, setErr]           = useState('')
  const [saving, setSaving]     = useState(false)

  async function handleAdd() {
    setErr('')
    const subs = subjects.split(',').map(s => s.trim()).filter(Boolean)
    if (!name.trim() || !section.trim()) { setErr('Course name and section are required.'); return }
    if (!subs.length) { setErr('At least one subject is required.'); return }
    const duplicate = classes.find(c =>
      !c.archived &&
      c.name.toLowerCase() === name.trim().toLowerCase() &&
      c.section.toLowerCase() === section.trim().toLowerCase() &&
      subs.some(sub => c.subjects?.map(s => s.toLowerCase()).includes(sub.toLowerCase()))
    )
    if (duplicate) {
      const overlap = subs.filter(sub => duplicate.subjects?.map(s => s.toLowerCase()).includes(sub.toLowerCase()))
      setErr(`Subject${overlap.length > 1 ? 's' : ''} "${overlap.join('", "')}" already exist${overlap.length > 1 ? '' : 's'} in ${duplicate.name} ${duplicate.section}.`); return
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
        courseReq: courseReq.trim() || name.trim(),
        activeSemester: autoSemLabel,
        enrollmentOpen,
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
      <h3>
        {isDuplicate
          ? <><Copy size={18} className="inline-block mr-1 align-text-bottom" />Duplicate to New Section</>
          : <><Plus size={18} className="inline-block mr-1 align-text-bottom" />Add New Class</>}
      </h3>
      <p className="modal-sub">
        {isDuplicate
          ? 'Same course and subjects, new section. Set a unique section, then save.'
          : 'Fill in the class details below.'}
      </p>
      <div className="input-row">
        <div className="field">
          <label>Course Name <span className="text-red-500">*</span></label>
          <select value={name} onChange={e => { setName(e.target.value); if (!courseReq) setCourseReq(e.target.value) }}>
            <option value="">— Select course —</option>
            {courseOptions(name).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
      <div className="input-row">
        <div className="field">
          <label>
            Course Requirement{' '}
            <span className="font-normal text-xs text-ink2">(students must match this course to enroll)</span>
          </label>
          <select value={courseReq} onChange={e => setCourseReq(e.target.value)}>
            <option value="">— Same as course name —</option>
            {courseOptions(courseReq).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semester</label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface2)] text-xs text-ink2">
            {autoSemLabel ? (
              <>
                <CalendarDays size={13} className="shrink-0 text-ink3" />
                <span>{autoSemLabel}</span>
                <span className={`ml-1 font-semibold px-1.5 py-0.5 rounded-full ${
                  semester.status === 'active'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  semester.status === 'ended'   ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                                  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                }`}>
                  {semester.status === 'active' ? 'Open / Active' : semester.status === 'ended' ? 'Ended' : 'Upcoming'}
                </span>
              </>
            ) : <span className="text-ink3">No semester configured</span>}
          </div>
        </div>
      </div>
      <div className="field">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={enrollmentOpen} onChange={e => setEnrollmentOpen(e.target.checked)} className="w-4 h-4 rounded" />
          <span>Open for student enrollment</span>
          {enrollmentOpen
            ? <span className="text-xs text-green-600 font-medium">(Students can self-enroll)</span>
            : <span className="text-xs text-ink3">(Enrollment closed)</span>
          }
        </label>
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
  const { classes, students, saveClasses, saveStudents, semester } = useData()
  const { toast, openDialog } = useUI()
  const [name, setName]                 = useState(cls.name)
  const [section, setSection]           = useState(cls.section)
  const [room, setRoom]                 = useState(cls.room || '')
  const [schedule, setSchedule]         = useState(cls.schedule || '')
  const [subjects, setSubjects]         = useState(cls.subjects.join(', '))
  const [courseReq, setCourseReq]       = useState(cls.courseReq || cls.name)
  const [enrollmentOpen, setEnrollmentOpen] = useState(cls.enrollmentOpen || false)
  const autoSemLabel = semester ? (semester.label || `${semester.term} AY ${semester.year}`) : cls.activeSemester || null
  const [err, setErr]           = useState('')
  const [saving, setSaving]     = useState(false)

  async function handleSave() {
    setErr('')
    const subs = subjects.split(',').map(s => s.trim()).filter(Boolean)
    if (!name.trim() || !section.trim()) { setErr('Course name and section are required.'); return }
    if (!subs.length) { setErr('At least one subject is required.'); return }
    const duplicate = classes.find(c =>
      c.id !== cls.id &&
      !c.archived &&
      c.name.toLowerCase() === name.trim().toLowerCase() &&
      c.section.toLowerCase() === section.trim().toLowerCase() &&
      subs.some(sub => c.subjects?.map(s => s.toLowerCase()).includes(sub.toLowerCase()))
    )
    if (duplicate) {
      const overlap = subs.filter(sub => duplicate.subjects?.map(s => s.toLowerCase()).includes(sub.toLowerCase()))
      setErr(`Subject${overlap.length > 1 ? 's' : ''} "${overlap.join('", "')}" already exist${overlap.length > 1 ? '' : 's'} in another class with the same section.`); return
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
        return { ...c, name: name.trim(), section: section.trim(), room: room.trim() || 'TBA', schedule: schedule.trim() || 'TBA', subjects: subs, courseReq: courseReq.trim() || name.trim(), activeSemester: autoSemLabel, enrollmentOpen }
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
          <select value={name} onChange={e => setName(e.target.value)}>
            <option value="">— Select course —</option>
            {courseOptions(name).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
      <div className="input-row">
        <div className="field">
          <label>
            Course Requirement{' '}
            <span className="font-normal text-xs text-ink2">(students must match this course to enroll)</span>
          </label>
          <select value={courseReq} onChange={e => setCourseReq(e.target.value)}>
            <option value="">— Same as course name —</option>
            {courseOptions(courseReq).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semester</label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface2)] text-xs text-ink2">
            {autoSemLabel ? (
              <>
                <CalendarDays size={13} className="shrink-0 text-ink3" />
                <span>{autoSemLabel}</span>
                {semester && (
                  <span className={`ml-1 font-semibold px-1.5 py-0.5 rounded-full ${
                    semester.status === 'active'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    semester.status === 'ended'   ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}>
                    {semester.status === 'active' ? 'Open / Active' : semester.status === 'ended' ? 'Ended' : 'Upcoming'}
                  </span>
                )}
              </>
            ) : <span className="text-ink3">No semester configured</span>}
          </div>
        </div>
      </div>
      <div className="field">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={enrollmentOpen} onChange={e => setEnrollmentOpen(e.target.checked)} className="w-4 h-4 rounded" />
          <span>Open for student enrollment</span>
          {enrollmentOpen
            ? <span className="text-xs text-green-600 font-medium">(Students can self-enroll)</span>
            : <span className="text-xs text-ink3">(Enrollment closed)</span>
          }
        </label>
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
  const { classes, students, saveClasses, saveStudents, archiveClassWithStudents, unarchiveClassWithStudents, deleteClass, semester, eqScale, fbReady } = useData()
  const { toast, openDialog } = useUI()
  const [page, setPage]           = useState(1)
  const [showAdd, setShowAdd]     = useState(false)
  const [editClass, setEditClass] = useState(null)
  const [duplicateFrom, setDuplicateFrom] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [subjectFilter, setSubjectFilter] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [search, setSearch] = useState('')
  const [reportingId, setReportingId] = useState(null)

  // Unique subjects across the visible (active/archived) classes — for the filter.
  const allSubjects = useMemo(() => {
    const set = new Set()
    classes.forEach(c => {
      if (showArchived ? c.archived : !c.archived) (c.subjects || []).forEach(s => set.add(s))
    })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [classes, showArchived])

  const filtered = useMemo(
    () => {
      const q = search.trim().toLowerCase()
      return classes.filter(c =>
        (showArchived ? c.archived : !c.archived) &&
        (!subjectFilter || c.subjects?.includes(subjectFilter)) &&
        (!q || `${c.name} ${c.section}`.toLowerCase().includes(q) || c.subjects?.some(s => s.toLowerCase().includes(q)))
      )
    },
    [classes, showArchived, subjectFilter, search]
  )

  function duplicateClass(cls) {
    setDuplicateFrom({
      name: cls.name,
      section: suggestNextSection(cls.section),
      room: cls.room && cls.room !== 'TBA' ? cls.room : '',
      schedule: cls.schedule && cls.schedule !== 'TBA' ? cls.schedule : '',
      subjects: (cls.subjects || []).join(', '),
      courseReq: cls.courseReq || cls.name,
      enrollmentOpen: cls.enrollmentOpen,
    })
  }

  const slice = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page]
  )

  async function handleToggleEnrollment(cls) {
    const newState = !cls.enrollmentOpen
    setTogglingId(cls.id)
    try {
      const updatedClasses = classes.map(c =>
        c.id === cls.id ? { ...c, enrollmentOpen: newState } : c
      )
      await saveClasses(updatedClasses)
      toast(newState ? `Enrollment opened for ${cls.name} ${cls.section}` : `Enrollment closed for ${cls.name} ${cls.section}`, newState ? 'green' : 'blue')
    } catch (e) {
      toast('Could not update enrollment status: ' + e.message, 'red')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleArchive(cls) {
    if (cls.archived) {
      // Unarchiving: restore students and their subject data from archivedSemesters
      const restorable = students.filter(s =>
        s.archivedSemesters?.some(e => e.classId === cls.id)
      ).length
      const studentNote = restorable > 0
        ? ` ${restorable} previously enrolled student${restorable !== 1 ? 's' : ''} will be automatically re-enrolled and their data restored.`
        : ''
      const ok = await openDialog({
        title: 'Unarchive this class?',
        msg: `Unarchive "${cls.name} ${cls.section}"? It will become active again.${studentNote}`,
        type: 'info',
        confirmLabel: 'Unarchive Class',
        showCancel: true,
      })
      if (!ok) return
      try {
        await unarchiveClassWithStudents(cls)
        toast(
          restorable > 0
            ? `Class unarchived. ${restorable} student${restorable !== 1 ? 's' : ''} re-enrolled with data restored.`
            : 'Class unarchived.',
          'green'
        )
        if (page > 1 && slice.length === 1) setPage(p => p - 1)
      } catch (e) {
        toast('Could not unarchive class: ' + e.message, 'red')
      }
    } else {
      // Archiving: snapshot + clear student subject data
      const enrolledCount = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
      const studentNote = enrolledCount > 0
        ? ` ${enrolledCount} enrolled student${enrolledCount !== 1 ? 's' : ''} will have their subject records for this class automatically saved to their Academic History and cleared from their active profile.`
        : ''
      const ok = await openDialog({
        title: 'Archive this class?',
        msg: `Archive "${cls.name} ${cls.section}"?${studentNote} Students can be re-enrolled when the new semester begins.`,
        type: 'warn',
        confirmLabel: 'Archive & Snapshot Data',
        showCancel: true,
      })
      if (!ok) return
      try {
        await archiveClassWithStudents(cls)
        toast(
          enrolledCount > 0
            ? `Class archived. Subject records for ${enrolledCount} student${enrolledCount !== 1 ? 's' : ''} saved to Academic History.`
            : 'Class archived.',
          'green'
        )
        if (page > 1 && slice.length === 1) setPage(p => p - 1)
      } catch (e) {
        toast('Could not archive class: ' + e.message, 'red')
      }
    }
  }

  async function handleReportCards(cls) {
    if (reportingId) return
    const cnt = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
    if (!cnt) {
      toast(`No students enrolled in ${cls.name} ${cls.section} — nothing to export.`, 'blue')
      return
    }
    setReportingId(cls.id)
    try {
      await buildClassReportCards(cls, { classes, students, eqScale, semester })
      toast(`Report cards generated for ${cls.name} ${cls.section}.`, 'green')
    } catch (e) {
      toast('Could not generate report cards: ' + e.message, 'red')
    } finally {
      setReportingId(null)
    }
  }

  async function handleDelete(cls) {
    const studsInClass = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
    const msg = studsInClass > 0
      ? `Delete "${cls.name} ${cls.section}"? ${studsInClass} student${studsInClass !== 1 ? 's' : ''} will be unassigned and all class data (grades, attendance, activities, announcements, meetings) will be permanently deleted. This cannot be undone.`
      : `Delete "${cls.name} ${cls.section}"? All class data (activities, announcements, meetings) will be permanently deleted. This cannot be undone.`
    const ok = await openDialog({ title: 'Delete this class?', msg, type: 'danger', confirmLabel: 'Delete Class', showCancel: true })
    if (!ok) return

    try {
      await deleteClass(cls)
      if (page > 1 && slice.length === 1) setPage(p => p - 1)
    } catch (e) {
      toast('Could not delete class: ' + e.message, 'red')
    }
  }

  if (!fbReady) return <SkeletonTable />

  const semLabel = semester ? (semester.label || `${semester.term} AY ${semester.year}`) : null
  const semClasses = semLabel ? classes.filter(c => !c.archived && c.activeSemester === semLabel) : []
  const semOpenCount = semClasses.filter(c => c.enrollmentOpen).length

  return (
    <div>
      {/* Semester indicator with enrollment summary */}
      {semester && (
        <div className={`flex items-center justify-between gap-3 mb-3 px-3 py-2.5 rounded-lg text-xs font-medium flex-wrap ${semester.status === 'active' ? 'bg-[var(--accent-l)] text-[var(--accent)]' : 'bg-[var(--surface2)] text-[var(--ink3)]'}`}>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>{semLabel}</strong>
              {' — '}
              {semester.status === 'active' ? 'Active Semester' : semester.status === 'ended' ? 'Semester Ended' : 'Upcoming Semester'}
            </span>
          </div>
          {semClasses.length > 0 && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={12} className={semester.status === 'active' ? 'text-green-600' : ''} />
              <span className={semester.status === 'active' ? 'text-green-700 dark:text-green-400' : ''}>
                <strong>{semOpenCount}</strong> / {semClasses.length} classes have enrollment open
              </span>
            </div>
          )}
          {semClasses.length === 0 && !showArchived && (
            <span className="opacity-70">No classes assigned to this semester yet</span>
          )}
        </div>
      )}

      {/* Header */}
      <div className="sec-hdr mb-3">
        <div className="sec-title">Classes</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div style={{ position: 'relative', flex: '1 1 160px', minWidth: 150 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
            <input
              className="input"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search course or section"
              style={{ height: 32, paddingLeft: 32, fontSize: 13 }}
            />
          </div>
          {allSubjects.length > 0 && (
            <select
              value={subjectFilter}
              onChange={e => { setSubjectFilter(e.target.value); setPage(1) }}
              title="Show all sections of a subject"
              style={{
                height: 32, padding: '0 10px', borderRadius: 8, fontSize: 13,
                background: 'var(--surface2)', border: `1px solid ${subjectFilter ? 'var(--accent)' : 'var(--border)'}`,
                color: subjectFilter ? 'var(--accent)' : 'var(--ink2)', cursor: 'pointer', maxWidth: 180,
              }}
            >
              <option value="">All subjects</option>
              {allSubjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button
            className={`btn btn-sm ${showArchived ? 'btn-ghost' : 'btn-ghost'}`}
            onClick={() => { setShowArchived(v => !v); setSubjectFilter(''); setPage(1) }}
          >
            {showArchived ? <><ArchiveRestore size={14} className="inline-block mr-1" />Active</> : <><Archive size={14} className="inline-block mr-1" />Archived</>}
          </button>
          {!showArchived && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Class</button>}
        </div>
      </div>

      {/* Subject grouping summary */}
      {subjectFilter && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 flex-wrap" style={{ background: 'var(--accent-l)', color: 'var(--accent)' }}>
          <School size={13} className="shrink-0" />
          <span>
            <strong>{filtered.length}</strong> section{filtered.length !== 1 ? 's' : ''} of <strong>{subjectFilter}</strong>
            {' · '}
            <strong>{filtered.reduce((sum, c) => sum + students.filter(s => s.classId === c.id || s.classIds?.includes(c.id)).length, 0)}</strong> students total
          </span>
          <button className="link-btn ml-auto" style={{ color: 'var(--accent)' }} onClick={() => { setSubjectFilter(''); setPage(1) }}>Clear</button>
        </div>
      )}

      {/* Table */}
      {!filtered.length ? (
        <div className="empty"><div className="empty-icon"><School size={32} /></div>{(search || subjectFilter) ? 'No classes match your search.' : showArchived ? 'No archived classes.' : 'No classes yet.'}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))', gap: 12 }}>
            {slice.map(cls => {
              const cnt = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id)).length
              const archivedCnt = students.filter(s => s.archivedSemesters?.some(e => e.classId === cls.id)).length
              const subs = cls.subjects || []
              return (
                <div key={cls.id} style={{
                  background: cls.archived ? 'var(--surface2)' : 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 14, padding: 14,
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  {/* Header: course + section, kebab */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', lineHeight: 1.3 }}>{cls.name}</div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        <Badge variant="blue">{cls.section}</Badge>
                        {cls.archived && <Badge variant="yellow">Archived</Badge>}
                      </div>
                    </div>
                    <KebabMenu
                      label={`Actions for ${cls.name} ${cls.section}`}
                      items={[
                        !cls.archived && { label: <><Pencil size={13} className="inline-block mr-2 align-text-bottom" />Edit</>, onClick: () => setEditClass(cls) },
                        !cls.archived && { label: <><Copy size={13} className="inline-block mr-2 align-text-bottom" />Duplicate</>, onClick: () => duplicateClass(cls) },
                        { label: <><FileText size={13} className="inline-block mr-2 align-text-bottom" />Report cards</>, onClick: () => handleReportCards(cls) },
                        {
                          label: cls.archived
                            ? <><ArchiveRestore size={13} className="inline-block mr-2 align-text-bottom" />Unarchive</>
                            : <><Archive size={13} className="inline-block mr-2 align-text-bottom" />Archive</>,
                          onClick: () => handleArchive(cls),
                        },
                        { label: <><Trash2 size={13} className="inline-block mr-2 align-text-bottom" />Delete</>, onClick: () => handleDelete(cls), danger: true },
                      ]}
                    />
                  </div>

                  {/* Room + schedule */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}><MapPin size={13} className="text-ink3 shrink-0" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cls.room || 'TBA'}</span></span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}><Clock size={13} className="text-ink3 shrink-0" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cls.schedule || 'TBA'}</span></span>
                  </div>

                  {/* Subject chips */}
                  {subs.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {subs.slice(0, 4).map(s => (
                        <span key={s} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: cls.archived ? 'var(--surface)' : 'var(--surface2)', color: 'var(--ink2)' }}>{s}</span>
                      ))}
                      {subs.length > 4 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, color: 'var(--ink3)' }} title={subs.slice(4).join(', ')}>+{subs.length - 4}</span>
                      )}
                    </div>
                  )}

                  {/* Footer: students + enrollment */}
                  <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Users size={13} className="text-ink3" />
                      {cls.archived ? `0 active · ${archivedCnt} archived` : `${cnt} student${cnt !== 1 ? 's' : ''}`}
                    </span>
                    {!cls.archived ? (
                      <button
                        onClick={() => handleToggleEnrollment(cls)}
                        disabled={togglingId === cls.id}
                        title={cls.enrollmentOpen ? 'Click to close enrollment' : 'Click to open enrollment'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
                          padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                          border: '1px solid ' + (cls.enrollmentOpen ? 'rgba(34,197,94,0.3)' : 'var(--border)'),
                          background: cls.enrollmentOpen ? 'rgba(34,197,94,0.12)' : 'var(--surface2)',
                          color: cls.enrollmentOpen ? 'var(--green)' : 'var(--ink3)',
                          opacity: togglingId === cls.id ? 0.6 : 1,
                        }}
                      >
                        {cls.enrollmentOpen
                          ? <><LockOpen size={12} />Open</>
                          : <><Lock size={12} />Closed</>}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>Past semester</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination total={filtered.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}

      {/* Modals */}
      {(showAdd || duplicateFrom) && (
        <AddClassModal
          prefill={duplicateFrom}
          onClose={() => { setShowAdd(false); setDuplicateFrom(null) }}
        />
      )}
      {editClass && <EditClassModal cls={editClass} onClose={() => setEditClass(null)} />}
    </div>
  )
}
