import React, { useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { MessageSquare, Upload, CheckCircle, ClipboardList, Mail, Bell, Trash2, Megaphone, FileQuestion } from 'lucide-react'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import EmptyState from '@/components/ds/EmptyState'

const NOTIF_ICONS = {
  msg_in:    <MessageSquare size={16} />,
  msg_out:   <Mail size={16} />,
  act_sub:   <Upload size={16} />,
  act_grade: <CheckCircle size={16} />,
  act_new:   <ClipboardList size={16} />,
}

// Group notifications by type into stacked, organised sections.
const CATEGORIES = [
  { key: 'messages',      label: 'Messages',      Icon: MessageSquare, match: t => t === 'msg_in' || t === 'msg_out' },
  { key: 'activities',    label: 'Activities',    Icon: ClipboardList, match: t => String(t).startsWith('act') },
  { key: 'announcements', label: 'Announcements', Icon: Megaphone,     match: t => String(t).startsWith('ann') },
  { key: 'quizzes',       label: 'Quizzes',       Icon: FileQuestion,  match: t => String(t).startsWith('quiz') },
  { key: 'other',         label: 'Other',         Icon: Bell,          match: () => true },
]

function categoryOf(type) {
  return (CATEGORIES.find(c => c.match(type)) || CATEGORIES[CATEGORIES.length - 1]).key
}

export default function NotificationsTab() {
  const { adminNotifs, setAdminNotifs, db, fbReady } = useData()
  const { openDialog, setAdminTab } = useUI()

  const sorted = useMemo(() => [...adminNotifs].sort((a, b) => b.ts - a.ts), [adminNotifs])

  const groups = useMemo(() => {
    const g = {}
    sorted.forEach(n => { const k = categoryOf(n.type); (g[k] = g[k] || []).push(n) })
    return g
  }, [sorted])

  async function persist(updated) {
    setAdminNotifs(updated)
    if (fbReady && db.current) {
      setDoc(doc(db.current, 'notifications', 'admin'), { items: updated }, { merge: false }).catch(() => {})
    }
  }

  async function markRead(id) {
    await persist(adminNotifs.map(n => n.id === id ? { ...n, read: true } : n))
  }
  async function markAllRead() {
    await persist(adminNotifs.map(n => ({ ...n, read: true })))
  }
  async function deleteNotif(id) {
    await persist(adminNotifs.filter(n => n.id !== id))
  }
  async function clearAll() {
    if (!adminNotifs.length) return
    const ok = await openDialog({ title: 'Clear all notifications?', msg: 'Delete all notifications? This cannot be undone.', type: 'danger', confirmLabel: 'Clear All', showCancel: true })
    if (ok) await persist([])
  }

  async function handleClick(n) {
    await markRead(n.id)
    if (!n.link) return
    if (n.link === 'messages') setAdminTab('messages')
    else if (n.link === 'activities' || String(n.link || '').startsWith('act:')) setAdminTab('activities')
  }

  if (!fbReady) return <SkeletonRows />

  const unreadCount = adminNotifs.filter(n => !n.read).length

  return (
    <div>
      <div className="ds-page-head">
        <div className="ds-ph-main">
          <h1>Notifications</h1>
          <p>{unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up'}</p>
        </div>
        {adminNotifs.length > 0 && (
          <div className="ds-ph-actions">
            {unreadCount > 0 && <button className="btn" onClick={markAllRead}>Mark all read</button>}
            <button className="btn btn-danger" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {!adminNotifs.length ? (
        <div className="ds-card">
          <EmptyState Icon={Bell} title="No notifications yet" text="Alerts appear here when students message you or submit work." />
        </div>
      ) : (
        CATEGORIES.map(cat => {
          const items = groups[cat.key]
          if (!items || !items.length) return null
          const catUnread = items.filter(n => !n.read).length
          return (
            <div className="ds-card mb-4" key={cat.key}>
              <div className="ds-card-h">
                <h3><cat.Icon /> {cat.label}</h3>
                <span style={{ fontSize: 12, fontWeight: 700, color: catUnread ? 'var(--accent)' : 'var(--ink3)' }}>
                  {catUnread ? `${catUnread} new` : `${items.length}`}
                </span>
              </div>
              {items.map(n => {
                const icon = NOTIF_ICONS[n.type] || <Bell size={16} />
                const date = new Date(n.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                const hasLink = !!n.link
                return (
                  <div
                    key={n.id}
                    className={`notif-item ${n.read ? '' : 'unread'} ${hasLink ? 'notif-msg' : ''}`}
                    onClick={() => handleClick(n)}
                    style={{ position: 'relative', cursor: hasLink ? 'pointer' : 'default' }}
                  >
                    <div className="ni-icon">{icon}</div>
                    <div className="ni-body">
                      <div className="ni-title">{n.title}</div>
                      <div className="ni-sub">{n.body}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <div className="ni-time">{date}</div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteNotif(n.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
                        title="Delete notification"
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
