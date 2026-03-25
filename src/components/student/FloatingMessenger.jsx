import React, { useState, useRef, useEffect, useMemo } from 'react'
import { doc, updateDoc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { relativeTime } from '@/utils/format'
import { MessageSquare, GraduationCap, CheckCheck, X } from 'lucide-react'

function getStudentMessages(messages, s) {
  const id = s.id
  const enrolledClassIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  return messages.filter(m =>
    m.to === 'all' ||
    m.to === id ||
    (m.from === id && m.to === 'admin') ||
    (m.type === 'announcement' && m.classId && enrolledClassIds.includes(m.classId))
  ).sort((a, b) => b.ts - a.ts)
}

async function pushAdminNotif(db, s, text, type) {
  try {
    const ref = doc(db, 'notifications', 'admin')
    const { getDoc, setDoc: sd } = await import('firebase/firestore')
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
      type, read: false, ts: Date.now(),
      title: 'Reply from ' + (s.name || s.id),
      body: text.slice(0, 80),
      link: 'messages',
    }
    await sd(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}

export default function FloatingStudentMessenger({ student: s, messages, unreadCount }) {
  const { db, fbReady } = useData()
  const { toast } = useUI()
  const [open, setOpen]             = useState(false)
  const [search, setSearch]         = useState('')
  const [view, setView]             = useState('list')
  const [threadTitle, setThreadTitle] = useState('')
  const [threadEntries, setThreadEntries] = useState([])
  const [replyMsgId, setReplyMsgId] = useState(null)
  const [replyText, setReplyText]   = useState('')
  const [sending, setSending]       = useState(false)
  const threadRef = useRef(null)

  const allMsgs = useMemo(() => getStudentMessages(messages, s), [messages, s])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allMsgs
    return allMsgs.filter(m =>
      m.subject?.toLowerCase().includes(q) ||
      m.body?.toLowerCase().includes(q) ||
      (m.replies || []).some(r => r.body?.toLowerCase().includes(q))
    )
  }, [allMsgs, search])

  const items = useMemo(() => {
    const announcements = filtered.filter(m => m.type === 'announcement').sort((a, b) => b.ts - a.ts)
    const directMsgs    = filtered.filter(m => m.type !== 'announcement').sort((a, b) => b.ts - a.ts)
    const result = []
    if (directMsgs.length) {
      const latest = directMsgs[0]
      const allReplies = directMsgs.flatMap(m => m.replies || [])
      const lastActivity = allReplies.length ? Math.max(latest.ts, ...allReplies.map(r => r.ts)) : latest.ts
      const hasUnread = directMsgs.some(m => {
        if (m.from === s.id) return false
        return !(Array.isArray(m.read) && m.read.includes(s.id))
      })
      const totalReplies = directMsgs.reduce((a, m) => a + (m.replies || []).length, 0)
      result.push({ type: 'direct', latest, lastActivity, hasUnread, replyCount: totalReplies, msgCount: directMsgs.length })
    }
    announcements.forEach(m => {
      const isRead = Array.isArray(m.read) && m.read.includes(s.id)
      const lastAct = (m.replies || []).length ? Math.max(m.ts, ...(m.replies || []).map(r => r.ts)) : m.ts
      result.push({ type: 'announcement', msg: m, lastActivity: lastAct, hasUnread: !isRead })
    })
    return result.sort((a, b) => b.lastActivity - a.lastActivity)
  }, [filtered, s.id])

  useEffect(() => {
    if (view === 'thread' && threadRef.current) {
      setTimeout(() => { threadRef.current.scrollTop = threadRef.current.scrollHeight }, 80)
    }
  }, [view, threadEntries])

  async function markRead(msgIds) {
    if (!fbReady || !db.current) return
    const now = Date.now()
    for (const id of msgIds) {
      const m = messages.find(x => x.id === id)
      if (!m) continue
      if (Array.isArray(m.read) && m.read.includes(s.id)) continue
      updateDoc(doc(db.current, 'messages', id), {
        read: [...(m.read || []), s.id],
        readAt: { ...(m.readAt || {}), [s.id]: now },
      }).catch(() => {})
    }
  }

  function openConversation() {
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
    if (!directMsgs.length) {
      setThreadTitle('Teacher')
      setThreadEntries([])
      setReplyMsgId(null)
      setView('thread')
      return
    }
    const unreadIds = directMsgs
      .filter(m => m.from !== s.id && !(Array.isArray(m.read) && m.read.includes(s.id)))
      .map(m => m.id)
    markRead(unreadIds)
    const lastMsg = directMsgs[directMsgs.length - 1]
    setReplyMsgId(lastMsg.id)
    const allEntries = []
    directMsgs.forEach(m => {
      allEntries.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, isMain: true })
      ;(m.replies || []).forEach(r => allEntries.push({ ...r, isMain: false }))
    })
    allEntries.sort((a, b) => a.ts - b.ts)
    setThreadTitle('Teacher')
    setThreadEntries(allEntries)
    setView('thread')
  }

  function openMessage(msgId) {
    const m = messages.find(x => x.id === msgId)
    if (!m) return
    markRead([msgId])
    setReplyMsgId(msgId)
    const allEntries = [
      { from: m.from, body: m.body, ts: m.ts, subject: m.subject, isMain: true },
      ...(m.replies || []).map(r => ({ ...r, isMain: false })),
    ].sort((a, b) => a.ts - b.ts)
    setThreadTitle(m.subject || 'Announcement')
    setThreadEntries(allEntries)
    setView('thread')
  }

  async function sendReply() {
    const text = replyText.trim()
    if (!text) return
    if (text.length > 2000) { toast('Reply too long — maximum 2000 characters.', 'warn'); return }
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'warn'); return }
    setSending(true)
    try {
      if (replyMsgId) {
        const m = messages.find(x => x.id === replyMsgId)
        if (m) {
          const replies = [...(m.replies || []), { from: s.id, body: text, ts: Date.now() }]
          const newRead = [...new Set([...(m.read || []), s.id])]
          await updateDoc(doc(db.current, 'messages', replyMsgId), { replies, adminRead: false, read: newRead })
          setReplyText('')
          await pushAdminNotif(db.current, s, text, 'msg_in')
          if (m.type !== 'announcement') openConversation()
          else openMessage(replyMsgId)
        }
      } else {
        const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
        await setDoc(doc(db.current, 'messages', newId), {
          id: newId, from: s.id, to: 'admin',
          subject: 'Message from ' + (s.name || s.id),
          body: text, ts: Date.now(),
          read: [s.id], adminRead: false, replies: [], type: 'direct',
        })
        setReplyText('')
        openConversation()
      }
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 66, right: 24,
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,.25)',
          zIndex: 190,
        }}
      >
        <MessageSquare size={20} />
        {!open && unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#ef4444', color: '#fff',
            borderRadius: 10, fontSize: 9, fontWeight: 700,
            padding: '0 4px', lineHeight: '14px', minWidth: 14, textAlign: 'center',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 122, right: 24,
          width: 'min(340px, calc(100vw - 40px))', height: 'min(500px, calc(100vh - 160px))',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,.2)',
          zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            {view === 'thread' && (
              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', flexShrink: 0 }} onClick={() => setView('list')}>←</button>
            )}
            <span style={{ fontWeight: 700, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
              {view === 'list' ? 'Messages' : threadTitle}
            </span>
            {view === 'list' && (
              <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} onClick={openConversation}>+ New</button>
            )}
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>

          {/* List view */}
          {view === 'list' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', flexShrink: 0 }}>
                <input
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  placeholder="Search messages…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {!items.length ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
                    {search ? 'No matches.' : 'No messages yet.\nMessages from your teacher will appear here.'}
                  </div>
                ) : items.map((item) => {
                  if (item.type === 'direct') {
                    const m = item.latest
                    const preview = (m.from === s.id ? 'You: ' : '') + m.body.slice(0, 48) + (m.body.length > 48 ? '…' : '')
                    return (
                      <div key="direct" className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}`} onClick={openConversation} style={{ cursor: 'pointer' }}>
                        <div className="s-conv-avatar">T</div>
                        <div className="s-conv-body">
                          <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}Teacher</div>
                          <div className="s-conv-preview">{preview}</div>
                        </div>
                        <div className="s-conv-meta">
                          <div className="s-conv-time">{relativeTime(item.lastActivity)}</div>
                          {item.hasUnread && <div className="msg-unread-badge">●</div>}
                        </div>
                      </div>
                    )
                  }
                  const m = item.msg
                  const preview = m.body.slice(0, 48) + (m.body.length > 48 ? '…' : '')
                  return (
                    <div key={m.id} className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}`} onClick={() => openMessage(m.id)} style={{ cursor: 'pointer' }}>
                      <div className="s-conv-avatar announce">A</div>
                      <div className="s-conv-body">
                        <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}{m.subject}</div>
                        <div className="s-conv-preview">{preview}</div>
                      </div>
                      <div className="s-conv-meta">
                        <div className="s-conv-time">{relativeTime(item.lastActivity)}</div>
                        {item.hasUnread && <div className="msg-unread-badge">●</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Thread view */}
          {view === 'thread' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {threadEntries.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--ink3)', fontSize: 12, paddingTop: 24 }}>
                    No messages yet. Send the first one!
                  </div>
                )}
                {threadEntries.map((entry, i) => {
                  const isSelf = entry.from === s.id
                  const name   = isSelf ? 'You' : <><GraduationCap size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />Teacher</>
                  const date   = new Date(entry.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  const adminSeen = messages.filter(x => x.from === s.id).some(x => x.adminRead)
                  return (
                    <React.Fragment key={i}>
                      <div className={`msg-bubble-row${isSelf ? ' sent' : ''}`}>
                        <div className={`msg-bubble${isSelf ? ' sent' : ' received'}`} style={{ fontSize: 13 }}>
                          {entry.isMain && entry.subject && !isSelf && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', marginBottom: 3, textTransform: 'uppercase' }}>{entry.subject}</div>
                          )}
                          <div>{entry.body.split('\n').map((l, j) => <React.Fragment key={j}>{l}<br /></React.Fragment>)}</div>
                        </div>
                      </div>
                      <div className={`msg-meta${isSelf ? ' msg-meta-sent' : ' msg-meta-recv'}`} style={{ fontSize: 10 }}>
                        {name} · {date}
                        {isSelf && (
                          <span className={`msg-tick${adminSeen ? ' msg-tick-read' : ''}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <CheckCheck size={11} />
                          </span>
                        )}
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
                <textarea
                  className="input"
                  style={{ flex: 1, resize: 'none', fontSize: 12 }}
                  placeholder="Type a message… (Enter to send)"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  rows={2}
                  disabled={sending}
                />
                <button
                  className="btn btn-primary btn-sm"
                  style={{ alignSelf: 'flex-end', padding: '0 14px', height: 34, flexShrink: 0 }}
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                >
                  {sending ? '…' : '➤'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
