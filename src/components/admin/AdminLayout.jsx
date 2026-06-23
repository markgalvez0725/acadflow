import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import AdminSidebar from './AdminSidebar'
import { SkeletonRows, TabErrorBoundary } from '@/components/primitives/SkeletonLoader'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import SemesterCalendarChip from '@/components/primitives/SemesterCalendarChip'
import CommandPaletteButton from '@/components/primitives/CommandPaletteButton'
import ConnectionStatus from '@/components/primitives/ConnectionStatus'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { Rss, LayoutDashboard, School, Users, BookOpen, CalendarCheck, FileQuestion, CalendarDays, Bell, ClipboardList, Video, Settings, LogOut, Menu, MessageSquare, Library, Radio } from 'lucide-react'

// Mobile bottom-nav: 5 primary destinations + "More" (opens a tidy sheet).
const MOBILE_NAV = [
  { id: 'dashboard',  Icon: LayoutDashboard, label: 'Home' },
  { id: 'students',   Icon: Users,           label: 'Students' },
  { id: 'grades',     Icon: BookOpen,        label: 'Grades' },
  { id: 'activities', Icon: ClipboardList,   label: 'Tasks' },
]

// Secondary destinations shown in the "More" bottom sheet on phones.
const MORE_NAV = [
  { id: 'stream',        Icon: Rss,          label: 'Stream' },
  { id: 'classes',       Icon: School,       label: 'Classes' },
  { id: 'attendance',    Icon: CalendarCheck, label: 'Attendance' },
  { id: 'quizzes',       Icon: FileQuestion, label: 'Quizzes' },
  { id: 'notifications', Icon: Bell,         label: 'Alerts' },
  { id: 'calendar',      Icon: CalendarDays, label: 'Calendar' },
  { id: 'onlineClasses', Icon: Video,        label: 'Meet' },
  { id: 'resources',     Icon: Library,      label: 'Resources' },
  { id: 'liveQuiz',      Icon: Radio,        label: 'Live Quiz' },
]

// Lazy-load tabs
const DashboardTab    = lazy(() => import('./tabs/DashboardTab'))
const ClassesTab      = lazy(() => import('./tabs/ClassesTab'))
const StudentsTab     = lazy(() => import('./tabs/StudentsTab'))
const GradesTab       = lazy(() => import('./tabs/GradesTab'))
const AttendanceTab   = lazy(() => import('./tabs/AttendanceTab'))
const ActivitiesTab   = lazy(() => import('./tabs/ActivitiesTab'))
const NotificationsTab  = lazy(() => import('./tabs/NotificationsTab'))
const QuizTab           = lazy(() => import('./tabs/QuizTab'))
const StreamTab         = lazy(() => import('./tabs/StreamTab'))
const CalendarTab       = lazy(() => import('./tabs/CalendarTab'))
const OnlineClassesTab  = lazy(() => import('./tabs/OnlineClassesTab'))
const MessagesTab       = lazy(() => import('./tabs/MessagesTab'))
const AuditLogTab       = lazy(() => import('./tabs/AuditLogTab'))
const ResourcesTab      = lazy(() => import('./tabs/ResourcesTab'))
const LiveQuizTab       = lazy(() => import('./tabs/LiveQuizTab'))

// Modals (lazy)
const AdminSettingsModal     = lazy(() => import('./modals/AdminSettingsModal'))
const StudentProfileModal    = lazy(() => import('./modals/StudentProfileModal'))
const StudentGradeEditModal  = lazy(() => import('./modals/StudentGradeEditModal'))

const TAB_TITLES = {
  stream:        ['Stream',         'Class activity feed — announcements, grades, activities, quizzes, and attendance'],
  dashboard:     ['Dashboard',     'Academic overview'],
  classes:       ['Classes',       'Manage classes and subjects'],
  students:      ['Students',      'Student roster'],
  grades:        ['Grades',        'Record and manage grades'],
  attendance:    ['Attendance',    'Track student attendance'],
  activities:    ['Activities',    'Post activities, collect submissions, and auto-grade'],
  quizzes:       ['Quizzes',       'AI-generated quizzes with auto-grading'],
  notifications:  ['Notifications',  'Real-time alerts for messages and activity submissions'],
  calendar:       ['Calendar',       'Monthly view of activities, quizzes, and announcements'],
  onlineClasses:  ['Online Classes', 'Schedule and manage Google Meet sessions for your classes'],
  messages:       ['Messages',       'Conversations with your students'],
  resources:      ['Resource Hub',   'Share modules, slides, and links per class and subject'],
  liveQuiz:       ['Live Quiz',      'Host a real-time, Kahoot-style quiz game'],
}

