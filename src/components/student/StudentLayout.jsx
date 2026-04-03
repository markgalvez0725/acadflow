import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { onSnapshot, doc } from 'firebase/firestore'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import FloatingMessenger from './FloatingMessenger'
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, Bell, FileQuestion, Rss, CalendarDays } from 'lucide-react'

// Lazy-load tabs
const StreamTab        = lazy(() => import('./tabs/StreamTab'))
const OverviewTab      = lazy(() => import('./tabs/OverviewTab'))
const GradesTab        = lazy(() => import('./tabs/GradesTab'))
const AttendanceTab    = lazy(() => import('./tabs/AttendanceTab'))
const ActivitiesTab    = lazy(() => import('./tabs/ActivitiesTab'))
const NotificationsTab = lazy(() => import('./tabs/NotificationsTab'))
const StudentQuizTab   = lazy(() => import('./tabs/QuizTab'))
const CalendarTab      = lazy(() => import('./tabs/CalendarTab'))

// Lazy-load modals
const EditProfileModal         = lazy(() => import('./modals/EditProfileModal'))
const ForceChangePasswordModal = lazy(() => import('./modals/ForceChangePasswordModal'))
const StudentActionSheet       = lazy(() => import('./modals/StudentActionSheet'))

const NAV_ITEMS = [
  { id: 'stream',        label: 'Stream',         Icon: Rss },
  { id: 'overview',      label: 'Overview',      Icon: LayoutDashboard },
  { id: 'grades',        label: 'Grades',         Icon: BookOpen },
  { id: 'attendance',    label: 'Attendance',     Icon: CalendarCheck },
  { id: 'activities',    label: 'Activities',     Icon: ClipboardList },
  { id: 'quizzes',       label: 'Quizzes',        Icon: FileQuestion },
  { id: 'notifications', label: 'Notifications',  Icon: Bell },
  { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
]

export default function StudentLayout() {
  const { studentTab, setStudentTab, toastQueue, dismissToast, dialog, resolveDialog, toast } = useUI()
  const { students, classes, messages, activities, quizzes, db, fbReady } = useData()
  const { currentStudent, setCurrentStudent, logout } = useAuth()

  // Resolve pending student (session restore — only id is known until students load)
  const [student, setStudent] = useState(() =>
    currentStudent?._pending ? null : currentStudent
  )

  useEffect(() => {
    if (!currentStudent) return
    if (!currentStudent._pending) { setStudent(currentStudent); return }
    if (!students.length) return
    const found = students.find(s => s.id === currentStudent.id)
    if (found) {
      setCurrentStudent(found)
      setStudent(found)
    }
  }, [currentStudent, students])

  // Multi-class: track which class is being viewed
  const enrolledClasses = student
    ? classes.filter(c => {
        if (c.archived) return false
        const ids = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
        return ids.includes(c.id)
      })
    : []

  const [viewClassId, setViewClassId] = useState(null)
  const effectiveClassId = viewClassId || enrolledClasses[0]?.id || null

  // When enrolled classes change (e.g. after pending resolve), reset viewClassId if stale
  useEffect(() => {
    if (viewClassId && !enrolledClasses.find(c => c.id === viewClassId)) {
      setViewClassId(null)
    }
  }, [enrolledClasses])

  // Student notifications — subscribe to notifications/{studentId}
  const [studentNotifs, setStudentNotifs] = useState([])
  const notifsUnsubRef = useRef(null)

  useEffect(() => {
    if (!student?.id || !fbReady || !db.current) return
    const ref = doc(db.current, 'notifications', student.id)
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data()
      setStudentNotifs(Array.isArray(data?.items) ? data.items : [])
    })
    notifsUnsubRef.current = unsub
    return () => { unsub(); notifsUnsubRef.current = null }
  }, [student?.id, fbReady])

  // Keep fresh student data from DataContext updates
  useEffect(() => {
    if (!student) return
    const fresh = students.find(s => s.id === student.id)
    if (fresh) setStudent(fresh)
  }, [students])

  // Force change password modal
  const [forcePassOpen,    setForcePassOpen]    = useState(false)
  const [forcePassIsForced, setForcePassIsForced] = useState(false)
  const forcePassTriggeredRef = useRef(false)
  useEffect(() => {
    if (!student || forcePassTriggeredRef.current) return
    if (student.forceChangePassword || !student.account?.pass) {
      forcePassTriggeredRef.current = true
      setForcePassIsForced(true)
      setForcePassOpen(true)
    }
  }, [student?.forceChangePassword, student?.account?.pass])

  // Profile modal
  const [profileOpen, setProfileOpen] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)

  const unreadNotifCount = studentNotifs.filter(n => !n.read).length

  // Activities the student hasn't submitted yet and aren't past due
  const openActivityCount = (() => {
    if (!student) return 0
    const studentClassIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    const now = Date.now()
    return activities.filter(a => {
      if (!studentClassIds.includes(a.classId)) return false
      const sub = (a.submissions || {})[student.id]
      if (sub?.link) return false // already submitted
      if (a.deadline && now > a.deadline) return false // past due
      return true
    }).length
  })()

  // Open quizzes the student hasn't taken yet
  const openQuizCount = (() => {
    if (!student) return 0
    const now = Date.now()
    const studentClassIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    return quizzes.filter(q =>
      q.classIds?.some(id => studentClassIds.includes(id)) &&
      now >= q.openAt && now <= q.closeAt &&
      !q.submissions?.[student.id]
    ).length
  })()
  const unreadMsgCount = messages.filter(m => {
    if (!student) return false
    const id = student.id
    const enrolledClassIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    const isVisible = (
      m.to === 'all' ||
      m.to === id ||
      (m.from === id && m.to === 'admin') ||
      (m.type === 'announcement' && m.classId && enrolledClassIds.includes(m.classId))
    )
    if (!isVisible) return false
    // Skip messages sent by the student — they don't need to be "read"
    if (m.from === id) return false
    const studentRead = Array.isArray(m.read) && m.read.includes(id)
    if (!studentRead) return true
    // Check if there's a new admin reply after the student last read
    const lastReadAt = m.readAt?.[id] || 0
    const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
    return lastAdminReply > lastReadAt
  }).length

  if (!student) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-ink2 text-sm">Loading…</div>
      </div>
    )
  }

  const activeClass = classes.find(c => c.id === effectiveClassId)

  return (
    <div className="student-layout" id="student-portal">
      {/* Top bar */}
      <div className="student-topbar">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <button
            className="stud-avatar"
            onClick={() => setActionSheetOpen(true)}
            title="Account options"
            style={{ flexShrink: 0 }}
          >
            {student.photo
              ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : <span style={{ fontSize: 18, lineHeight: 1 }}>{(student.name || '?')[0].toUpperCase()}</span>
            }
          </button>
          <div className="min-w-0">
            <div className="student-name truncate">{student.name || 'Student'}</div>
            <div className="student-id text-ink3 text-xs truncate">{student.snum || student.id}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Class selector — only when enrolled in 2+ classes */}
          {enrolledClasses.length > 1 && (
            <select
              className="class-selector"
              value={effectiveClassId || ''}
              onChange={e => setViewClassId(e.target.value)}
            >
              {enrolledClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ''}</option>
              ))}
            </select>
          )}
          <ThemeToggle style={{ position: 'static', width: 32, height: 32, fontSize: 14 }} />
        </div>
      </div>

      {/* Tab content */}
      <div className="student-body">
        <Suspense fallback={<div className="text-ink2 text-sm py-8 text-center">Loading…</div>}>
          {studentTab === 'stream'        && <StreamTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
          {studentTab === 'overview'      && <OverviewTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
          {studentTab === 'grades'        && <GradesTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
          {studentTab === 'attendance'    && <AttendanceTab    student={student} viewClassId={effectiveClassId} classes={classes} />}
          {studentTab === 'activities'    && <ActivitiesTab    student={student} viewClassId={effectiveClassId} activities={activities} />}
          {studentTab === 'quizzes'       && <StudentQuizTab   student={student} viewClassId={effectiveClassId} />}
          {studentTab === 'notifications' && <NotificationsTab student={student} notifs={studentNotifs} setNotifs={setStudentNotifs} />}
          {studentTab === 'calendar'     && <CalendarTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
        </Suspense>
      </div>

      {/* Bottom nav */}
      <nav className="student-bottom-nav">
        {NAV_ITEMS.map(item => {
          const badge = item.id === 'notifications' ? unreadNotifCount : item.id === 'quizzes' ? openQuizCount : item.id === 'activities' ? openActivityCount : 0
          return (
            <button
              key={item.id}
              className={`nav-item ${studentTab === item.id ? 'active' : ''}`}
              onClick={() => setStudentTab(item.id)}
            >
              <span className="nav-icon" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <item.Icon size={20} />
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -6,
                    background: '#ef4444', color: '#fff',
                    borderRadius: 10, fontSize: 9, fontWeight: 700,
                    padding: '0 4px', lineHeight: '14px', minWidth: 14,
                    textAlign: 'center',
                  }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Modals */}
      {profileOpen && (
        <Suspense fallback={null}>
          <EditProfileModal student={student} onClose={() => setProfileOpen(false)} />
        </Suspense>
      )}
      {forcePassOpen && (
        <Suspense fallback={null}>
          <ForceChangePasswordModal student={student} forced={forcePassIsForced} onClose={() => setForcePassOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <StudentActionSheet
          open={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          onEditProfile={() => setProfileOpen(true)}
          onChangePassword={() => { setForcePassIsForced(false); setForcePassOpen(true) }}
          onLogout={() => logout('manual')}
          student={student}
        />
      </Suspense>

      {/* Floating Messenger */}
      <FloatingMessenger student={student} messages={messages} unreadCount={unreadMsgCount} />

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
