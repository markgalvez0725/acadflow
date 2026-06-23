import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { onSnapshot, doc } from 'firebase/firestore'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import StudentSidebar from './StudentSidebar'
import { SkeletonRows, SkeletonDashboard, TabErrorBoundary } from '@/components/primitives/SkeletonLoader'
import SemesterCalendarChip from '@/components/primitives/SemesterCalendarChip'
import CommandPaletteButton from '@/components/primitives/CommandPaletteButton'
import InstallPrompt from '@/components/primitives/InstallPrompt'
import ConnectionStatus from '@/components/primitives/ConnectionStatus'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useReminders } from '@/hooks/useReminders'
import { activeClasses, activeClassIds } from '@/utils/active'
import { isNotifAllowed } from '@/utils/notifPrefs'
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, Bell, FileQuestion, Rss, CalendarDays, Video, ClipboardSignature, Menu, Settings, LogOut, MessageSquare } from 'lucide-react'

// Lazy-load tabs
const StreamTab        = lazy(() => import('./tabs/StreamTab'))
const OverviewTab      = lazy(() => import('./tabs/OverviewTab'))
const GradesTab        = lazy(() => import('./tabs/GradesTab'))
const AttendanceTab    = lazy(() => import('./tabs/AttendanceTab'))
const ActivitiesTab    = lazy(() => import('./tabs/ActivitiesTab'))
const NotificationsTab = lazy(() => import('./tabs/NotificationsTab'))
const StudentQuizTab   = lazy(() => import('./tabs/QuizTab'))
const CalendarTab      = lazy(() => import('./tabs/CalendarTab'))
const OnlineClassesTab = lazy(() => import('./tabs/OnlineClassesTab'))
const EnrollmentTab    = lazy(() => import('./tabs/EnrollmentTab'))
const MessagesTab      = lazy(() => import('./tabs/MessagesTab'))

// Lazy-load modals
const EditProfileModal         = lazy(() => import('./modals/EditProfileModal'))
const ForceChangePasswordModal = lazy(() => import('./modals/ForceChangePasswordModal'))
const StudentActionSheet       = lazy(() => import('./modals/StudentActionSheet'))
const NotifPrefsModal          = lazy(() => import('./modals/NotifPrefsModal'))
const NotifyPrompt             = lazy(() => import('./NotifyPrompt'))

const TAB_TITLES = {
  overview:      ['Home',           'Your academic overview'],
  stream:        ['Stream',         'Class announcements and updates'],
  grades:        ['Grades',         'Your grades by subject'],
  attendance:    ['Attendance',     'Your attendance record'],
  activities:    ['Activities',     'Submit and track your activities'],
  quizzes:       ['Quizzes',        'Take and review quizzes'],
  notifications: ['Notifications',  'Your alerts'],
  calendar:      ['Calendar',       'Deadlines and events'],
  onlineClasses: ['Online Classes', 'Join your Google Meet sessions'],
  enrollment:    ['Enrollment',     'Your enrolled subjects'],
  messages:      ['Messages',       'Chat with your teacher'],
}

// Mobile bottom-nav: 4 primary + More (opens a sheet)
const MOBILE_NAV = [
  { id: 'overview',   Icon: LayoutDashboard, label: 'Home',    badgeId: null },
  { id: 'grades',     Icon: BookOpen,        label: 'Grades',  badgeId: null },
  { id: 'activities', Icon: ClipboardList,   label: 'Tasks',   badgeId: 'act' },
  { id: 'quizzes',    Icon: FileQuestion,    label: 'Quizzes', badgeId: 'quiz' },
]
const MORE_NAV = [
  { id: 'stream',        Icon: Rss,                 label: 'Stream' },
  { id: 'attendance',    Icon: CalendarCheck,       label: 'Attendance' },
  { id: 'calendar',      Icon: CalendarDays,        label: 'Calendar' },
  { id: 'enrollment',    Icon: ClipboardSignature,  label: 'Enrollment' },
  { id: 'onlineClasses', Icon: Video,               label: 'Meet' },
]

