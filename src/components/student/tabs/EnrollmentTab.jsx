import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Badge from '@/components/primitives/Badge'
import {
  BookOpen, CheckCircle2, XCircle, LockOpen, Lock,
  CalendarDays, Clock, MapPin, GraduationCap, Users,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────
function courseMatches(studentCourse, clsCourseReq) {
  if (!clsCourseReq) return true // no requirement = open to all
  return (studentCourse || '').trim().toLowerCase() === clsCourseReq.trim().toLowerCase()
}

// ── Enrollment status badge ───────────────────────────────────────────
function StatusBadge({ enrolled, open, matches }) {
  if (enrolled)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} />Enrolled</span>
  if (!matches)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full"><XCircle size={11} />Course Mismatch</span>
  if (!open)     return <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink3 bg-[var(--surface2)] px-2 py-0.5 rounded-full"><Lock size={11} />Closed</span>
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 px-2 py-0.5 rounded-full"><LockOpen size={11} />Open</span>
}

// ── Class Card ────────────────────────────────────────────────────────
function ClassCard({ cls, student, onEnroll, onUnenroll, busy }) {
  const enrolled = (student.classIds?.length
    ? student.classIds
    : student.classId ? [student.classId] : []
  ).includes(cls.id)

  const matches  = courseMatches(student.course, cls.courseReq)
  const canEnroll  = !enrolled && cls.enrollmentOpen && matches
  const canUnenroll = enrolled

  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{ opacity: (!cls.enrollmentOpen && !enrolled) ? 0.7 : 1 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm text-[var(--ink)]">{cls.name}</div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">Section <strong>{cls.section}</strong></div>
        </div>
        <StatusBadge enrolled={enrolled} open={cls.enrollmentOpen} matches={matches} />
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {cls.room && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink2)]">
            <MapPin size={11} className="shrink-0" />{cls.room}
          </div>
        )}
        {cls.schedule && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink2)]">
            <Clock size={11} className="shrink-0" />{cls.schedule}
          </div>
        )}
        {cls.activeSemester && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink2)] col-span-2">
            <CalendarDays size={11} className="shrink-0" />{cls.activeSemester}
          </div>
        )}
      </div>

      {/* Subjects */}
      {cls.subjects?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cls.subjects.map(sub => (
            <span key={sub} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface2)] text-[var(--ink3)]">{sub}</span>
          ))}
        </div>
      )}

      {/* Course requirement notice */}
      {!matches && (
        <div className="flex items-start gap-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-900/15 px-2.5 py-2 rounded-lg">
          <XCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            Requires <strong>{cls.courseReq || cls.name}</strong>.
            Your course is <strong>{student.course || 'not set'}</strong>.
          </span>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-1 flex gap-2">
        {canEnroll && (
          <button
            className="btn btn-primary btn-sm flex-1"
            onClick={() => onEnroll(cls.id)}
            disabled={busy}
          >
            {busy ? 'Enrolling…' : 'Enroll'}
          </button>
        )}
        {canUnenroll && (
          <button
            className="btn btn-ghost btn-sm flex-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => onUnenroll(cls.id)}
            disabled={busy}
          >
            {busy ? 'Removing…' : 'Unenroll'}
          </button>
        )}
        {!canEnroll && !canUnenroll && (
          <div className="text-xs text-[var(--ink3)] py-1">
            {!cls.enrollmentOpen ? 'Enrollment is currently closed.' : 'You are not eligible to enroll.'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
export default function EnrollmentTab({ student }) {
  const { classes, semester, enrollInClass, unenrollFromClass } = useData()
  const { toast, openDialog } = useUI()
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | 'enrolled' | 'available'

  const studentClassIds = useMemo(() =>
    student.classIds?.length
      ? student.classIds
      : student.classId ? [student.classId] : [],
    [student]
  )

  // Only show non-archived classes
  const activeClasses = useMemo(
    () => classes.filter(c => !c.archived),
    [classes]
  )

  const enrolledClasses   = useMemo(() => activeClasses.filter(c => studentClassIds.includes(c.id)), [activeClasses, studentClassIds])
  const availableClasses  = useMemo(() => activeClasses.filter(c => !studentClassIds.includes(c.id) && c.enrollmentOpen), [activeClasses, studentClassIds])
  const allVisible        = useMemo(() => activeClasses.filter(c =>
    filter === 'enrolled'  ? studentClassIds.includes(c.id) :
    filter === 'available' ? (!studentClassIds.includes(c.id) && c.enrollmentOpen) :
    true
  ), [activeClasses, studentClassIds, filter])

  async function handleEnroll(classId) {
    setBusyId(classId)
    try {
      await enrollInClass(student.id, classId)
      const cls = classes.find(c => c.id === classId)
      toast(`Enrolled in ${cls?.name} ${cls?.section}!`, 'green')
    } catch (e) {
      toast(e.message, 'red')
    } finally {
      setBusyId(null)
    }
  }

  async function handleUnenroll(classId) {
    const cls = classes.find(c => c.id === classId)
    const ok  = await openDialog({
      title: 'Unenroll from this class?',
      msg: `Remove yourself from "${cls?.name} ${cls?.section}"? Your grades and attendance records will be kept. You can re-enroll if enrollment is reopened.`,
      type: 'warn',
      confirmLabel: 'Unenroll',
      showCancel: true,
    })
    if (!ok) return
    setBusyId(classId)
    try {
      await unenrollFromClass(student.id, classId)
      toast(`Unenrolled from ${cls?.name} ${cls?.section}.`, 'blue')
    } catch (e) {
      toast(e.message, 'red')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Semester banner */}
      {semester && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${semester.status === 'active' ? 'bg-[var(--accent-l)] text-[var(--accent)]' : 'bg-[var(--surface2)] text-[var(--ink3)]'}`}>
          <CalendarDays className="w-3.5 h-3.5 shrink-0" />
          <span>
            Current semester: <strong>{semester.label || `${semester.term} AY ${semester.year}`}</strong>
            {semester.status === 'active' && <span className="ml-2 opacity-70">— Active</span>}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="sec-hdr">
        <div>
          <div className="sec-title">Class Enrollment</div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">
            You are enrolled in <strong>{enrolledClasses.length}</strong> class{enrolledClasses.length !== 1 ? 'es' : ''}.
            {availableClasses.length > 0 && ` ${availableClasses.length} class${availableClasses.length !== 1 ? 'es' : ''} open for enrollment.`}
          </div>
        </div>
      </div>

      {/* Student course info */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface2)] text-xs text-[var(--ink2)]">
        <GraduationCap size={14} className="shrink-0" />
        <span>Your course: <strong className="text-[var(--ink)]">{student.course || <em className="text-red-500">Not set — contact admin to update your profile</em>}</strong></span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-0">
        {[
          { id: 'all',       label: `All Classes (${activeClasses.length})` },
          { id: 'enrolled',  label: `My Enrollments (${enrolledClasses.length})` },
          { id: 'available', label: `Open for Enrollment (${availableClasses.length})` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`text-xs px-3 py-2 font-medium border-b-2 -mb-px transition-colors ${
              filter === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Class grid */}
      {allVisible.length === 0 ? (
        <div className="empty py-12">
          <div className="empty-icon"><BookOpen size={32} /></div>
          {filter === 'enrolled'
            ? 'You are not enrolled in any classes yet.'
            : filter === 'available'
            ? 'No classes are currently open for enrollment.'
            : 'No active classes found.'
          }
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {allVisible.map(cls => (
            <ClassCard
              key={cls.id}
              cls={cls}
              student={student}
              onEnroll={handleEnroll}
              onUnenroll={handleUnenroll}
              busy={busyId === cls.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
