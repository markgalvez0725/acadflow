import React from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { studentStanding } from '@/utils/groupChat'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, FileQuestion, Rss, CalendarDays, Video, ClipboardSignature, Settings, LogOut, ListChecks, MessageSquarePlus, MessageSquare } from 'lucide-react'

// Flat, Instagram-style nav list (no section headers).
const NAV_ITEMS = [
  { id: 'overview',      label: 'Home',           Icon: LayoutDashboard },
  { id: 'stream',        label: 'Stream',         Icon: Rss },
  { id: 'grades',        label: 'Grades',         Icon: BookOpen },
  { id: 'attendance',    label: 'Attendance',     Icon: CalendarCheck },
  { id: 'activities',    label: 'Activities',     badgeId: 'act',  Icon: ClipboardList },
  { id: 'assignments',   label: 'Assignments',    Icon: ListChecks },
  { id: 'quizzes',       label: 'Quizzes',        badgeId: 'quiz', Icon: FileQuestion },
  { id: 'messages',      label: 'Messages',       badgeId: 'msg',  Icon: MessageSquare },
  { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
  { id: 'enrollment',    label: 'Enrollment',     Icon: ClipboardSignature },
  { id: 'onlineClasses', label: 'Online Classes', Icon: Video },
  { id: 'feedback',      label: 'Feedback',       Icon: MessageSquarePlus },
]

export default function StudentSidebar({ student, badges = {}, onSettings, onLogout, onCompleteSetup }) {
  const { studentTab, setStudentTab } = useUI()
  const { classes = [] } = useData()

  function getBadge(badgeId) {
    if (badgeId === 'act')   return badges.act || 0
    if (badgeId === 'quiz')  return badges.quiz || 0
    if (badgeId === 'notif') return badges.notif || 0
    if (badgeId === 'msg')   return badges.msg || 0
    return 0
  }

  const name = student?.name || 'Student'
  const initial = name.charAt(0).toUpperCase()
  const snum = student?.snum || student?.id || '-'
  const tag = studentStanding(student, classes)
  const subText = tag && tag !== snum ? `${tag} - ${snum}` : snum

  return (
    <div className="sidebar flex flex-col h-full">
      {/* Brand */}
      <div className="sb-brand">
        <img src="/brand/logo-mark.svg" alt="AcadFlow" style={{ width: 42, height: 42, marginRight: 10, flexShrink: 0, objectFit: 'contain' }} />
        <div>
          <h2>AcadFlow</h2>
          <span>Student Portal</span>
        </div>
      </div>

      {/* Nav - flat list */}
      <nav className="sb-nav flex-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
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
          <div className="sb-avatar" style={{ flexShrink: 0, overflow: 'hidden' }}>
            {student?.photo
              ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initial}
          </div>
          <div className="sb-user-info">
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <VerifiedBadge student={student} size={14} onPendingClick={onCompleteSetup} />
            </strong>
            <span>{subText}</span>
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
    </div>
  )
}
