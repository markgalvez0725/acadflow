import React, { useState, useMemo, useRef, useEffect } from 'react'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import Modal from '@/components/primitives/Modal'
import { MessageSquare, X } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────
function msgId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function relativeTime(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  if (days < 7) return days + 'd ago'
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

function getInitials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// ── Compose Modal ─────────────────────────────────────────────────────
function ComposeModal({ onClose }) {
  const { students, classes, db, fbReady } = useData()
  const { toast } = useUI()
  const [to, setTo]           = useState('all')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [err, setErr]         = useState('')
  const [sending, setSending] = useState(false)

  const classGroups = useMemo(() => {
    const groups = {}
    students.forEach(s => {
      const cls = classes.find(c => c.id === s.classId)
      const label = cls ? cls.name + ' ' + cls.section : 'Unassigned'
      if (!groups[label]) groups[label] = []
      groups[label].push(s)
    })
    return groups
  }, [students, classes])

  async function handleSend() {
    setErr('')
    if (!subject.trim()) { setErr('Subject is required.'); return }
    if (!body.trim())    { setErr('Message body is required.'); return }
    if (subject.length > 200) { setErr('Subject too long (max 200 chars).'); return }
    if (body.length > 3000)   { setErr('Message too long (max 3000 chars).'); return }
    if (!fbReady || !db.current) { setErr('Firebase not connected.'); return }
    setSending(true)
    const isClassBroadcast = to.startsWith('class:')
    const classId = isClassBroadcast ? to.slice(6) : null
    const msgType = (to === 'all' || isClassBroadcast) ? 'announcement' : 'direct'
    const id = msgId()
    try {
      await setDoc(doc(db.current, 'messages', id), {
        id, from: 'admin', to,
        subject: subject.trim(), body: body.trim(),
        ts: Date.now(), read: [], adminRead: true, replies: [],
        type: msgType, classId: classId || null,
      })
      toast('Message sent!', 'green')
      onClose()
    } catch (e) {
      setErr('Failed to send: ' + e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1">✏️ New Message</h3>
      <p className="text-xs text-ink2 mb-4">Send a direct message or announcement to students.</p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">To</label>
        <select className="input w-full" value={to} onChange={e => setTo(e.target.value)}>
          <option value="all">📢 All Students (Announcement)</option>
          {Object.keys(classGroups).sort().map(label => {
            const grp = classGroups[label]
            const cls = classes.find(c => c.id === grp[0]?.classId)
            if (cls) return <option key={'class:' + cls.id} value={'class:' + cls.id}>📋 All in {label}</option>
            return null
          })}
          <option disabled>── Individual Students ──</option>
          {Object.keys(classGroups).sort().map(label => (
            <optgroup key={label} label={label}>
              {sortByLastName(classGroups[label]).map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.id}{s.account?.registered ? '' : ' (no account)'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Subject</label>
        <input className="input w-full" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Class reminder" maxLength={200} />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Message</label>
        <textarea className="input w-full" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="Type your message here…" maxLength={3000} />
      </div>

      {err && <div className="err-msg mb-2">{err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
          {sending ? 'Sending…' : '📤 Send Message'}
        </button>
      </div>
    </Modal>
  )
}

// ── Main Component ────────────────────────────────────────────────────
export default function FloatingAdminMessenger({ unreadCount }) {
  const { students, messages, db, fbReady } = useData()
  const { toast } = useUI()
  const [open, setOpen]             = useState(false)
  const [activeTab, setActiveTab]   = useState('inbox')
  const [search, setSearch]         = useState('')
  const [view, setView]             = useState('list')
  const [activeConv, setActiveConv] = useState(null)
  const [showCompose, setShowCompose] = useState(false)
  const [replyText, setReplyText]   = useState('')
  const [sending, setSending]       = useState(false)
  const messagesEndRef = useRef(null)

  const inboxMsgs    = useMemo(() => messages.filter(m => m.from !== 'admin').sort((a, b) => b.ts - a.ts), [messages])
  const sentMsgs     = useMemo(() => messages.filter(m => m.from === 'admin' && m.type === 'direct').sort((a, b) => b.ts - a.ts), [messages])
  const announceMsgs = useMemo(() => messages.filter(m => m.from === 'admin' && m.type === 'announcement').sort((a, b) => b.ts - a.ts), [messages])

  const inboxConvs = useMemo(() => {
    const byStudent = {}
    inboxMsgs.forEach(m => {
      if (!byStudent[m.from]) byStudent[m.from] = []
      byStudent[m.from].push(m)
    })
    return Object.values(byStudent).map(arr => {
      arr.sort((a, b) => b.ts - a.ts)
      const latest = arr[0]
      const allReplies = arr.flatMap(m => (m.replies || []).map(r => ({ ...r, msgId: m.id })))
      const lastActivity = allReplies.length ? Math.max(latest.ts, ...allReplies.map(r => r.ts)) : latest.ts
      const hasUnread = arr.some(m => !m.adminRead && m.from !== 'admin')
      return { sid: latest.from, latestMsg: latest, allMsgs: arr, lastActivity, hasUnread }
    }).sort((a, b) => b.lastActivity - a.lastActivity)
  }, [inboxMsgs])

  const filteredList = useMemo(() => {
    const q = search.toLowerCase()
    if (activeTab === 'inbox') {
      if (!q) return inboxConvs
      return inboxConvs.filter(cv => {
        const s = students.find(x => x.id === cv.sid)
        const name = (s?.name || cv.sid).toLowerCase()
        return name.includes(q) || cv.allMsgs.some(m =>
          m.subject?.toLowerCase().includes(q) || m.body?.toLowerCase().includes(q) ||
          (m.replies || []).some(r => r.body?.toLowerCase().includes(q))
        )
      })
    }
    const raw = activeTab === 'sent' ? sentMsgs : announceMsgs
    if (!q) return raw
    return raw.filter(m => {
      const recip = (students.find(s => s.id === m.to)?.name || m.to || '').toLowerCase()
      return m.subject?.toLowerCase().includes(q) || m.body?.toLowerCase().includes(q) || recip.includes(q)
    })
  }, [activeTab, search, inboxConvs, sentMsgs, announceMsgs, students])

  // Build thread data
  const thread = useMemo(() => {
    if (!activeConv) return null

    if (activeConv.type === 'conversation') {
      const sid = activeConv.studentId
      const s = students.find(x => x.id === sid)
      const name = s?.name || sid
      const studentMsgs = messages.filter(m =>
        m.from === sid || (m.from === 'admin' && m.to === sid && m.type === 'direct')
      ).sort((a, b) => a.ts - b.ts)

      const entries = []
      studentMsgs.forEach(m => {
        const studentRead = Array.isArray(m.read) && m.read.length > 0
        const readTime = studentRead && m.readAt ? Object.values(m.readAt)[0] : null
        entries.push({
          from: m.from, body: m.body, ts: m.ts, subject: m.subject, msgId: m.id, isMain: true,
          senderLabel: m.from === 'admin' ? 'You' : name,
          studentRead, readTitle: studentRead ? 'Read ' + (readTime ? relativeTime(readTime) : '') : 'Delivered',
        })
        ;(m.replies || []).forEach(r => entries.push({
          from: r.from, body: r.body, ts: r.ts, subject: null, msgId: m.id, isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : name,
          studentRead: false, readTitle: 'Delivered',
        }))
      })
      entries.sort((a, b) => a.ts - b.ts)
      return {
        type: 'conversation', studentId: sid,
        latestMsgId: studentMsgs.length ? studentMsgs[studentMsgs.length - 1].id : null,
        headerName: name, headerSub: sid + (s?.course ? ' · ' + s.course : ''), entries,
      }
    }

    if (activeConv.type === 'message') {
      const m = messages.find(x => x.id === activeConv.msgId)
      if (!m) return null
      const recipientName = m.to === 'all' ? 'All Students'
        : m.to.startsWith('class:') ? 'Class Broadcast'
        : (students.find(s => s.id === m.to)?.name || m.to)
      const readCount = m.read?.length || 0
      const anyRead = readCount > 0
      const entries = [
        {
          from: m.from, body: m.body, ts: m.ts, subject: m.subject, isMain: true,
          senderLabel: 'You', studentRead: anyRead,
          readTitle: anyRead ? `${readCount} student${readCount !== 1 ? 's' : ''} read this` : 'Delivered',
        },
        ...(m.replies || []).map(r => ({
          from: r.from, body: r.body, ts: r.ts, subject: null, isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : (students.find(s => s.id === r.from)?.name || r.from),
          studentRead: false, readTitle: 'Delivered',
        })),
      ].sort((a, b) => a.ts - b.ts)
      return {
        type: 'message', msgId: m.id,
        headerName: '→ ' + recipientName,
        headerSub: m.subject + ' · ' + new Date(m.ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
        entries,
      }
    }

    return null
  }, [activeConv, messages, students])

  useEffect(() => {
    if (thread && messagesEndRef.current) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    }
  }, [thread])

  async function openConversation(sid) {
    const unread = messages.filter(m => m.from === sid && !m.adminRead)
    if (unread.length && fbReady && db.current) {
      const now = Date.now()
      await Promise.all(unread.map(m =>
        updateDoc(doc(db.current, 'messages', m.id), { adminRead: true, adminReadAt: now }).catch(() => {})
      ))
    }
    setActiveConv({ type: 'conversation', studentId: sid })
    setView('thread')
  }

  function openMessage(id) {
    const m = messages.find(x => x.id === id)
    if (!m) return
    if (m.from !== 'admin') { openConversation(m.from); return }
    if (!m.adminRead && fbReady && db.current) {
      updateDoc(doc(db.current, 'messages', id), { adminRead: true }).catch(() => {})
    }
    setActiveConv({ type: 'message', msgId: id })
    setView('thread')
  }

  async function handleReply() {
    const text = replyText.trim()
    if (!text || !thread || !fbReady || !db.current) return
    setSending(true)
    const reply = { from: 'admin', body: text, ts: Date.now() }
    try {
      if (thread.type === 'conversation') {
        const studentMsgs = messages.filter(m => m.from === thread.studentId).sort((a, b) => b.ts - a.ts)
        const targetMsg = studentMsgs[0]
        if (!targetMsg) return
        await updateDoc(doc(db.current, 'messages', targetMsg.id), {
          replies: [...(targetMsg.replies || []), reply], adminRead: true,
        })
      } else {
        const m = messages.find(x => x.id === thread.msgId)
        if (!m) return
        await updateDoc(doc(db.current, 'messages', m.id), {
          replies: [...(m.replies || []), reply], adminRead: true,
        })
      }
      setReplyText('')
    } catch (e) {
      toast('Failed to send reply: ' + e.message, 'red')
    } finally {
      setSending(false)
    }
  }

  function switchTab(tab) {
    setActiveTab(tab)
    setSearch('')
    setView('list')
    setActiveConv(null)
  }

  const inboxUnread = inboxMsgs.filter(m => !m.adminRead).length

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24,
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
          position: 'fixed', bottom: 84, right: 24,
          width: 'min(360px, calc(100vw - 48px))', height: 'min(540px, calc(100vh - 100px))',
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
              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', flexShrink: 0 }} onClick={() => { setView('list'); setActiveConv(null) }}>←</button>
            )}
            <span style={{ fontWeight: 700, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
              {view === 'list' ? 'Messages' : (thread?.headerName || 'Messages')}
            </span>
            {view === 'list' && (
              <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} onClick={() => setShowCompose(true)}>✏️ New</button>
            )}
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>

          {/* List view */}
          {view === 'list' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '6px 12px 0', gap: 4, flexShrink: 0 }}>
                {[
                  { id: 'inbox', label: 'Inbox', badge: inboxUnread },
                  { id: 'sent', label: 'Sent' },
                  { id: 'announce', label: 'Broadcast' },
                ].map(t => (
                  <button
                    key={t.id}
                    className={`msg-conv-tab${activeTab === t.id ? ' active-tab' : ''}`}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => switchTab(t.id)}
                  >
                    {t.label}
                    {t.badge > 0 && <span className="msg-unread-badge ml-1" style={{ fontSize: 8, verticalAlign: 'middle' }}>●</span>}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div style={{ padding: '8px 12px', flexShrink: 0 }}>
                <input
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  placeholder="Search…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {/* List */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {!filteredList.length ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
                    {search ? 'No matches.' : activeTab === 'inbox' ? 'No messages from students yet.' : activeTab === 'sent' ? 'No direct messages sent yet.' : 'No announcements yet.'}
                  </div>
                ) : activeTab === 'inbox' ? (
                  filteredList.map(cv => {
                    const s = students.find(x => x.id === cv.sid)
                    const name = s?.name || cv.sid
                    const preview = cv.latestMsg.body.slice(0, 48) + (cv.latestMsg.body.length > 48 ? '…' : '')
                    return (
                      <div
                        key={cv.sid}
                        className={`msg-conv-item${cv.hasUnread ? ' unread' : ''}`}
                        onClick={() => openConversation(cv.sid)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="msg-conv-avatar">{getInitials(name)}</div>
                        <div className="msg-conv-body">
                          <div className="msg-conv-name">{name}</div>
                          <div className="msg-conv-preview">{preview}</div>
                        </div>
                        <div className="msg-conv-meta">
                          <div className="msg-conv-time">{relativeTime(cv.lastActivity)}</div>
                          {cv.hasUnread && <div className="msg-unread-badge">●</div>}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  filteredList.map(m => {
                    const recipientName = m.to === 'all' ? 'All Students'
                      : m.to.startsWith('class:') ? 'Class Broadcast'
                      : (students.find(s => s.id === m.to)?.name || m.to)
                    const preview = m.body.slice(0, 48) + (m.body.length > 48 ? '…' : '')
                    return (
                      <div
                        key={m.id}
                        className="msg-conv-item"
                        onClick={() => openMessage(m.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="msg-conv-avatar announce-avatar">{activeTab === 'announce' ? '📢' : getInitials(recipientName)}</div>
                        <div className="msg-conv-body">
                          <div className="msg-conv-name">→ {recipientName}</div>
                          <div className="msg-conv-preview">{m.subject + ' — ' + preview}</div>
                        </div>
                        <div className="msg-conv-meta">
                          <div className="msg-conv-time">{relativeTime(m.ts)}</div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Thread view */}
          {view === 'thread' && thread && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {thread.headerSub && (
                <div style={{ padding: '4px 14px 8px', fontSize: 11, color: 'var(--ink3)', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
                  {thread.headerSub}
                </div>
              )}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {thread.entries.map((entry, i) => {
                  const isAdmin = entry.from === 'admin'
                  const date = new Date(entry.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  return (
                    <div key={i}>
                      <div className={`msg-bubble-row${isAdmin ? ' sent' : ''}`}>
                        <div className={`msg-bubble${isAdmin ? ' sent' : ' received'}`} style={{ fontSize: 13 }}>
                          {entry.isMain && entry.subject && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: isAdmin ? 'rgba(255,255,255,.7)' : 'var(--accent)', marginBottom: 3, textTransform: 'uppercase' }}>
                              {entry.subject}
                            </div>
                          )}
                          <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                        </div>
                      </div>
                      <div className={`msg-meta${isAdmin ? ' msg-meta-sent' : ' msg-meta-recv'}`} style={{ fontSize: 10 }}>
                        {entry.senderLabel} · {date}
                        {isAdmin && (
                          <span className={`msg-tick${entry.studentRead ? ' msg-tick-read' : ''}`} title={entry.readTitle}>✓✓</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
                <textarea
                  className="input"
                  style={{ flex: 1, resize: 'none', fontSize: 12 }}
                  placeholder="Type a reply… (Ctrl+Enter to send)"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply() }}
                  rows={2}
                  disabled={sending}
                />
                <button
                  className="btn btn-primary btn-sm"
                  style={{ alignSelf: 'flex-end', padding: '0 14px', height: 34, flexShrink: 0 }}
                  onClick={handleReply}
                  disabled={sending || !replyText.trim()}
                >
                  {sending ? '…' : '➤'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
    </>
  )
}
