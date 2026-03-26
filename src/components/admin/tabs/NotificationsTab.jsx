import React, { useState, useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Pagination from '@/components/primitives/Pagination'
import { MessageSquare, Upload, CheckCircle, ClipboardList, Mail, Bell, Trash2 } from 'lucide-react'

const PER_PAGE = 10

const NOTIF_ICONS = {
  msg_in:    <MessageSquare size={16} />,
  act_sub:   <Upload size={16} />,
  act_grade: <CheckCircle size={16} />,
  act_new:   <ClipboardList size={16} />,
  msg_out:   <Mail size={16} />,
}

export default function NotificationsTab() {
  const { adminNotifs, setAdminNotifs, db, fbReady } = useData()
  const { openDialog, setAdminTab } = useUI()
  const [page, setPage] = useState(1)

  const sorted = useMemo(
    () => [...adminNotifs].sort((a, b) => b.ts - a.ts),
    [adminNotifs]
  )

  const slice = useMemo(
    () => sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [sorted, page]
  )

  // ── Persist updated notifs to Firestore ──────────────────────────
  async function persist(updated) {
    setAdminNotifs(updated)
    if (fbReady && db.current) {
      setDoc(doc(db.current, 'notifications', 'admin'), { items: updated }, { merge: false }).catch(() => {})
    }
  }

  // ── Mark one as read ─────────────────────────────────────────────
  async function markRead(id) {
    const updated = adminNotifs.map(n => n.id === id ? { ...n, read: true } : n)
    await persist(updated)
  }

  // ── Mark all as read ─────────────────────────────────────────────
  async function markAllRead() {
    const updated = adminNotifs.map(n => ({ ...n, read: true }))
    await persist(updated)
  }

  // ── Delete one ───────────────────────────────────────────────────
  async function deleteNotif(id) {
    const updated = adminNotifs.filter(n => n.id !== id)
    await persist(updated)
    if (page > 1 && slice.length === 1) setPage(p => p - 1)
  }

  // ── Clear all ────────────────────────────────────────────────────
  async function clearAll() {
    if (!adminNotifs.length) return
    const ok = await openDialog({
      title: 'Clear all notifications?',
      msg: 'Delete all notifications? This cannot be undone.',
      type: 'danger',
      confirmLabel: 'Clear All',
      showCancel: true,
    })
    if (!ok) return
    await persist([])
    setPage(1)
  }

  // ── Handle notif click → navigate ────────────────────────────────
  async function handleClick(n) {
    await markRead(n.id)
    if (!n.link) return
    if (n.link === 'messages') {
      setAdminTab('messages')
    } else if (n.link === 'activities' || String(n.link || '').startsWith('act:')) {
      setAdminTab('activities')
    }
  }

  const unreadCount = adminNotifs.filter(n => !n.read).length

  return (
    <div>
      {/* Header */}
      <div className="sec-hdr mb-3">
        <div className="sec-title">
          Notifications
          {unreadCount > 0 && (
            <span style={{ marginLeft: 8, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px', verticalAlign: 'middle' }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark All Read</button>
          )}
          {adminNotifs.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={clearAll}>Clear All</button>
          )}
        </div>
      </div>

      {/* List */}
      {!adminNotifs.length ? (
        <div id="admin-notif-list" className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
          <div className="empty">
            <div className="empty-icon"><Bell size={32} /></div>
            No notifications yet.<br />
            <span style={{ fontSize: 12 }}>Alerts appear here when students message or submit activities.</span>
          </div>
        </div>
      ) : (
        <>
          <div id="admin-notif-list" className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
            {slice.map(n => {
              const icon = NOTIF_ICONS[n.type] || <Bell size={16} />
              const date = new Date(n.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              const hasLink = !!n.link
              const actionHint = n.link === 'messages'
                ? '→ Open conversation'
                : (n.link === 'activities' || String(n.link || '').startsWith('act:'))
                ? '→ View activity'
                : null

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
                    {actionHint && <div className="notif-action-hint">{actionHint}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <div className="ni-time">{date}</div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteNotif(n.id) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 14, padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
                      title="Delete notification"
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination total={sorted.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}
    </div>
  )
}
