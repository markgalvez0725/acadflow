import React from 'react'
import { useUI } from '@/context/UIContext'
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, FileQuestion, Rss, CalendarDays, Video, Bell, ClipboardSignature, Settings, LogOut, Library } from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'overview', label: 'Home',   Icon: LayoutDashboard },
      { id: 'stream',   label: 'Stream', Icon: Rss },
    ],
  },
  {
    label: 'Academics',
    items: [
      { id: 'grades',     label: 'Grades',     Icon: BookOpen },
      { id: 'attendance', label: 'Attendance', Icon: CalendarCheck },
      { id: 'activities', label: 'Activities', badgeId: 'act',  Icon: ClipboardList },
      { id: 'quizzes',    label: 'Quizzes',    badgeId: 'quiz', Icon: FileQuestion },
      { id: 'resources',  label: 'Resources', Icon: Library },
    ],
  },
  {
    label: 'More',
    items: [
      { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
      { id: 'enrollment',    label: 'Enrollment',     Icon: ClipboardSignature },
      { id: 'onlineClasses', label: 'Online Classes', Icon: Video },
    ],
  },
]

export default function StudentSidebar({ student, badges = {}, onSettings, onLogout, onToggle }) {
  const { studentTab, setStudentTab } = useUI()

  function getBadge(badgeId) {
    if (badgeId === 'act')   return badges.act || 0
    if (badgeId === 'quiz')  return badges.quiz || 0
    if (badgeId === 'notif') return badges.notif || 0
    return 0
  }

  const name = student?.name || 'Student'
  const initial = name.charAt(0).toUpperCase()

  return (
    <div className="sidebar flex flex-col h-full">
      {/* Brand */}
      <div className="sb-brand">
        <img src="/logo.png" alt="AcadFlow" style={{ width: 32, height: 32, marginRight: 8, flexShrink: 0, objectFit: 'contain' }} />
        <div>
          <h2>AcadFlow</h2>
          <span>Student Portal</span>
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
                  className={`nav-item${studentTab === item.id ? ' active' : ''}`}
                  onClick={() => setStudentTab(item.id)}
                  title={item.label}
                  aria-label={item.label}
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
          <div className="sb-avatar" style={{ flexShrink: 0, overflow: 'hidden' }}>
            {student?.photo
              ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initial}
          </div>
          <div className="sb-user-info">
            <strong>{name}</strong>
            <span>{student?.snum || student?.id || '—'}</span>
          </div>
        </div>
        <button className="sb-logout" onClick={onSettings} title="Account" aria-label="Account">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Settings size={16} />
          </span>
          <span className="nav-label">Account</span>
        </button>
        <button className="sb-logout" onClick={onLogout} title="Logout" aria-label="Logout">
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LogOut size={16} />
          </span>
          <span className="nav-label">Logout</span>
        </button>
      </div>

      {/* Collapse toggle (desktop only) */}
      <button className="sb-toggle" onClick={onToggle} title="Toggle sidebar" aria-label="Toggle sidebar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}