export default function AdminLayout() {
  const { adminTab, setAdminTab, toastQueue, dismissToast, dialog, resolveDialog, toast } = useUI()
  const { fbReady, messages, semester, db, admin, adminNotifs } = useData()
  const unreadNotifCount = (adminNotifs || []).filter(n => !n.read).length
  const { loginTime, lastLogin, logout } = useAuth()

  const adminName = admin?.name || admin?.displayName || 'Teacher'
  const adminInitial = adminName.charAt(0).toUpperCase()

  // Web push (FCM) for the teacher — opt-in per device, no-op when unconfigured.
  const push = usePushNotifications({ db, fbReady, ownerId: 'admin', role: 'admin', toast })
  const unreadMsgCount = messages.filter(m => m.from !== 'admin' && !m.adminRead).length
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Expanded full sidebar on true desktop (≥1024); on tablet it stays a navy
  // icon rail (matches the approved design). Users can still toggle it.
  const [sidebarExpanded, setSidebarExpanded] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [clock, setClock] = useState('')

  // Clock
  useEffect(() => {
    function tick() {
      const now = new Date()
      setClock(now.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Pop a toast whenever a genuinely new notification arrives (any type).
  const lastNotifTs = useRef(0)
  const notifReady = useRef(false)
  useEffect(() => {
    const list = adminNotifs || []
    if (!list.length) return
    const latest = list.reduce((m, n) => Math.max(m, n.ts || 0), 0)
    if (!notifReady.current) { notifReady.current = true; lastNotifTs.current = latest; return }
    if (latest > lastNotifTs.current) {
      const fresh = list.filter(n => (n.ts || 0) > lastNotifTs.current).sort((a, b) => b.ts - a.ts)
      lastNotifTs.current = latest
      const n = fresh[0]
      if (n) toast(n.body ? `${n.title} — ${n.body}` : n.title, 'info')
    }
  }, [adminNotifs])

  const [title, subtitle] = TAB_TITLES[adminTab] || ['', '']

  return (
    <div className="admin-layout" id="admin-portal">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`sidebar-wrap${sidebarOpen ? ' open' : ''}${sidebarExpanded ? ' expanded' : ''}`}>
        <AdminSidebar
          onSettingsOpen={() => setSettingsOpen(true)}
          onToggle={() => setSidebarExpanded(e => !e)}
        />
      </div>

      {/* Main content */}
      <div className={`admin-main${sidebarExpanded ? ' sidebar-expanded' : ''}`}>
        {/* Top bar */}
        <div className="admin-topbar">
          <div className="flex items-center gap-3">
            <div>
              <h3>{title}</h3>
              <span>{subtitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="tb-desktop-only"><ConnectionStatus /></span>
            <CommandPaletteButton />
            <ThemeToggle style={{ position: 'static', width: 36, height: 36, borderRadius: 10 }} />
            <span className="tb-desktop-only"><SemesterCalendarChip semester={semester} /></span>
            <span className="adm-clock tb-desktop-only">{clock}</span>
            <button
              onClick={() => setAdminTab('notifications')}
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

        <main className="admin-body" id="main-content" tabIndex={-1}>
          {/* Tab panels */}
          <TabErrorBoundary key={adminTab}>
            <Suspense fallback={<SkeletonRows />}>
              {adminTab === 'stream'         && <StreamTab />}
              {adminTab === 'dashboard'     && <DashboardTab />}
              {adminTab === 'classes'       && <ClassesTab />}
              {adminTab === 'students'      && <StudentsTab />}
              {adminTab === 'grades'        && <GradesTab />}
              {adminTab === 'attendance'    && <AttendanceTab />}
              {adminTab === 'activities'    && <ActivitiesTab />}
              {adminTab === 'quizzes'        && <QuizTab />}
              {adminTab === 'notifications'  && <NotificationsTab />}
              {adminTab === 'calendar'       && <CalendarTab />}
              {adminTab === 'onlineClasses' && <OnlineClassesTab />}
              {adminTab === 'messages'      && <MessagesTab />}
              {adminTab === 'audit'         && <AuditLogTab />}
              {adminTab === 'resources'     && <ResourcesTab />}
              {adminTab === 'liveQuiz'      && <LiveQuizTab />}
            </Suspense>
          </TabErrorBoundary>
        </main>
      </div>

      {/* Modals */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <AdminSettingsModal onClose={() => setSettingsOpen(false)} push={push} />
        </Suspense>
      )}

      {/* Student profile — globally openable from any teacher-side view (synced) */}
      <Suspense fallback={null}>
        <StudentProfileModal />
      </Suspense>

      {/* Per-student grade edit — opened by "Open Grades" in StudentProfileModal */}
      <Suspense fallback={null}>
        <StudentGradeEditModal />
      </Suspense>

      {/* Mobile bottom nav — 5 primary destinations + More (opens drawer) */}
      <nav className="admin-bottom-nav" aria-label="Sections">
        {MOBILE_NAV.map(t => (
          <button
            key={t.id}
            className={`abn-item${adminTab === t.id ? ' active' : ''}`}
            onClick={() => setAdminTab(t.id)}
            aria-label={t.label}
          >
            <t.Icon size={20} />
            <span className="abn-label">{t.label}</span>
          </button>
        ))}
        <button className={`abn-item${adminTab === 'messages' ? ' active' : ''}`} onClick={() => setAdminTab('messages')} aria-label="Messages">
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

      {/* Mobile "More" sheet — tidy grid of the remaining destinations */}
      {moreOpen && (
        <div className="ds-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="ds-sheet" onClick={e => e.stopPropagation()}>
            <div className="ds-sheet-grip" />
            <div className="ds-sheet-title">More</div>
            <div className="ds-sheet-grid">
              {MORE_NAV.map(t => (
                <button
                  key={t.id}
                  className={`ds-tile${adminTab === t.id ? ' active' : ''}`}
                  onClick={() => { setAdminTab(t.id); setMoreOpen(false) }}
                >
                  <t.Icon size={22} />
                  <span>{t.label}</span>
                </button>
              ))}
              <button className="ds-tile" onClick={() => { setMoreOpen(false); setSettingsOpen(true) }}>
                <Settings size={22} />
                <span>Settings</span>
              </button>
              <button className="ds-tile ds-tile-danger" onClick={() => { setMoreOpen(false); logout() }}>
                <LogOut size={22} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
