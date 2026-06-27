import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { findScheduleConflicts } from '@/utils/schedule'
import { eligibleForClass } from '@/utils/enrollment'
import {
  BookOpen, CheckCircle2, XCircle, LockOpen, Lock,
  CalendarDays, Clock, MapPin, AlertTriangle, TimerOff, Bell,
  Archive, ChevronDown, ChevronRight, Info,
} from 'lucide-react'
import { courseShort } from '@/constants/courses'

// ── Helpers ───────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

// Split a subject string like "EMCP 110 - Applied Mathematics For Games" into
// { code, name }. Falls back to the whole string as the name when no code is present.
function splitSubject(s) {
  const str = String(s || '').trim()
  const m = str.match(/^(.*?)\s*[\u2010-\u2015\u2212-]\s*(.+)$/)
  if (m && m[1] && m[2]) return { code: m[1].trim(), name: m[2].trim() }
  return { code: '', name: str }
}

// ── Semester status pill (compact) ────────────────────────────────────
function SemesterPill({ semester }) {
  if (!semester) return null
  const semLabel = semester.label || `${semester.term} AY ${semester.year}`

  const meta = {
    active:   { label: 'Open',     Icon: LockOpen, tone: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' },
    upcoming: { label: 'Upcoming', Icon: Bell,     tone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
    ended:    { label: 'Ended',    Icon: TimerOff, tone: 'bg-[var(--surface2)] text-[var(--ink3)]' },
  }[semester.status] || { label: 'Current', Icon: CalendarDays, tone: 'bg-[var(--surface2)] text-[var(--ink3)]' }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full shrink-0 ${meta.tone}`}>
      <meta.Icon size={13} className="shrink-0" />
      <span>{semLabel} · {meta.label}</span>
    </span>
  )
}

// ── Compact context strip: Status · Course · Available ────────────────
function ContextStrip({ semester, student, openCount }) {
  const startFmt = fmtDate(semester?.startDate)
  const endFmt   = fmtDate(semester?.endDate)

  let statusVal, accent
  if (!semester) {
    statusVal = 'Not configured'; accent = 'var(--border)'
  } else if (semester.status === 'active') {
    statusVal = endFmt ? `Closes ${endFmt}` : 'Open now'; accent = '#22c55e'
  } else if (semester.status === 'upcoming') {
    statusVal = startFmt ? `Opens ${startFmt}` : 'Upcoming'; accent = '#f59e0b'
  } else if (semester.status === 'ended') {
    statusVal = endFmt ? `Closed ${endFmt}` : 'Ended'; accent = 'var(--ink3)'
  } else {
    statusVal = semester.label || `${semester.term} AY ${semester.year}`; accent = 'var(--ink3)'
  }

  const courseFull = student.course
    ? `${student.course}${student.year ? ` · ${student.year}` : ''}`
    : 'Not set'
  const courseVal = student.course
    ? `${courseShort(student.course)}${student.year ? ` · ${student.year}` : ''}`
    : 'Not set'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
      <div className="px-3.5 py-2.5 border-l-[3px]" style={{ borderLeftColor: accent }}>
        <div className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">Status</div>
        <div className="text-xs font-semibold text-[var(--ink)] mt-0.5">{statusVal}</div>
      </div>
      <div className="px-3.5 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">Your course</div>
        <div className="text-xs font-semibold text-[var(--ink)] mt-0.5 truncate" title={courseFull}>
          {student.course ? courseVal : <span className="text-red-500 font-medium">Not set</span>}
        </div>
      </div>
      <div className="px-3.5 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">Available</div>
        <div className="text-xs font-semibold text-[var(--ink)] mt-0.5">
          {openCount} {openCount === 1 ? 'class' : 'classes'} open
        </div>
      </div>
    </div>
  )
}

// ── Enrollment status badge ───────────────────────────────────────────
function StatusBadge({ enrolled, open, matches }) {
  if (enrolled)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} />Enrolled</span>
  if (!matches)  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full"><XCircle size={11} />Not your section</span>
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
                      <span className="text-xs text-[var(--ink3)]">-</span>
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
function ClassCard({ cls, student, onEnroll, busy, isCurrentSem, semesterStatus, enrolledClasses }) {
  const { classes } = useData()
  const enrolled = (student.classIds?.length
    ? student.classIds
    : student.classId ? [student.classId] : []
  ).includes(cls.id)

  const matches   = eligibleForClass(student, cls, classes)
  const canEnroll = !enrolled && cls.enrollmentOpen && matches

  // Warn (don't block) when this class's meeting time overlaps one already enrolled.
  const conflicts = canEnroll ? findScheduleConflicts(cls, enrolledClasses || []) : []

  // Subject-led header: feature the first subject (code + name); list the rest as chips.
  const subjects = cls.subjects || []
  const featured = subjects.length ? splitSubject(subjects[0]) : null
  const moreSubjects = subjects.slice(1)

  // Border tone: enrolled = green, actionable = 2px accent, current-sem = soft accent.
  const borderWidth = canEnroll ? 'border-2' : 'border'
  const borderTone =
    enrolled   ? 'border-green-400/60' :
    canEnroll  ? 'border-[var(--accent)]' :
    isCurrentSem ? 'border-[var(--accent)]/40' :
                 'border-[var(--border)]'

  return (
    <div
      className={`rounded-xl bg-[var(--surface)] p-4 flex flex-col gap-3 transition-shadow hover:shadow-md ${borderWidth} ${borderTone}`}
      style={{ opacity: (!cls.enrollmentOpen && !enrolled) ? 0.75 : 1 }}
    >
      {/* Header - leads with the subject */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {featured?.code && (
            <span className="inline-block font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-l)] text-[var(--accent)]">
              {featured.code}
            </span>
          )}
          <div className="font-semibold text-sm text-[var(--ink)] leading-snug mt-1.5">
            {featured ? featured.name : cls.name}
          </div>
          {(featured || cls.section) && (
            <div className="text-xs text-[var(--ink3)] mt-0.5 truncate">
              {featured
                ? <><span title={cls.name}>{courseShort(cls.name)}</span>{cls.section && <> · Section <strong className="font-medium text-[var(--ink2)]">{cls.section}</strong></>}</>
                : <>Section <strong className="font-medium text-[var(--ink2)]">{cls.section}</strong></>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge enrolled={enrolled} open={cls.enrollmentOpen} matches={matches} />
          {isCurrentSem && (
            <span className="text-[10px] font-semibold text-[var(--accent)] bg-[var(--accent-l)] px-1.5 py-0.5 rounded">Current Sem</span>
          )}
        </div>
      </div>

      {/* Additional subjects (when a class bundles more than one) */}
      {moreSubjects.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {moreSubjects.map(sub => {
            const s = splitSubject(sub)
            return (
              <span key={sub} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface2)] text-[var(--ink3)]" title={sub}>
                {s.code || s.name}
              </span>
            )
          })}
        </div>
      )}

      {/* Meta row - schedule · room · semester */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--ink2)] border-t border-[var(--border)] pt-2.5">
        {cls.schedule && (
          <span className="inline-flex items-center gap-1.5"><Clock size={12} className="shrink-0" />{cls.schedule}</span>
        )}
        {cls.room && (
          <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="shrink-0" />{cls.room}</span>
        )}
        {cls.activeSemester && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={12} className="shrink-0" />
            <span>{cls.activeSemester}</span>
            {semesterStatus && (
              <span className={`ml-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                semesterStatus === 'active'   ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                semesterStatus === 'ended'    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                               'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {semesterStatus === 'active' ? 'Active' : semesterStatus === 'ended' ? 'Ended' : 'Upcoming'}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Course requirement notice */}
      {!matches && (
        <div className="flex items-start gap-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-900/15 px-2.5 py-2 rounded-lg">
          <XCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            Requires <strong title={cls.courseReq || cls.name}>{courseShort(cls.courseReq || cls.name)}</strong>.
            Your course is <strong title={student.course || ''}>{courseShort(student.course) || 'not set'}</strong>.
          </span>
        </div>
      )}

      {/* Schedule conflict warning (non-blocking) */}
      {conflicts.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15 px-2.5 py-2 rounded-lg">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Schedule clash with <strong>{conflicts.map(c => c.name).join(', ')}</strong>.
            {cls.schedule ? <> This class meets <strong>{cls.schedule}</strong>.</> : null}
          </span>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-1">
        {canEnroll && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => onEnroll(cls.id)}
            disabled={busy}
          >
            {busy ? 'Enrolling…' : 'Enroll Now'}
          </button>
        )}
        {enrolled && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink3)]">
            <Lock size={12} className="shrink-0" />
            <span>Enrollment locked - message your teacher to make changes.</span>
          </div>
        )}
        {!canEnroll && !enrolled && (
          <div className="text-xs text-[var(--ink3)]">
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

  // Only show non-archived classes that match the student's course, year level
  // AND exact section. Already-enrolled classes are always included so existing
  // enrollments remain visible.
  const activeClasses = useMemo(
    () => classes.filter(c => {
      if (c.archived) return false
      if (studentClassIds.includes(c.id)) return true // always show enrolled
      return eligibleForClass(student, c, classes)
    }),
    [classes, studentClassIds, student]
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
    const conflicts = cls ? findScheduleConflicts(cls, enrolledClasses) : []
    const conflictNote = conflicts.length
      ? ` Note: its schedule (${cls.schedule}) overlaps ${conflicts.map(c => c.name).join(', ')}.`
      : ''
    const ok  = await openDialog({
      title: 'Confirm Enrollment',
      msg: `You are about to enroll in "${cls?.name} ${cls?.section}".${conflictNote} Once enrolled, your enrollment cannot be changed or removed. If you need to make any corrections, you will need to message your teacher directly.`,
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

  const tabs = [
    { id: 'all',       label: `All (${activeClasses.length})` },
    { id: 'enrolled',  label: `Enrolled (${enrolledClasses.length})` },
    { id: 'available', label: `Open (${availableClasses.length})`, highlight: semester?.status === 'active' && availableClasses.length > 0 },
  ]

  return (
    <div className="space-y-4">
      {/* Header - title + progress + compact semester pill */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="sec-title">Class Enrollment</div>
          <div className="text-xs text-[var(--ink3)] mt-0.5">
            {enrolledClasses.length > 0
              ? <>Enrolled in <strong>{enrolledClasses.length}</strong> class{enrolledClasses.length !== 1 ? 'es' : ''}
                  {semLabel && enrolledInCurrentSem > 0 && <> (<strong>{enrolledInCurrentSem}</strong> this semester)</>}
                  .{availableClasses.length > 0 && ` ${availableClasses.length} more available.`}
                </>
              : semester?.status === 'active'
              ? <span className="text-green-600 dark:text-green-400 font-medium">Enrollment is open - select your classes below.</span>
              : 'You are not enrolled in any classes yet.'
            }
          </div>
        </div>
        <SemesterPill semester={semester} />
      </div>

      {/* No semester configured */}
      {!semester && (
        <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-xs text-[var(--ink3)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>No semester is currently configured. Contact your teacher or administrator.</span>
        </div>
      )}

      {/* Compact context strip */}
      <ContextStrip semester={semester} student={student} openCount={availableClasses.length} />

      {/* Finality note - subtle */}
      <div className="flex items-start gap-2 text-xs text-[var(--ink3)] px-0.5">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          <strong className="text-[var(--ink2)]">Enrollment is final</strong> - once you enroll, message your teacher to make any changes.
        </span>
      </div>

      {/* Segmented filter */}
      <div className="inline-flex bg-[var(--surface2)] border border-[var(--border)] rounded-full p-0.5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`relative text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors ${
              filter === tab.id
                ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {tab.label}
            {tab.highlight && filter !== tab.id && (
              <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-green-500" />
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
              enrolledClasses={enrolledClasses}
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
