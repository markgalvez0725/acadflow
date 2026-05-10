import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Badge from '@/components/primitives/Badge'
import {
  BookOpen, CheckCircle2, XCircle, LockOpen, Lock,
  CalendarDays, Clock, MapPin, GraduationCap, Users, MessageSquare,
  AlertTriangle, Sparkles, TimerOff, Bell, Archive, ChevronDown, ChevronRight,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────
function courseMatches(studentCourse, clsCourseReq) {
  if (!clsCourseReq) return true // no requirement = open to all
  return (studentCourse || '').trim().toLowerCase() === clsCourseReq.trim().toLowerCase()
}

function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

// ── Semester Status Banner ────────────────────────────────────────────
function SemesterBanner({ semester }) {
  if (!semester) return null

  const semLabel = semester.label || `${semester.term} AY ${semester.year}`
  const startFmt = fmtDate(semester.startDate)
  const endFmt   = fmtDate(semester.endDate)

  if (semester.status === 'active') {
    return (
      <div className="rounded-xl border border-green-300 dark:border-green-700/50 bg-green-50 dark:bg-green-900/20 px-4 py-3.5 flex items-start gap-3">
        <Sparkles size={18} className="shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-green-700 dark:text-green-300">
            Enrollment is now open!
          </div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
            <strong>{semLabel}</strong> — Pre-enrollment period is currently active. Select and enroll in your classes below.
          </div>
          {endFmt && (
            <div className="flex items-center gap-1 text-[11px] text-green-600/80 dark:text-green-400/70 mt-1.5">
              <Clock size={10} className="shrink-0" />
              Enrollment deadline: <strong className="ml-1">{endFmt}</strong>
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-600 text-white">OPEN</span>
      </div>
    )
  }

  if (semester.status === 'upcoming') {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3.5 flex items-start gap-3">
        <Bell size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-amber-700 dark:text-amber-300">
            Upcoming: {semLabel}
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
            Enrollment has not opened yet. Check back when the semester starts.
          </div>
          {startFmt && (
            <div className="flex items-center gap-1 text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-1.5">
              <CalendarDays size={10} className="shrink-0" />
              Semester starts: <strong className="ml-1">{startFmt}</strong>
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">UPCOMING</span>
      </div>
    )
  }

  if (semester.status === 'ended') {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 flex items-start gap-3">
        <TimerOff size={18} className="shrink-0 mt-0.5 text-[var(--ink3)]" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-[var(--ink2)]">
            {semLabel} — Enrollment Closed
          </div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">
            The enrollment period for this semester has ended. Contact your teacher for any changes.
          </div>
          {endFmt && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--ink3)] mt-1.5">
              <CalendarDays size={10} className="shrink-0" />
              Enrollment closed: <strong className="ml-1">{endFmt}</strong>
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ink3)] text-white">ENDED</span>
      </div>
    )
  }

  // Fallback — unknown status
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface2)] text-xs text-[var(--ink3)]">
      <CalendarDays className="w-3.5 h-3.5 shrink-0" />
      <span>Current semester: <strong className="text-[var(--ink2)]">{semLabel}</strong></span>
    </div>
  )
}

// ── Enrollment status badge ───────────────────────────────────────────
function StatusBadge({ enrolled, open, matches }) {
  if (enrolled)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} />Enrolled</span>
  if (!matches)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full"><XCircle size={11} />Course Mismatch</span>
  if (!open)     return <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink3 bg-[var(--surface2)] px-2 py-0.5 rounded-full"><Lock size={11} />Closed</span>
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 px-2 py-0.5 rounded-full"><LockOpen size={11} />Open</span>
}

