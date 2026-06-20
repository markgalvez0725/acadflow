import React, { useState, useEffect, lazy, Suspense } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import AdminSidebar from './AdminSidebar'
import { SkeletonRows, TabErrorBoundary } from '@/components/primitives/SkeletonLoader'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import SessionChip from '@/components/primitives/SessionChip'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import FloatingMessenger from './FloatingMessenger'
import SemesterCalendarChip from '@/components/primitives/SemesterCalendarChip'
import CommandPaletteButton from '@/components/primitives/CommandPaletteButton'
import ConnectionStatus from '@/components/primitives/ConnectionStatus'
import { usePushNotifications } from '@/hooks/usePushNotifications'

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
  const { adminTab, toastQueue, dismissToast, dialog, resolveDialog, toast } = useUI()
  const { fbReady, messages, semester, db } = useData()
  const { loginTime, lastLogin } = useAuth()

  // Web push (FCM) for the teacher — opt-in per device, no-op when unconfigured.
  const push = usePushNotifications({ db, fbReady, ownerId: 'admin', role: 'admin', toast })
  const unreadMsgCount = messages.filter(m => m.from !== 'admin' && !m.adminRead).length
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
            <button
              className="hamburger md:hidden"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Toggle sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
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
            <SessionChip name="Admin" loginTime={loginTime} lastLogin={lastLogin} />
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

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