export default function StudentLayout() {
  const { studentTab, setStudentTab, toastQueue, dismissToast, dialog, resolveDialog, toast } = useUI()
  const { students, classes, messages, activities, quizzes, db, fbReady, semester, studentCheckIn, attendanceSessions } = useData()
  const { currentStudent, setCurrentStudent, logout, loginTime, lastLogin } = useAuth()

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

  // Multi-class: track which class is being viewed. Only current-semester,
  // non-archived classes appear — previous/ended semesters are hidden.
  const enrolledClasses = student ? activeClasses(student, classes, semester) : []

  const [viewClassId, setViewClassId] = useState(null)
  const effectiveClassId = viewClassId || enrolledClasses[0]?.id || null

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

  // Shell state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [moreOpen, setMoreOpen] = useState(false)

  // Force change password modal
  const [forcePassOpen,    setForcePassOpen]    = useState(false)
  const [forcePassIsForced, setForcePassIsForced] = useState(false)

  // Profile / account sheet
  const [profileOpen, setProfileOpen] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false)

  // Web push (FCM) — opt-in per device, no-op when unsupported/unconfigured
  const push = usePushNotifications({ db, fbReady, ownerId: student?.id, role: 'student', toast })

  // Smart deadline reminders — fires 24h / 3h before activity & quiz deadlines
  // while the app is open. Idempotent, so it never double-reminds.
  useReminders(student)

  // QR check-in deep link: a scanned attendance QR opens AcadFlow at
  // /?checkin=<code>. Once the student is in and sessions have synced, redeem
  // the code automatically, then strip it from the URL. Survives the login
  // transition via sessionStorage.
  const checkinHandledRef = useRef(false)
  useEffect(() => {
    if (!student?.id || !fbReady || checkinHandledRef.current) return
    let code = null
    try {
      const params = new URLSearchParams(window.location.search)
      code = params.get('checkin')
      if (code) sessionStorage.setItem('cp_pending_checkin', code)
      else code = sessionStorage.getItem('cp_pending_checkin')
    } catch (e) { /* ignore */ }
    if (!code) return
    if (!attendanceSessions || attendanceSessions.length === 0) return // wait for the live listener
    checkinHandledRef.current = true
    ;(async () => {
      try {
        const session = await studentCheckIn(code, student)
        toast(`Checked in for ${session.subject}. You're marked present.`, 'green')
        setStudentTab('attendance')
      } catch (e) {
        toast(e.message || 'Check-in failed.', 'red')
      } finally {
        try { sessionStorage.removeItem('cp_pending_checkin') } catch (e) {}
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete('checkin')
          window.history.replaceState({}, '', url.pathname + url.search + url.hash)
        } catch (e) {}
      }
    })()
  }, [student?.id, fbReady, attendanceSessions])

  // Persistent "enable notifications" popup. Shows after login whenever push is
  // supported and the student hasn't decided yet (permission === 'default').
  // It reappears on every new login (keyed to loginTime) until they enable it,
  // and never nags once permission is granted or blocked.
  const [notifyPromptOpen, setNotifyPromptOpen] = useState(false)
  const notifyShownRef = useRef(null)
  useEffect(() => {
    if (!student) return
    if (!push.supported || push.permission !== 'default') return
    if (forcePassOpen) return
    if (notifyShownRef.current === loginTime) return
    notifyShownRef.current = loginTime
    const t = setTimeout(() => setNotifyPromptOpen(true), 1500)
    return () => clearTimeout(t)
  }, [student, push.supported, push.permission, forcePassOpen, loginTime])

  // Close the popup the moment permission stops being actionable.
  useEffect(() => {
    if (push.permission !== 'default') setNotifyPromptOpen(false)
  }, [push.permission])

  const unreadNotifCount = studentNotifs.filter(n => !n.read && isNotifAllowed(n, student?.notifPrefs)).length

  // Activities the student hasn't submitted yet and aren't past due
  const openActivityCount = (() => {
    if (!student) return 0
    const studentClassIds = activeClassIds(student, classes, semester)
    const now = Date.now()
    return activities.filter(a => {
      if (!studentClassIds.includes(a.classId)) return false
      const sub = (a.submissions || {})[student.id]
      if (sub?.link) return false
      if (a.deadline && now > a.deadline) return false
      return true
    }).length
  })()

  // Open quizzes the student hasn't taken yet
  const openQuizCount = (() => {
    if (!student) return 0
    const now = Date.now()
    const studentClassIds = activeClassIds(student, classes, semester)
    return quizzes.filter(q =>
      q.classIds?.some(id => studentClassIds.includes(id)) &&
      now >= q.openAt && now <= q.closeAt &&
      !q.submissions?.[student.id]
    ).length
  })()

  const unreadMsgCount = messages.filter(m => {
    if (!student) return false
    const id = student.id
    const enrolledClassIds = activeClassIds(student, classes, semester)
    const isVisible = (
      m.to === 'all' ||
      m.to === id ||
      (m.from === id && m.to === 'admin') ||
      (m.type === 'announcement' && m.classId && enrolledClassIds.includes(m.classId))
    )
    if (!isVisible) return false
    const lastReadAt = m.readAt?.[id] || 0
    if (m.from !== id) {
      const studentRead = Array.isArray(m.read) && m.read.includes(id)
      if (!studentRead) return true
    }
    const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
    return lastAdminReply > lastReadAt
  }).length

  // Toast on any genuinely new notification.
  const lastNotifTs = useRef(0)
  const notifReady = useRef(false)
  useEffect(() => {
    const list = studentNotifs || []
    if (!list.length) return
    const latest = list.reduce((m, n) => Math.max(m, n.ts || 0), 0)
    if (!notifReady.current) { notifReady.current = true; lastNotifTs.current = latest; return }
    if (latest > lastNotifTs.current) {
      const fresh = list.filter(n => (n.ts || 0) > lastNotifTs.current).sort((a, b) => b.ts - a.ts)
      lastNotifTs.current = latest
      const n = fresh[0]
      if (n) toast(n.body ? `${n.title} — ${n.body}` : n.title, 'info')
    }
  }, [studentNotifs])

  if (!student) {
    return (
      <div style={{ padding: 24 }}>
        <SkeletonDashboard />
      </div>
    )
  }

  const badges = { act: openActivityCount, quiz: openQuizCount, notif: unreadNotifCount }
  const [title, subtitle] = TAB_TITLES[studentTab] || ['', '']

  function badgeFor(id) {
    if (id === 'activities') return openActivityCount
    if (id === 'quizzes')    return openQuizCount
    if (id === 'notifications') return unreadNotifCount
    return 0
  }

  return (
    <div className="admin-layout" id="student-portal">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`sidebar-wrap${sidebarOpen ? ' open' : ''}${sidebarExpanded ? ' expanded' : ''}`}>
        <StudentSidebar
          student={student}
          badges={badges}
          onSettings={() => setActionSheetOpen(true)}
          onLogout={() => logout('manual')}
          onToggle={() => setSidebarExpanded(e => !e)}
        />
      </div>

      {/* Main content */}
      <div className={`admin-main${sidebarExpanded ? ' sidebar-expanded' : ''}`}>
        {/* Top bar */}
        <div className="admin-topbar">
          <div>
            <h3>{title}</h3>
            <span>{subtitle}</span>
          </div>
          <div className="flex items-center gap-3">
            {enrolledClasses.length > 1 && (
              <select
                className="class-selector tb-desktop-only"
                value={effectiveClassId || ''}
                onChange={e => setViewClassId(e.target.value)}
              >
                {enrolledClasses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ''}</option>
                ))}
              </select>
            )}
            <span className="tb-desktop-only"><ConnectionStatus compact /></span>
            <CommandPaletteButton compact />
            <ThemeToggle style={{ position: 'static', width: 36, height: 36, borderRadius: 10 }} />
            <span className="tb-desktop-only"><SemesterCalendarChip semester={semester} /></span>
            <button
              onClick={() => setStudentTab('notifications')}
              aria-label="Notifications"
              title="Notifications"
              style={{ position: 'relative', width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              <Bell size={18} />
              {unreadNotifCount > 0 && (
                <span style={{ position: 'absolute', top: 6, right: 7, minWidth: 7, height: 7, borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)' }} />
              )}
            </button>
          </div>
        </div>

        {/* Tab content */}
        <main className="admin-body" id="main-content" tabIndex={-1}>
          <InstallPrompt />
          <TabErrorBoundary key={studentTab}>
            <Suspense fallback={<SkeletonRows />}>
              {studentTab === 'stream'        && <StreamTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'overview'      && <OverviewTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'grades'        && <GradesTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'attendance'    && <AttendanceTab    student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'activities'    && <ActivitiesTab    student={student} viewClassId={effectiveClassId} activities={activities} />}
              {studentTab === 'quizzes'       && <StudentQuizTab   student={student} viewClassId={effectiveClassId} />}
              {studentTab === 'notifications' && <NotificationsTab student={student} notifs={studentNotifs} setNotifs={setStudentNotifs} />}
              {studentTab === 'calendar'      && <CalendarTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'onlineClasses' && <OnlineClassesTab student={student} />}
              {studentTab === 'enrollment'    && <EnrollmentTab    student={student} />}
              {studentTab === 'messages'      && <MessagesTab      student={student} messages={messages} />}
            </Suspense>
          </TabErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav — 4 primary + More */}
      <nav className="admin-bottom-nav" aria-label="Sections">
        {MOBILE_NAV.map(t => {
          const badge = t.badgeId ? badgeFor(t.id) : 0
          return (
            <button
              key={t.id}
              className={`abn-item${studentTab === t.id ? ' active' : ''}`}
              onClick={() => setStudentTab(t.id)}
              aria-label={t.label}
            >
              <span className="abn-ic">
                <t.Icon size={20} />
                {badge > 0 && <span className="abn-dot" />}
              </span>
              <span className="abn-label">{t.label}</span>
            </button>
          )
        })}
        <button className={`abn-item${studentTab === 'messages' ? ' active' : ''}`} onClick={() => setStudentTab('messages')} aria-label="Messages">
          <span className="abn-ic">
            <MessageSquare size={20} />
            {unreadMsgCount > 0 && <span className="abn-dot" />}
          </span>
          <span className="abn-label">Messages</span>
        </button>
        <button className={`abn-item${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen(true)} aria-label="More">
          <Menu size={20} />
          <span className="abn-label">More</span>
        </button>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="ds-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="ds-sheet" onClick={e => e.stopPropagation()}>
            <div className="ds-sheet-grip" />
            <div className="ds-sheet-title">More</div>
            <div className="ds-sheet-grid">
              {MORE_NAV.map(t => (
                <button
                  key={t.id}
                  className={`ds-tile${studentTab === t.id ? ' active' : ''}`}
                  onClick={() => { setStudentTab(t.id); setMoreOpen(false) }}
                >
                  <t.Icon size={22} />
                  <span>{t.label}</span>
                </button>
              ))}
              <button className="ds-tile" onClick={() => { setMoreOpen(false); setActionSheetOpen(true) }}>
                <Settings size={22} />
                <span>Account</span>
              </button>
              <button className="ds-tile ds-tile-danger" onClick={() => { setMoreOpen(false); logout('manual') }}>
                <LogOut size={22} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
          onNotifPrefs={() => setNotifPrefsOpen(true)}
          onLogout={() => logout('manual')}
          student={student}
          push={push}
        />
      </Suspense>

      {notifPrefsOpen && (
        <Suspense fallback={null}>
          <NotifPrefsModal student={student} onClose={() => setNotifPrefsOpen(false)} />
        </Suspense>
      )}

      {notifyPromptOpen && (
        <Suspense fallback={null}>
          <NotifyPrompt push={push} onClose={() => setNotifyPromptOpen(false)} />
        </Suspense>
      )}

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
