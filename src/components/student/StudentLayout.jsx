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
import { activeClasses, activeClassIds, activeSubjects } from '@/utils/active'
import { courseShort } from '@/constants/courses'
import { studentSeesMessage } from '@/utils/studentMessages'
import { computePassedSubjects } from '@/utils/passedSubjects'
import { isNotifAllowed } from '@/utils/notifPrefs'
import { accountStatusKey } from '@/utils/accountStatus'
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, Bell, FileQuestion, Rss, CalendarDays, Video, ClipboardSignature, Menu, Settings, LogOut, MessageSquare, ListChecks, MessageSquarePlus, ShieldCheck } from 'lucide-react'

// Tabs hidden until the account is fully Active (verified + Face ID). Covers
// every surface that exposes grades, activities, or quizzes - including the
// Overview dashboard (the default landing tab: GWA, grade bars, study analyzer,
// open-quiz / pending-activity counts) and the Calendar (activity/quiz
// deadlines). Only setup, comms, and enrollment surfaces stay reachable.
const PENDING_GATED_TABS = new Set(['overview', 'grades', 'quizzes', 'activities', 'assignments', 'calendar'])

// Shown in place of a protected tab while the account isn't fully Active. One
// generic gate for every onboarding state - the guided VerificationCenter (opened
// via onVerify) owns all the step-specific detail, so this stays simple.
function VerificationGate({ onVerify, onContact }) {
  return (
    <div className="empty" style={{ padding: '40px 16px', textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
      <div className="empty-icon" style={{ color: 'var(--accent)' }}><ShieldCheck size={40} /></div>
      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--ink)', marginTop: 4 }}>Get verified to unlock</div>
      <p style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.6, marginTop: 8 }}>
        Your grades, quizzes, and activities unlock once your account is verified.
        It only takes a minute - I'll guide you through each step.
      </p>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={onVerify}>
        <ShieldCheck size={14} style={{ marginRight: 6 }} /> Get verified
      </button>
      <div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onContact}>
          <MessageSquare size={14} /> Message your professor
        </button>
      </div>
    </div>
  )
}

// Lazy-load tabs
const StreamTab        = lazy(() => import('./tabs/StreamTab'))
const OverviewTab      = lazy(() => import('./tabs/OverviewTab'))
const GradesTab        = lazy(() => import('./tabs/GradesTab'))
const AttendanceTab    = lazy(() => import('./tabs/AttendanceTab'))
const ActivitiesTab    = lazy(() => import('./tabs/ActivitiesTab'))
const AssignmentsTab   = lazy(() => import('./tabs/AssignmentsTab'))
const NotificationsTab = lazy(() => import('./tabs/NotificationsTab'))
const StudentQuizTab   = lazy(() => import('./tabs/QuizTab'))
const CalendarTab      = lazy(() => import('./tabs/CalendarTab'))
const OnlineClassesTab = lazy(() => import('./tabs/OnlineClassesTab'))
const EnrollmentTab    = lazy(() => import('./tabs/EnrollmentTab'))
const MessagesTab      = lazy(() => import('./tabs/MessagesTab'))
const FeedbackTab      = lazy(() => import('./tabs/FeedbackTab'))

// Lazy-load modals
const EditProfileModal         = lazy(() => import('./modals/EditProfileModal'))
const StudentActionSheet       = lazy(() => import('./modals/StudentActionSheet'))
const FaceEnrollModal          = lazy(() => import('./modals/FaceEnrollModal'))
const NotifyPrompt             = lazy(() => import('./NotifyPrompt'))
const OnboardingTour           = lazy(() => import('./OnboardingTour'))
const SubjectPassedModal       = lazy(() => import('./modals/SubjectPassedModal'))

const TAB_TITLES = {
  overview:      ['Home',           'Your academic overview'],
  stream:        ['Stream',         'Class announcements and updates'],
  grades:        ['Grades',         'Your grades by subject'],
  attendance:    ['Attendance',     'Your attendance record'],
  activities:    ['Activities',     'Submit and track your activities'],
  assignments:   ['Assignments',    'Every task across your subjects'],
  quizzes:       ['Quizzes',        'Take and review quizzes'],
  notifications: ['Notifications',  'Your alerts'],
  calendar:      ['Calendar',       'Deadlines and events'],
  onlineClasses: ['Online Classes', 'Join your Google Meet sessions'],
  enrollment:    ['Enrollment',     'Your enrolled subjects'],
  messages:      ['Messages',       'Chat with your professor'],
  feedback:      ['Feedback',       'Send ideas, bugs, and requests to your professor'],
}

