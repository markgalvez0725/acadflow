import React, { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Pagination from '@/components/primitives/Pagination'
import { Mail, Upload, CheckCircle, BookOpen, MessageSquare, Bell, Trash2 } from 'lucide-react'

const PER_PAGE = 10

const ICONS = {
  msg_out:   <Mail size={16} />,
  act_sub:   <Upload size={16} />,
  act_grade: <CheckCircle size={16} />,
  act_new:   <BookOpen size={16} />,
  msg_in:    <MessageSquare size={16} />,
}

const LINK_TO_TAB = {
  grades:     { label: '→ View Grades',      tab: 'grades' },
  activities: { label: '→ View Activities',  tab: 'activities' },
  messages:   { label: '→ View Messages',    tab: 'messages' },
}

const TYPE_TO_TAB = {
  act_new:   { label: '→ View Activities', tab: 'activities' },
  act_grade: { label: '→ View Grades',     tab: 'grades' },
  msg_out:   { label: '→ View Messages',   tab: 'messages' },
  msg_in:    { label: '→ View Messages',   tab: 'messages' },
}

function resolveAction(n) {
  const rawLink = (n.link || '').replace(/^act:/, '')
  return LINK_TO_TAB[rawLink] || TYPE_TO_TAB[n.type] || null
}

export default function NotificationsTab({ student, notifs, setNotifs }) {
  const { db, fbReady } = useData()
  const { setStudentTab } = useUI()
  const [page, setPage] = useState(1)

  const sorted = [...notifs].sort((a, b) => b.ts - a.ts)
  const slice  = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  async function persistNotifs(newItems) {
    if (!fbReady || !db.current) return
    setNotifs(newItems)
    try {
      await setDoc(doc(db.current, 'notifications', student.id), { items: newItems }, { merge: false })
    } catch (e) {}
  }

  async function handleClick(n) {
    const action = resolveAction(n)
    // Mark as read
    if (!n.read) {
      const updated = notifs.map(x => x.id === n.id ? { ...x, read: true } : x)
      await persistNotifs(updated)
    }
    if (action) setStudentTab(action.tab)
  }

  async function deleteNotif(e, id) {
    e.stopPropagation()
    const updated = notifs.filter(x => x.id !== id)
    await persistNotifs(updated)
    // Adjust page if last item on page was deleted
    const totalAfter = updated.length
    const maxPage = Math.max(1, Math.ceil(totalAfter / PER_PAGE))
    if (page > maxPage) setPage(maxPage)
  }

  if (!notifs.length) {
    return (
      <div className="empty">
        <div className="empty-icon"><Bell size={40} /></div>
        No notifications yet.<br />
        <span style={{ fontSize: 12 }}>Alerts appear here when grades or activities are updated.</span>
      </div>
    )
  }

  return (
    <div className="student-notifications">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Notifications</div>
        {notifs.some(n => !n.read) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const updated = notifs.map(x => ({ ...x, read: true }))
              await persistNotifs(updated)
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="notif-list">
        {slice.map(n => {
          const icon   = ICONS[n.type] || <Bell size={16} />
          const action = resolveAction(n)
          const date   = new Date(n.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

          return (
            <div
              key={n.id}
              className={`notif-item${n.read ? '' : ' unread'}${action ? ' notif-msg' : ''}`}
              onClick={() => handleClick(n)}
              style={{ cursor: action ? 'pointer' : 'default' }}
            >
              <div className="ni-icon">{icon}</div>
              <div className="ni-body">
                <div className="ni-title">{n.title}</div>
                {n.body && <div className="ni-sub">{n.body}</div>}
                {action && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                    {action.label}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <div className="ni-time">{date}</div>
                <button
                  onClick={e => deleteNotif(e, n.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                  title="Delete notification"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Pagination total={notifs.length} perPage={PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}
