import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { LayoutDashboard, School, Users, BookOpen, CalendarCheck, Bell, ClipboardList, Settings, LogOut, FileQuestion, Rss, CalendarDays } from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'stream',    label: 'Stream',    Icon: Rss },
      { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'classes',  label: 'Classes',  Icon: School },
      { id: 'students', label: 'Students', Icon: Users },
    ],
  },
  {
    label: 'Academic',
    items: [
      { id: 'grades',     label: 'Grades',     Icon: BookOpen },
      { id: 'attendance', label: 'Attendance', Icon: CalendarCheck },
      { id: 'quizzes',    label: 'Quizzes',    Icon: FileQuestion },
      { id: 'calendar',   label: 'Calendar',   Icon: CalendarDays },
    ],
  },
  {
    label: 'Communication',
    items: [
      { id: 'notifications',  label: 'Notifications',  badgeId: 'notif', Icon: Bell },
      { id: 'activities',     label: 'Activities',     badgeId: 'act',   Icon: ClipboardList },
    ],
  },
]

export default function AdminSidebar({ onSettingsOpen, onToggle }) {
  const { logout } = useAuth()
  const { admin, adminNotifs, activities } = useData()
  const { adminTab, setAdminTab } = useUI()

  const unreadNotifs = adminNotifs.filter(n => !n.read).length
  const pendingActs  = activities.filter(a => {
    if (!a.submissions) return false
    return Object.values(a.submissions).some(s => s.status === 'pending')
  }).length

  function getBadge(badgeId) {
    if (badgeId === 'notif') return unreadNotifs
    if (badgeId === 'act')   return pendingActs
    return 0
  }

  return (
    <div className="sidebar flex flex-col h-full">
      {/* Brand */}
      <div className="sb-brand">
        <img src="/logo.png" alt="AcadFlow" style={{ width: 32, height: 32, marginRight: 8, flexShrink: 0, objectFit: 'contain' }} />
        <div>
          <h2>AcadFlow</h2>
          <span>Teacher Portal</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sb-nav flex-1 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(item => {
              const badge = item.badgeId ? getBadge(item.badgeId) : 0
              return (
                <button
                  key={item.id}
                  className={`nav-item${adminTab === item.id ? ' active' : ''}`}
                  onClick={() => setAdminTab(item.id)}
                  title={item.label}
                >
                  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <item.Icon size={18} />
                    {badge > 0 && (
                      <span style={{
                        position: 'absolute', top: -4, right: -6,
                        background: 'var(--accent)', color: '#fff',
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
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sb-footer">
        <div className="sb-user">
          <div className="sb-avatar" style={{ flexShrink: 0 }}>A</div>
          <div className="sb-user-info">
            <strong>Teacher</strong>
            <span>{admin?.email || '—'}</span>
          </div>
        </div>
        <button className="sb-logout" onClick={onSettingsOpen} title="Settings">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Settings size={16} />
          </span>
          <span className="nav-label">Settings</span>
        </button>
        <button className="sb-logout" onClick={() => logout()} title="Logout">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LogOut size={16} />
          </span>
          <span className="nav-label">Logout</span>
        </button>
        <div className="credit-footer" style={{ opacity: 0, transition: 'opacity 150ms ease' }} ref={el => el && (el.style.opacity = '')}>by lexark25</div>
      </div>

      {/* Collapse toggle (desktop only) */}
      <button className="sb-toggle" onClick={onToggle} title="Toggle sidebar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}
