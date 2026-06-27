import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import BrandMark from '@/components/primitives/BrandMark'
import { LayoutDashboard, School, Users, BookOpen, CalendarCheck, Bell, ClipboardList, Settings, LogOut, FileQuestion, Rss, CalendarDays, Video, History, MessageSquare, MessageSquarePlus, ShieldCheck } from 'lucide-react'

// Flat, Instagram-style nav list (no section headers).
const NAV_ITEMS = [
  { id: 'stream',         label: 'Stream',         Icon: Rss },
  { id: 'dashboard',      label: 'Dashboard',      Icon: LayoutDashboard },
  { id: 'classes',        label: 'Classes',        Icon: School },
  { id: 'students',       label: 'Students',       Icon: Users },
  { id: 'grades',         label: 'Grades',         Icon: BookOpen },
  { id: 'integrity',      label: 'Grade Integrity', Icon: ShieldCheck },
  { id: 'attendance',     label: 'Attendance',     Icon: CalendarCheck },
  { id: 'quizzes',        label: 'Quizzes',        Icon: FileQuestion },
  { id: 'activities',     label: 'Activities',     badgeId: 'act',   Icon: ClipboardList },
  { id: 'messages',       label: 'Messages',       badgeId: 'msg',   Icon: MessageSquare },
  { id: 'notifications',  label: 'Notifications',  badgeId: 'notif', Icon: Bell },
  { id: 'onlineClasses',  label: 'Online Classes', Icon: Video },
  { id: 'calendar',       label: 'Calendar',       Icon: CalendarDays },
  { id: 'feedback',       label: 'Feedback Hub',   Icon: MessageSquarePlus },
  { id: 'audit',          label: 'Audit Log',      Icon: History },
]

export default function AdminSidebar({ onSettingsOpen }) {
  const { logout } = useAuth()
  const { admin, adminNotifs, activities, messages } = useData()
  const { adminTab, setAdminTab } = useUI()

  const unreadNotifs = adminNotifs.filter(n => !n.read).length
  const unreadMsgs   = (messages || []).filter(m => m.from !== 'admin' && !m.adminRead).length
  const pendingActs  = activities.filter(a => {
    if (!a.submissions) return false
    return Object.values(a.submissions).some(s => s.status === 'pending')
  }).length

  function getBadge(badgeId) {
    if (badgeId === 'notif') return unreadNotifs
    if (badgeId === 'act')   return pendingActs
    if (badgeId === 'msg')   return unreadMsgs
    return 0
  }

  const adminName = admin?.name || admin?.displayName || 'Professor'
  const adminInitial = adminName.charAt(0).toUpperCase()

  return (
    <div className="sidebar flex flex-col h-full">
      {/* Brand */}
      <div className="sb-brand">
        <span className="sb-brand-logo"><BrandMark height={30} /></span>
        <div>
          <h2>AcadFlow</h2>
          <span>Professor Portal</span>
        </div>
      </div>

      {/* Nav - flat list */}
      <nav className="sb-nav flex-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const badge = item.badgeId ? getBadge(item.badgeId) : 0
          return (
            <button
              key={item.id}
              className={`nav-item${adminTab === item.id ? ' active' : ''}`}
              onClick={() => setAdminTab(item.id)}
              title={item.label}
              aria-label={item.label}
            >
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <item.Icon size={24} />
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -7,
                    background: 'var(--red)', color: '#fff',
                    borderRadius: 999, fontSize: 9, fontWeight: 700,
                    padding: '0 4px', lineHeight: '15px', minWidth: 15, height: 15,
                    textAlign: 'center', boxShadow: '0 0 0 2px var(--navy)',
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

      {/* Footer */}
      <div className="sb-footer">
        <div className="sb-user">
          <div className="sb-avatar" style={{ flexShrink: 0, overflow: 'hidden', padding: 0 }}>
            {admin?.photo
              ? <img src={admin.photo} alt={adminName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : adminInitial}
          </div>
          <div className="sb-user-info">
            <strong>{adminName}</strong>
            <span>{admin?.email || '-'}</span>
          </div>
        </div>
        <button className="sb-logout" onClick={onSettingsOpen} title="Settings" aria-label="Settings">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Settings size={16} />
          </span>
          <span className="nav-label">Settings</span>
        </button>
        <button className="sb-logout" onClick={() => logout()} title="Logout" aria-label="Logout">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LogOut size={16} />
          </span>
          <span className="nav-label">Logout</span>
        </button>
        <div className="credit-footer">by lexark25</div>
      </div>
    </div>
  )
}