// Mobile bottom-nav: 4 primary + More (opens a sheet)
const MOBILE_NAV = [
  { id: 'overview',   Icon: LayoutDashboard, label: 'Home',    badgeId: null },
  { id: 'grades',     Icon: BookOpen,        label: 'Grades',  badgeId: null },
  { id: 'activities', Icon: ClipboardList,   label: 'Tasks',   badgeId: 'act' },
  { id: 'quizzes',    Icon: FileQuestion,    label: 'Quizzes', badgeId: 'quiz' },
]
const MORE_NAV = [
  { id: 'assignments',   Icon: ListChecks,          label: 'Assignments' },
  { id: 'stream',        Icon: Rss,                 label: 'Stream' },
  { id: 'attendance',    Icon: CalendarCheck,       label: 'Attendance' },
  { id: 'calendar',      Icon: CalendarDays,        label: 'Calendar' },
  { id: 'enrollment',    Icon: ClipboardSignature,  label: 'Enrollment' },
  { id: 'onlineClasses', Icon: Video,               label: 'Meet' },
  { id: 'feedback',      Icon: MessageSquarePlus,   label: 'Feedback' },
]

export default function StudentLayout() {
  const { studentTab, setStudentTab, toastQueue, dismissToast, dialog, resolveDialog, toast, toastAction, openStudentMessageThread, pendingStreamClassId, clearPendingStreamClass } = useUI()
  const { students, classes, messages, activities, quizzes, db, fbReady, semester, studentCheckIn, attendanceSessions, eqScale } = useData()
  const { currentStudent, setCurrentStudent, logout, loginTime, lastLogin } = useAuth()

  // Resolve pending student (session restore - only id is known until students load)
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
  // non-archived classes appear - previous/ended semesters are hidden.
  const enrolledClasses = student ? activeClasses(student, classes, semester) : []

  // Needs onboarding = a registered account that isn't fully Active yet. This is
  // the SINGLE gate for protected tabs now: until own-password + profile +
  // identity + Face ID are all done, grades/quizzes/etc stay locked and the
  // student is funneled to the guided VerificationCenter inside Settings.
  const needsOnboarding = !!student?.account?.registered && accountStatusKey(student) !== 'active'

  const [viewClassId, setViewClassId] = useState(null)
  const effectiveClassId = viewClassId || enrolledClasses[0]?.id || null

  useEffect(() => {
    if (viewClassId && !enrolledClasses.find(c => c.id === viewClassId)) {
      setViewClassId(null)
    }
  }, [enrolledClasses])

  // A Stream deep-link (saved-announcements widget) may target a post in a class
  // other than the one being viewed; switch to it so the post is in the feed.
  useEffect(() => {
    if (!pendingStreamClassId) return
    if (enrolledClasses.find(c => c.id === pendingStreamClassId)) setViewClassId(pendingStreamClassId)
    clearPendingStreamClass()
  }, [pendingStreamClassId, enrolledClasses, clearPendingStreamClass])

  // Student notifications - subscribe to notifications/{studentId}
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
  const [moreOpen, setMoreOpen] = useState(false)

  // Profile / account sheet. The standalone editor is only for ACTIVE students
  // (Notifications tab / header). Onboarding edits happen inside the center.
  const [profileOpen, setProfileOpen] = useState(false)

  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [actionSheetView, setActionSheetView] = useState('home')
  const [faceModalOpen, setFaceModalOpen] = useState(false)

  // Single redirect into the guided verification flow (Settings → Get verified).
  const openVerify = () => { setActionSheetView('getverified'); setActionSheetOpen(true) }

  // Auto-open the student into "Get verified" ONCE per load while onboarding is
  // incomplete (replaces the old forced-password + forced-profile + setup-checklist
  // + 90s-nag stack). Re-surfaces only when a gated tab is opened - no timer.
  const autoVerifyRef = useRef(false)
  useEffect(() => {
    if (needsOnboarding && !autoVerifyRef.current) {
      autoVerifyRef.current = true
      setActionSheetView('getverified')
      setActionSheetOpen(true)
    }
    if (!needsOnboarding) autoVerifyRef.current = false
  }, [needsOnboarding])
  useEffect(() => {
    if (needsOnboarding && PENDING_GATED_TABS.has(studentTab)) {
      setActionSheetView('getverified')
      setActionSheetOpen(true)
    }
  }, [studentTab, needsOnboarding])

  // Celebrate newly-passed subjects (once each, per device). A queue lets us
  // show one congrats overlay at a time if several pass together.
  const [passedQueue, setPassedQueue] = useState([])
  useEffect(() => {
    if (!student?.id || !semester) return
    const subs = activeSubjects(student, classes, semester)
    const passed = computePassedSubjects(student, subs, eqScale)
    const key = `passed_celebrated:${student.id}:${semester?.label || semester?.id || 'sem'}`
    const raw = (() => { try { return localStorage.getItem(key) } catch (e) { return null } })()

    // First run for this student+semester: silently baseline whatever is already
    // passing so historical passes don't celebrate - only NEW passes after this
    // point trigger the congrats overlay.
    if (raw === null) {
      try { localStorage.setItem(key, JSON.stringify(passed.map(p => p.subject))) } catch (e) { /* ignore */ }
      return
    }

    if (!passed.length) return
    let seen = []
    try { seen = JSON.parse(raw) || [] } catch (e) { seen = [] }
    const fresh = passed.filter(p => !seen.includes(p.subject))
    if (!fresh.length) return
    // Mark every currently-passed subject seen so it never re-triggers.
    try { localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...passed.map(p => p.subject)])])) } catch (e) { /* ignore */ }
    setPassedQueue(q => [...q, ...fresh])
  }, [student, classes, semester, eqScale])

  // First-run onboarding tour - once per device, never during verification setup.
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (!student?.id || needsOnboarding) return
    let seen = true
    try { seen = !!localStorage.getItem(`onboarding_seen:${student.id}`) } catch (e) { /* ignore */ }
    if (!seen) setTourOpen(true)
  }, [student?.id, needsOnboarding])

  // Web push (FCM) - opt-in per device, no-op when unsupported/unconfigured
  const push = usePushNotifications({ db, fbReady, ownerId: student?.id, role: 'student', toast })

  // Smart deadline reminders - fires 24h / 3h before activity & quiz deadlines
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
    if (needsOnboarding || tourOpen) return
    if (notifyShownRef.current === loginTime) return
    notifyShownRef.current = loginTime
    const t = setTimeout(() => setNotifyPromptOpen(true), 1500)
    return () => clearTimeout(t)
  }, [student, push.supported, push.permission, needsOnboarding, loginTime, tourOpen])

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
    if (!studentSeesMessage(m, student, classes, semester)) return false
    const lastReadAt = m.readAt?.[id] || 0
    if (m.from !== id) {
      const studentRead = Array.isArray(m.read) && m.read.includes(id)
      if (!studentRead) return true
    }
    const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
    return lastAdminReply > lastReadAt
  }).length

  // One-time per-session login toast: if the student returns to unread class /
  // subject group-chat messages, surface a toast that deep-links into that chat.
  const groupToastRef = useRef(false)
  useEffect(() => {
    if (groupToastRef.current) return
    if (!student || !messages.length) return
    const id = student.id
    const flagKey = 'grpchat_login_toast_' + id
    try { if (sessionStorage.getItem(flagKey)) { groupToastRef.current = true; return } } catch (e) {}

    const isUnread = m => {
      if (m.from === id) return false
      const studentRead = Array.isArray(m.read) && m.read.includes(id)
      if (!studentRead) return true
      const lastReadAt = m.readAt?.[id] || 0
      const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((mx, r) => Math.max(mx, r.ts || 0), 0)
      return lastAdminReply > lastReadAt
    }
    const groupUnread = messages.filter(m =>
      m.type === 'announcement' &&
      (m.classId || (Array.isArray(m.classIds) && m.classIds.length)) &&
      studentSeesMessage(m, student, classes, semester) &&
      isUnread(m)
    )
    groupToastRef.current = true
    try { sessionStorage.setItem(flagKey, '1') } catch (e) {}
    if (!groupUnread.length) return

    // Deep-link into the most recently active group chat.
    const lastActivity = m => (m.replies?.length ? Math.max(m.ts || 0, ...m.replies.map(r => r.ts || 0)) : (m.ts || 0))
    const latest = groupUnread.reduce((a, b) => (lastActivity(b) > lastActivity(a) ? b : a))
    const n = groupUnread.length
    toastAction(`You have ${n} new message${n !== 1 ? 's' : ''} in your class group chat${n !== 1 ? 's' : ''}.`, {
      label: 'View messages',
      onAction: () => openStudentMessageThread(latest.id),
      type: 'dark',
      duration: 9000,
    })
  }, [student, messages, classes, semester]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (n) toast(n.body ? `${n.title} - ${n.body}` : n.title, 'info')
    }
  }, [studentNotifs])

  if (!student) {
    return (
      <div style={{ padding: 24 }}>
        <SkeletonDashboard />
      </div>
    )
  }

  const badges = { act: openActivityCount, quiz: openQuizCount, notif: unreadNotifCount, msg: unreadMsgCount }
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

      {/* Sidebar - collapsed icon rail on desktop, expands on hover (overlay) */}
      <div className={`sidebar-wrap${sidebarOpen ? ' open' : ''}`}>
        <StudentSidebar
          student={student}
          badges={badges}
          onSettings={() => { setActionSheetView('home'); setActionSheetOpen(true) }}
          onCompleteSetup={openVerify}
          onLogout={() => logout('manual')}
        />
      </div>

      {/* Main content */}
      <div className="admin-main">
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
                  <option key={c.id} value={c.id}>{courseShort(c.name)}{c.section ? ` - ${c.section}` : ''}</option>
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
          {/* Persistent activation prompt - the account isn't Active (and the
              protected tabs stay locked) until verification is complete. */}
          {needsOnboarding && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', marginBottom: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--accent-l)', color: 'var(--ink)' }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, lineHeight: 1.5, flex: 1 }}>
                <strong>Finish getting verified.</strong> Complete a few quick steps to unlock your grades, quizzes, and activities.
              </span>
              <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={openVerify}>
                <ShieldCheck size={14} style={{ marginRight: 5 }} /> Get verified
              </button>
            </div>
          )}
          <TabErrorBoundary key={studentTab}>
            <Suspense fallback={<SkeletonRows />}>
              {needsOnboarding && PENDING_GATED_TABS.has(studentTab) && (
                <VerificationGate onVerify={openVerify} onContact={() => setStudentTab('messages')} />
              )}
              {(!needsOnboarding || !PENDING_GATED_TABS.has(studentTab)) && <>
              {studentTab === 'stream'        && <StreamTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'overview'      && <OverviewTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'grades'        && <GradesTab        student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'attendance'    && <AttendanceTab    student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'activities'    && <ActivitiesTab    student={student} viewClassId={effectiveClassId} activities={activities} />}
              {studentTab === 'assignments'   && <AssignmentsTab   student={student} classes={classes} />}
              {studentTab === 'quizzes'       && <StudentQuizTab   student={student} viewClassId={effectiveClassId} />}
              {studentTab === 'notifications' && <NotificationsTab student={student} notifs={studentNotifs} setNotifs={setStudentNotifs} onOpenProfile={() => setProfileOpen(true)} />}
              {studentTab === 'calendar'      && <CalendarTab      student={student} viewClassId={effectiveClassId} classes={classes} />}
              {studentTab === 'onlineClasses' && <OnlineClassesTab student={student} />}
              {studentTab === 'enrollment'    && <EnrollmentTab    student={student} />}
              {studentTab === 'messages'      && <MessagesTab      student={student} messages={messages} />}
              {studentTab === 'feedback'      && <FeedbackTab      student={student} />}
              </>}
            </Suspense>
          </TabErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav - 4 primary + More */}
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
        <button className={`abn-item${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen(o => !o)} aria-label="More" aria-expanded={moreOpen}>
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
              <button className="ds-tile" onClick={() => { setMoreOpen(false); setActionSheetView('home'); setActionSheetOpen(true) }}>
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
      {/* Standalone profile editor - ACTIVE students only (header / Notifications
          tab). Onboarding profile edits happen inside the VerificationCenter. */}
      {profileOpen && (
        <Suspense fallback={null}>
          <EditProfileModal
            student={student}
            onClose={() => setProfileOpen(false)}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <StudentActionSheet
          open={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          onContact={() => setStudentTab('messages')}
          onLogout={() => logout('manual')}
          student={student}
          push={push}
          initialView={actionSheetView}
        />
      </Suspense>

      {notifyPromptOpen && (
        <Suspense fallback={null}>
          <NotifyPrompt push={push} onClose={() => setNotifyPromptOpen(false)} />
        </Suspense>
      )}

      {tourOpen && (
        <Suspense fallback={null}>
          <OnboardingTour student={student} onClose={() => setTourOpen(false)} />
        </Suspense>
      )}


      {faceModalOpen && (
        <Suspense fallback={null}>
          <FaceEnrollModal student={student} onClose={() => setFaceModalOpen(false)} />
        </Suspense>
      )}

      {passedQueue.length > 0 && (
        <Suspense fallback={null}>
          <SubjectPassedModal
            subject={passedQueue[0].subject}
            eq={passedQueue[0].eq}
            studentName={student.name}
            remaining={passedQueue.length - 1}
            onClose={() => setPassedQueue(q => q.slice(1))}
          />
        </Suspense>
      )}

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