// ── Archived Class Card ───────────────────────────────────────────────
function ArchivedClassCard({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const subjects = entry.subjects ? Object.entries(entry.subjects) : []
  const archivedDate = entry.archivedAt
    ? new Date(entry.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Archive size={14} className="shrink-0 text-[var(--ink3)]" />
          <div className="min-w-0">
            <div className="font-medium text-sm text-[var(--ink)] truncate">
              {entry.className}
              {entry.section && <span className="text-[var(--ink3)] font-normal"> · Section {entry.section}</span>}
            </div>
            <div className="text-xs text-[var(--ink3)] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {entry.semester && <span>{entry.semester}</span>}
              {archivedDate && <span>Archived {archivedDate}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--surface2)] text-[var(--ink3)] border border-[var(--border)]">
            ARCHIVED
          </span>
          {expanded
            ? <ChevronDown size={14} className="text-[var(--ink3)]" />
            : <ChevronRight size={14} className="text-[var(--ink3)]" />
          }
        </div>
      </div>

      {expanded && subjects.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-2 bg-[var(--surface2)]/50">
          <div className="text-[11px] font-semibold text-[var(--ink3)] uppercase tracking-wide mb-1">Subjects</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {subjects.map(([sub, data]) => {
              const grade = data.grade != null ? data.grade : null
              const attDays = data._att?.length ?? 0
              return (
                <div key={sub} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--ink)] truncate">{sub}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {grade != null ? (
                      <span className="text-xs font-semibold text-[var(--accent)]">{grade}</span>
                    ) : (
                      <span className="text-xs text-[var(--ink3)]">—</span>
                    )}
                    {attDays > 0 && (
                      <span className="text-[10px] text-[var(--ink3)]">{attDays}d</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded && subjects.length === 0 && (
        <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--ink3)] bg-[var(--surface2)]/50">
          No subject data recorded for this class.
        </div>
      )}
    </div>
  )
}

