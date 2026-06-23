import React, { useState, useRef, useEffect, useMemo } from 'react'
import { doc, updateDoc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { relativeTime } from '@/utils/format'
import { getStudentMessages } from '@/utils/studentMessages'
import { notifyAdminMessage } from '@/firebase/messageNotify'
import { fbAddMessageReply, fbMarkMessageRead } from '@/firebase/persistence'
import { MessageSquare, GraduationCap, CheckCheck, X, Send } from 'lucide-react'


export default function FloatingStudentMessenger({ student: s, messages, unreadCount, open: openProp, onOpenChange }) {
  const { db, fbReady, classes, semester } = useData()
  const { toast } = useUI()
  const [openLocal, setOpenLocal] = useState(false)
  const open = openProp !== undefined ? openProp : openLocal
  const setOpen = (next) => {
    const v = typeof next === 'function' ? next(open) : next
    if (onOpenChange) onOpenChange(v); else setOpenLocal(v)
  }
  const [search, setSearch]         = useState('')
  const [view, setView]             = useState('list')
  const [threadTitle, setThreadTitle] = useState('')
  const [threadMode, setThreadMode] = useState('direct') // 'direct' | 'single'
  const [replyMsgId, setReplyMsgId] = useState(null)
  const [replyText, setReplyText]   = useState('')
  const [sending, setSending]       = useState(false)
  const threadRef = useRef(null)

  const allMsgs = useMemo(() => getStudentMessages(messages, s, classes, semester), [messages, s, classes, semester])

  // Thread entries are derived live from messages so new teacher messages and
  // replies appear in real time while the thread is open (no stale snapshot).
  const threadEntries = useMemo(() => {
    if (view !== 'thread') return []
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
    const baseMsgs = threadMode === 'single'
      ? allMsgs.filter(m => m.id === replyMsgId)
      : directMsgs
    const entries = []
    baseMsgs.forEach(m => {
      entries.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, isMain: true })
      ;(m.replies || []).forEach(r => entries.push({ from: r.from, body: r.body, ts: r.ts, isMain: false }))
    })
    return entries.sort((a, b) => a.ts - b.ts)
  }, [allMsgs, view, threadMode, replyMsgId])

  // Keep the open thread marked read as new teacher messages arrive (clears the
  // unread badge). Only writes when something actually needs marking — no loop.
  useEffect(() => {
    if (view !== 'thread' || !fbReady || !db.current) return
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement')
    const targets = threadMode === 'single' ? allMsgs.filter(m => m.id === replyMsgId) : directMsgs
    const need = targets.filter(m => {
      const lastReadAt = m.readAt?.[s.id] || 0
      const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((mx, r) => Math.max(mx, r.ts || 0), 0)
      const baseUnread = m.from !== s.id && !(Array.isArray(m.read) && m.read.includes(s.id))
      return baseUnread || lastAdminReply > lastReadAt
    })
    if (need.length) markRead(need.map(m => m.id))
  }, [allMsgs, view, threadMode, replyMsgId])

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
        const lastReadAt = m.readAt?.[s.id] || 0
        if (m.from !== s.id) {
          const studentRead = Array.isArray(m.read) && m.read.includes(s.id)
          if (!studentRead) return true
        }
        const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
        return lastAdminReply > lastReadAt
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
      const lastReplyTs = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
      fbMarkMessageRead(db.current, id, s.id, Math.max(now, lastReplyTs)).catch(() => {})
    }
  }

  function openConversation() {
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
    setThreadMode('direct')
    setThreadTitle('Teacher')
    if (directMsgs.length) {
      // Mark the whole conversation read — including teacher replies on threads
      // the student started (those base messages are from the student).
      markRead(directMsgs.map(m => m.id))
      setReplyMsgId(directMsgs[directMsgs.length - 1].id)
    } else {
      setReplyMsgId(null)
    }
    setView('thread')
  }

  function openMessage(msgId) {
    const m = messages.find(x => x.id === msgId)
    if (!m) return
    setThreadMode('single')
    markRead([msgId])
    setReplyMsgId(msgId)
    setThreadTitle(m.subject || 'Announcement')
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
        const newReply = { from: s.id, body: text, ts: Date.now() }
        setReplyText('')
        // Atomic append — won't clobber a teacher reply sent at the same time.
        // The live thread memo picks it up from the messages listener.
        await fbAddMessageReply(db.current, replyMsgId, newReply, { readerId: s.id, adminRead: false })
        notifyAdminMessage(db.current, s.name || s.id, text, 'reply')
      } else {
        const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
        setReplyText('')
        await setDoc(doc(db.current, 'messages', newId), {
          id: newId, from: s.id, to: 'admin',
          subject: 'Message from ' + (s.name || s.id),
          body: text, ts: Date.now(),
          read: [s.id], adminRead: false, replies: [], type: 'direct',
        })
        notifyAdminMessage(db.current, s.name || s.id, text, 'message')
        // Future replies append to this new message; thread stays in direct mode.
        setThreadMode('direct')
        setReplyMsgId(newId)
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
        className="fm-bubble"
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 'calc(86px + env(safe-area-inset-bottom, 0px))', right: 18,
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
          position: 'fixed', bottom: 'calc(146px + env(safe-area-inset-bottom, 0px))', right: 18,
          width: 'min(340px, calc(100vw - 40px))', height: 'min(500px, calc(100vh - 220px))',
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
                  aria-label="Search messages"
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
                  {sending ? '…' : <Send size={16} />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
