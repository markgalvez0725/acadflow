import React, { useState, useEffect, lazy, Suspense } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import AdminSidebar from './AdminSidebar'
import { SkeletonRows, TabErrorBoundary } from '@/components/primitives/SkeletonLoader'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import FloatingMessenger from './FloatingMessenger'
import SemesterCalendarChip from '@/components/primitives/SemesterCalendarChip'
import CommandPaletteButton from '@/components/primitives/CommandPaletteButton'
import ConnectionStatus from '@/components/primitives/ConnectionStatus'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { Rss, LayoutDashboard, School, Users, BookOpen, CalendarCheck, FileQuestion, CalendarDays, Bell, ClipboardList, Video, Settings, LogOut, Menu } from 'lucide-react'

// Mobile bottom-nav: 5 primary destinations + "More" (opens the full drawer).
const MOBILE_NAV = [
  { id: 'dashboard',  Icon: LayoutDashboard, label: 'Home' },
  { id: 'students',   Icon: Users,           label: 'Students' },
  { id: 'grades',     Icon: BookOpen,        label: 'Grades' },
  { id: 'activities', Icon: ClipboardList,   label: 'Tasks' },
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

// Modals (lazy)
const AdminSettingsModal = lazy(() => import('./modals/AdminSettingsModal'))

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
}

export default function AdminLayout() {
  const { adminTab, setAdminTab, toastQueue, dismissToast, dialog, resolveDialog, toast } = useUI()
  const { fbReady, messages, semester, db, admin } = useData()
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

  const [title, subtitle] = TAB_TITLES[adminTab] || ['', '']

  return (
    <div className="admin-layout" id="admin-portal">
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
            {/* Profile avatar — opens Settings / Logout */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setProfileOpen(o => !o)}
                title="Account"
                aria-label="Account options"
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700, fontSize: 16,
                }}
              >
                {adminInitial}
              </button>
              {profileOpen && (
                <>
                  <div onClick={() => setProfileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 61,
                    minWidth: 210, background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 6,
                  }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{adminName}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{admin?.email || '—'}</div>
                    </div>
                    <button
                      onClick={() => { setProfileOpen(false); setSettingsOpen(true) }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontSize: 13, borderRadius: 8, textAlign: 'left' }}
                    >
                      <Settings size={16} /> Settings
                    </button>
                    <button
                      onClick={() => { setProfileOpen(false); logout() }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 13, borderRadius: 8, textAlign: 'left' }}
                    >
                      <LogOut size={16} /> Logout
                    </button>
                  </div>
                </>
              )}
            </div>
            <div>
              <h3>{title}</h3>
              <span>{subtitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <CommandPaletteButton />
            <SemesterCalendarChip semester={semester} />
            <span className="adm-clock hidden sm:inline">{clock}</span>
            <ThemeToggle style={{ position: 'static', width: 32, height: 32, fontSize: 14 }} />
          </div>
        </div>

        <div className="admin-body">
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
            </Suspense>
          </TabErrorBoundary>
        </div>
      </div>

      {/* Modals */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <AdminSettingsModal onClose={() => setSettingsOpen(false)} push={push} />
        </Suspense>
      )}

      {/* Floating Messenger */}
      <FloatingMessenger unreadCount={unreadMsgCount} />

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
        <button className="abn-item" onClick={() => setSidebarOpen(true)} aria-label="More">
          <Menu size={20} />
          <span className="abn-label">More</span>
        </button>
      </nav>

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