// ── Class Card ────────────────────────────────────────────────────────
function ClassCard({ cls, student, onEnroll, busy, isCurrentSem, semesterStatus }) {
  const enrolled = (student.classIds?.length
    ? student.classIds
    : student.classId ? [student.classId] : []
  ).includes(cls.id)

  const matches  = courseMatches(student.course, cls.courseReq)
  const canEnroll  = !enrolled && cls.enrollmentOpen && matches

  return (
    <div
      className={`rounded-xl border bg-[var(--surface)] p-4 flex flex-col gap-3 transition-shadow hover:shadow-md ${isCurrentSem ? 'border-[var(--accent)]/40' : 'border-[var(--border)]'}`}
      style={{ opacity: (!cls.enrollmentOpen && !enrolled) ? 0.7 : 1 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm text-[var(--ink)]">{cls.name}</div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">Section <strong>{cls.section}</strong></div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge enrolled={enrolled} open={cls.enrollmentOpen} matches={matches} />
          {isCurrentSem && (
            <span className="text-[10px] font-semibold text-[var(--accent)] bg-[var(--accent-l)] px-1.5 py-0.5 rounded">Current Sem</span>
          )}
        </div>
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
            <CalendarDays size={11} className="shrink-0" />
            <span>{cls.activeSemester}</span>
            {semesterStatus && (
              <span className={`ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                semesterStatus === 'active'   ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                semesterStatus === 'ended'    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                               'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {semesterStatus === 'active' ? 'Active' : semesterStatus === 'ended' ? 'Ended' : 'Upcoming'}
              </span>
            )}
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
            {busy ? 'Enrolling…' : 'Enroll Now'}
          </button>
        )}
        {enrolled && (
          <div className="flex items-start gap-1.5 text-xs text-[var(--ink3)] bg-[var(--surface2)] px-2.5 py-2 rounded-lg w-full">
            <Lock size={12} className="shrink-0 mt-0.5" />
            <span>Enrollment is locked. Message your teacher if you need to make changes.</span>
          </div>
        )}
        {!canEnroll && !enrolled && (
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
  const { classes, semester, enrollInClass } = useData()
  const { toast, openDialog } = useUI()
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | 'enrolled' | 'available'
  const autoSwitched = useRef(false)
  const [showArchivedHistory, setShowArchivedHistory] = useState(false)

  const studentClassIds = useMemo(() =>
    student.classIds?.length
      ? student.classIds
      : student.classId ? [student.classId] : [],
    [student]
  )

  const semLabel = semester ? (semester.label || `${semester.term} AY ${semester.year}`) : null

  // Only show non-archived classes
  const activeClasses = useMemo(
    () => classes.filter(c => !c.archived),
    [classes]
  )

  // Classes belonging to the current semester
  const currentSemClasses = useMemo(() =>
    semLabel ? activeClasses.filter(c => c.activeSemester === semLabel) : [],
    [activeClasses, semLabel]
  )

  const enrolledClasses  = useMemo(() => activeClasses.filter(c => studentClassIds.includes(c.id)), [activeClasses, studentClassIds])
  const availableClasses = useMemo(() => activeClasses.filter(c => !studentClassIds.includes(c.id) && c.enrollmentOpen), [activeClasses, studentClassIds])

  // Sort: current-semester classes first, then others; enrolled at top within each group
  const allVisible = useMemo(() => {
    const base = activeClasses.filter(c =>
      filter === 'enrolled'  ? studentClassIds.includes(c.id) :
      filter === 'available' ? (!studentClassIds.includes(c.id) && c.enrollmentOpen) :
      true
    )
    return [...base].sort((a, b) => {
      const aEnrolled = studentClassIds.includes(a.id)
      const bEnrolled = studentClassIds.includes(b.id)
      const aCurrent  = semLabel && a.activeSemester === semLabel
      const bCurrent  = semLabel && b.activeSemester === semLabel
      // enrolled first
      if (aEnrolled !== bEnrolled) return aEnrolled ? -1 : 1
      // current-semester next
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
      return 0
    })
  }, [activeClasses, studentClassIds, filter, semLabel])

  // Auto-switch to "available" tab when semester opens and student has un-enrolled classes
  useEffect(() => {
    if (autoSwitched.current) return
    if (semester?.status === 'active' && availableClasses.length > 0 && enrolledClasses.length === 0) {
      setFilter('available')
      autoSwitched.current = true
    }
  }, [semester?.status, availableClasses.length, enrolledClasses.length])

  async function handleEnroll(classId) {
    const cls = classes.find(c => c.id === classId)
    const ok  = await openDialog({
      title: 'Confirm Enrollment',
      msg: `You are about to enroll in "${cls?.name} ${cls?.section}". Once enrolled, your enrollment cannot be changed or removed. If you need to make any corrections, you will need to message your teacher directly.`,
      type: 'warn',
      confirmLabel: 'Enroll Now',
      showCancel: true,
    })
    if (!ok) return
    setBusyId(classId)
    try {
      await enrollInClass(student.id, classId)
      toast(`Enrolled in ${cls?.name} ${cls?.section}!`, 'green')
    } catch (e) {
      toast(e.message, 'red')
    } finally {
      setBusyId(null)
    }
  }

  const enrolledInCurrentSem = useMemo(() =>
    enrolledClasses.filter(c => semLabel && c.activeSemester === semLabel).length,
    [enrolledClasses, semLabel]
  )

  // Academic history: archived semesters sorted most-recent first
  const archivedHistory = useMemo(() =>
    [...(student.archivedSemesters || [])].sort((a, b) =>
      new Date(b.archivedAt) - new Date(a.archivedAt)
    ),
    [student.archivedSemesters]
  )

  return (
    <div className="space-y-5">
      {/* Rich semester status banner */}
      <SemesterBanner semester={semester} />

      {/* No semester configured */}
      {!semester && (
        <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-xs text-[var(--ink3)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>No semester is currently configured. Contact your teacher or administrator.</span>
        </div>
      )}

      {/* Header */}
      <div className="sec-hdr">
        <div>
          <div className="sec-title">Class Enrollment</div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">
            {enrolledClasses.length > 0
              ? <>You are enrolled in <strong>{enrolledClasses.length}</strong> class{enrolledClasses.length !== 1 ? 'es' : ''}
                  {semLabel && enrolledInCurrentSem > 0 && <> (<strong>{enrolledInCurrentSem}</strong> in current semester)</>}
                  .{availableClasses.length > 0 && ` ${availableClasses.length} more class${availableClasses.length !== 1 ? 'es' : ''} available.`}
                </>
              : semester?.status === 'active'
              ? <span className="text-green-600 dark:text-green-400 font-medium">Enrollment is open — select your classes below.</span>
              : 'You are not enrolled in any classes yet.'
            }
          </div>
        </div>
      </div>

      {/* Enrollment finality notice */}
      <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-xs text-amber-800 dark:text-amber-300">
        <MessageSquare size={14} className="shrink-0 mt-0.5" />
        <span>
          <strong>Important:</strong> Enrollment is final. Once you click <em>Enroll Now</em>, your selection cannot be changed.
          If you need to update your enrollment, please message your teacher directly.
        </span>
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
          { id: 'available', label: `Open for Enrollment (${availableClasses.length})`, highlight: semester?.status === 'active' && availableClasses.length > 0 },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`text-xs px-3 py-2 font-medium border-b-2 -mb-px transition-colors relative ${
              filter === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {tab.label}
            {tab.highlight && filter !== tab.id && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500" />
            )}
          </button>
        ))}
      </div>

      {/* Class grid */}
      {allVisible.length === 0 ? (
        <div className="empty py-12">
          <div className="empty-icon"><BookOpen size={32} /></div>
          <div className="text-sm text-[var(--ink3)] mt-2">
            {filter === 'enrolled'
              ? 'You are not enrolled in any classes yet.'
              : filter === 'available'
              ? semester?.status === 'upcoming'
                ? 'Enrollment is not open yet. Check back when the semester starts.'
                : semester?.status === 'ended'
                ? 'Enrollment for this semester has ended.'
                : 'No classes are currently open for enrollment.'
              : 'No active classes found.'
            }
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {allVisible.map(cls => (
            <ClassCard
              key={cls.id}
              cls={cls}
              student={student}
              onEnroll={handleEnroll}
              busy={busyId === cls.id}
              isCurrentSem={!!(semLabel && cls.activeSemester === semLabel)}
              semesterStatus={
                (semLabel && cls.activeSemester === semLabel)
                  ? semester?.status
                  : cls.activeSemester
                  ? 'ended'
                  : semester?.status ?? null
              }
            />
          ))}
        </div>
      )}

      {/* ── Academic History (Archived Classes) ──────────────────────── */}
      {archivedHistory.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)]">
          <button
            className="flex items-center gap-2 w-full text-left group"
            onClick={() => setShowArchivedHistory(h => !h)}
          >
            <Archive size={15} className="shrink-0 text-[var(--ink3)]" />
            <span className="font-medium text-sm text-[var(--ink2)] group-hover:text-[var(--ink)] transition-colors">
              Academic History
            </span>
            <span className="text-xs text-[var(--ink3)] ml-1">
              ({archivedHistory.length} archived class{archivedHistory.length !== 1 ? 'es' : ''})
            </span>
            <span className="ml-auto">
              {showArchivedHistory
                ? <ChevronDown size={15} className="text-[var(--ink3)]" />
                : <ChevronRight size={15} className="text-[var(--ink3)]" />
              }
            </span>
          </button>

          {showArchivedHistory && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-[var(--ink3)] px-0.5">
                These are classes from previous semesters archived by your teacher. Your grades and attendance records are preserved.
              </p>
              <div className="space-y-2">
                {archivedHistory.map((entry, i) => (
                  <ArchivedClassCard key={`${entry.classId}-${i}`} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
