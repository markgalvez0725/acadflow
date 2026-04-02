import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { LayoutDashboard, School, Users, BookOpen, CalendarCheck, Bell, ClipboardList, Settings, LogOut, FileQuestion, Megaphone } from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
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
    ],
  },
  {
    label: 'Communication',
    items: [
      { id: 'notifications',  label: 'Notifications',  badgeId: 'notif', Icon: Bell },
      { id: 'activities',     label: 'Activities',     badgeId: 'act',   Icon: ClipboardList },
      { id: 'announcements',  label: 'Announcements',                    Icon: Megaphone },
    ],
  },
]

export default function AdminSidebar({ onSettingsOpen }) {
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
        <img src="/logo.png" alt="AcadFlow" style={{ width: 32, height: 32, borderRadius: 8, marginRight: 8, flexShrink: 0, objectFit: 'contain' }} />
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
                >
                  <span className="nav-icon" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
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
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sb-footer">
        <div className="sb-user">
          <div className="sb-avatar">A</div>
          <div className="sb-user-info">
            <strong>Teacher</strong>
            <span>{admin?.email || '—'}</span>
          </div>
        </div>
        <button className="sb-logout" onClick={onSettingsOpen}>
          <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={16} />
          </span>
          <span>Settings</span>
        </button>
        <button className="sb-logout" onClick={() => logout()}>
          <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <LogOut size={16} />
          </span>
          <span>Logout</span>
        </button>
        <div className="credit-footer">by lexark25</div>
      </div>
    </div>
  )
}
