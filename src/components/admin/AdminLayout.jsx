import React, { useState, useEffect, lazy, Suspense } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import AdminSidebar from './AdminSidebar'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import ToastManager from '@/components/primitives/ToastManager'
import Dialog from '@/components/primitives/Dialog'
import SecurityPill from './SecurityPill'
import FloatingMessenger from './FloatingMessenger'

// Lazy-load tabs
const DashboardTab    = lazy(() => import('./tabs/DashboardTab'))
const ClassesTab      = lazy(() => import('./tabs/ClassesTab'))
const StudentsTab     = lazy(() => import('./tabs/StudentsTab'))
const GradesTab       = lazy(() => import('./tabs/GradesTab'))
const AttendanceTab   = lazy(() => import('./tabs/AttendanceTab'))
const ActivitiesTab   = lazy(() => import('./tabs/ActivitiesTab'))
const NotificationsTab = lazy(() => import('./tabs/NotificationsTab'))

// Modals (lazy)
const AdminSettingsModal = lazy(() => import('./modals/AdminSettingsModal'))

const TAB_TITLES = {
  dashboard:     ['Dashboard',     'Academic overview'],
  classes:       ['Classes',       'Manage classes and subjects'],
  students:      ['Students',      'Student roster'],
  grades:        ['Grades',        'Record and manage grades'],
  attendance:    ['Attendance',    'Track student attendance'],
  activities:    ['Activities',    'Post activities, collect submissions, and auto-grade'],
  notifications: ['Notifications', 'Real-time alerts for messages and activity submissions'],
}

export default function AdminLayout() {
  const { adminTab, toastQueue, dismissToast, dialog, resolveDialog } = useUI()
  const { ejs, fbReady, messages } = useData()
  const unreadMsgCount = messages.filter(m => m.from !== 'admin' && !m.adminRead).length
  const [sidebarOpen, setSidebarOpen] = useState(false)
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
      <div className={`sidebar-wrap${sidebarOpen ? ' open' : ''}`}>
        <AdminSidebar onSettingsOpen={() => setSettingsOpen(true)} />
      </div>

      {/* Main content */}
      <div className="admin-main">
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
            <span className="adm-clock">{clock}</span>
            <ThemeToggle style={{ position: 'static', width: 32, height: 32, fontSize: 14 }} />
          </div>
        </div>

        <div className="admin-body">
          {/* EJS status bar */}
          {!ejs.configured && (
            <div className="ejs-status-bar mb-3">
              <span>⚠️ Email (OTP) not configured.</span>
              <button className="link-btn text-xs" onClick={() => setSettingsOpen(true)}>
                Configure now →
              </button>
            </div>
          )}

          {/* Tab panels */}
          <Suspense fallback={<div className="text-ink2 text-sm py-4">Loading…</div>}>
            {adminTab === 'dashboard'     && <DashboardTab />}
            {adminTab === 'classes'       && <ClassesTab />}
            {adminTab === 'students'      && <StudentsTab />}
            {adminTab === 'grades'        && <GradesTab />}
            {adminTab === 'attendance'    && <AttendanceTab />}
            {adminTab === 'activities'    && <ActivitiesTab />}
            {adminTab === 'notifications' && <NotificationsTab />}
          </Suspense>
        </div>
      </div>

      {/* Modals */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <AdminSettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {/* Security pill */}
      <SecurityPill />

      {/* Floating Messenger */}
      <FloatingMessenger unreadCount={unreadMsgCount} />

      {/* Toast + Dialog */}
      <ToastManager toasts={toastQueue} onDismiss={dismissToast} />
      {dialog && <Dialog {...dialog} onResolve={resolveDialog} />}
    </div>
  )
}
