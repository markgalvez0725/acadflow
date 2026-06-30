import React, { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Pagination from '@/components/primitives/Pagination'
import { Mail, Upload, CheckCircle, BookOpen, MessageSquare, Bell, Trash2, Megaphone, Video, UserCircle, FileQuestion } from 'lucide-react'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import EmptyState from '@/components/ds/EmptyState'
import { applyNotifPrefs, isNotifAllowed } from '@/utils/notifPrefs'
import { parseRecordTarget, HIGHLIGHT_READY } from '@/navigation/notifTarget'

const PER_PAGE = 10

const ICONS = {
  msg_out:   <Mail size={16} />,
  act_sub:   <Upload size={16} />,
  act_grade: <CheckCircle size={16} />,
  act_new:   <BookOpen size={16} />,
  quiz_new:  <FileQuestion size={16} />,
  msg_in:    <MessageSquare size={16} />,
  announce:  <Megaphone size={16} />,
  meeting_scheduled: <Video size={16} />,
  meeting_live:      <Video size={16} />,
  meeting_cancelled: <Video size={16} />,
  meeting_ended:     <Video size={16} />,
  profile:   <UserCircle size={16} />,
}

const LINK_TO_TAB = {
  grades:     { label: '→ View Grades',      tab: 'grades' },
  activities: { label: '→ View Activities',  tab: 'activities' },
  messages:   { label: '→ View Messages',    tab: 'messages' },
  overview:   { label: '→ View Overview',    tab: 'overview' },
  profile:    { label: '→ Update profile',   tab: 'profile' },
}

const TYPE_TO_TAB = {
  act_new:   { label: '→ View Activities', tab: 'activities' },
  quiz_new:  { label: '→ View Quiz',       tab: 'quizzes' },
  profile:   { label: '→ Update profile',  tab: 'profile' },
  act_grade: { label: '→ View Grades',     tab: 'grades' },
  msg_out:   { label: '→ View Messages',   tab: 'messages' },
  msg_in:    { label: '→ View Messages',   tab: 'messages' },
  announce:  { label: '→ View Overview',   tab: 'overview' },
  meeting_scheduled: { label: '→ View Online Classes', tab: 'onlineClasses' },
  meeting_live:      { label: '→ Join Meeting',        tab: 'onlineClasses' },
  meeting_cancelled: { label: '→ View Online Classes', tab: 'onlineClasses' },
  meeting_ended:     { label: '→ View Online Classes', tab: 'onlineClasses' },
}

function resolveAction(n) {
  const rawLink = (n.link || '').replace(/^act:/, '')
  return LINK_TO_TAB[rawLink] || TYPE_TO_TAB[n.type] || null
}

export default function NotificationsTab({ student, notifs, setNotifs, onOpenProfile }) {
  const { db, fbReady, activities, quizzes, meetings } = useData()
  const { setStudentTab, openDialog, toast, navigateToTarget, openStreamAnnouncement, openStudentMessageThread, openStudentDirectThread } = useUI()
  const [page, setPage] = useState(1)

  // Does the record a notification points at still exist? Prevents landing on a
  // blank panel for an activity/quiz/meeting the professor has since deleted.
  function recordExists(type, id) {
    if (type === 'activity') return (activities || []).some(a => a.id === id)
    if (type === 'quiz')     return (quizzes || []).some(q => q.id === id)
    if (type === 'meeting')  return (meetings || []).some(m => m.id === id)
    return true // unknown types: don't block the redirect
  }

  // The class the deep-linked record belongs to, preferring one the student is
  // actually enrolled in (a quiz can span several classes).
  function classForTarget(rec) {
    if (rec.type === 'activity') return (activities || []).find(a => a.id === rec.id)?.classId || null
    if (rec.type === 'quiz') {
      const cids = (quizzes || []).find(q => q.id === rec.id)?.classIds || []
      const mine = student?.classIds?.length ? student.classIds : (student?.classId ? [student.classId] : [])
      return cids.find(id => mine.includes(id)) || cids[0] || null
    }
    return null
  }

  // Hide categories the student has muted in their notification preferences.
  const visible = applyNotifPrefs(notifs, student?.notifPrefs)
  const sorted  = [...visible].sort((a, b) => b.ts - a.ts)
  const slice   = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  async function persistNotifs(newItems) {
    if (!fbReady || !db.current) return
    setNotifs(newItems)
    try {
      await setDoc(doc(db.current, 'notifications', student.id), { items: newItems }, { merge: false })
    } catch (e) {}
  }

  async function handleClick(n) {
    // Mark as read first so the redirect can't swallow the state update.
    if (!n.read) {
      await persistNotifs(notifs.map(x => x.id === n.id ? { ...x, read: true } : x))
    }

    // A specific-record link ("act:ID" etc.) deep-links to that exact record.
    const rec = parseRecordTarget(n)
    if (rec) {
      if (rec.type === 'announcement') { openStreamAnnouncement(rec.id); return }
      if (rec.type === 'message') { openStudentMessageThread(rec.id); return } // broadcast/announcement thread
      if (rec.id && !recordExists(rec.type, rec.id)) {
        toast('That item is no longer available.', 'warn')
        setStudentTab(rec.tab) // land on the module rather than a blank panel
        return
      }
      // The student feed is scoped to one class at a time, so switch the viewed
      // class to the record's so a deep-linked activity/quiz from another class
      // actually renders (and glows).
      navigateToTarget({
        side: 'student',
        tab: rec.tab,
        type: HIGHLIGHT_READY.has(rec.type) ? rec.type : undefined,
        id: rec.id,
        classId: classForTarget(rec),
      })
      return
    }

    // Direct 1:1 professor message → open that conversation.
    if (n.link === 'msgdirect') { openStudentDirectThread(); return }

    // Otherwise fall back to the tab-name routing.
    const action = resolveAction(n)
    if (action?.tab === 'profile') onOpenProfile?.()
    else if (action) setStudentTab(action.tab)
  }

  async function deleteNotif(e, id) {
    e.stopPropagation()
    const ok = await openDialog({
      title: 'Delete notification?',
      msg: 'This will remove it permanently.',
      type: 'danger',
      confirmLabel: 'Delete',
      showCancel: true,
    })
    if (!ok) return
    const updated = notifs.filter(x => x.id !== id)
    await persistNotifs(updated)
    // Adjust page if last item on page was deleted
    const totalAfter = updated.length
    const maxPage = Math.max(1, Math.ceil(totalAfter / PER_PAGE))
    if (page > maxPage) setPage(maxPage)
  }

  if (!visible.length) {
    return (
      <EmptyState
        Icon={Bell}
        title="No notifications yet"
        text="Alerts appear here when grades or activities are updated."
      />
    )
  }

  if (!fbReady) return <SkeletonRows />

  return (
    <div className="student-notifications">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Notifications</div>
        {visible.some(n => !n.read) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              // Only mark the currently-visible (unmuted) notifications as read.
              const updated = notifs.map(x => isNotifAllowed(x, student?.notifPrefs) ? { ...x, read: true } : x)
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
                  aria-label="Delete notification"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Pagination total={sorted.length} perPage={PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}
