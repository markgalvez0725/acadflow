import React, { useState, useMemo, useRef, useEffect } from 'react'
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import Modal from '@/components/primitives/Modal'
import { X } from 'lucide-react'

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
function ComposeModal({ onClose, replyToStudentId = null }) {
  const { students, classes, messages, db, fbReady } = useData()
  const { toast } = useUI()
  const [to, setTo]           = useState(replyToStudentId || 'all')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [err, setErr]         = useState('')
  const [sending, setSending] = useState(false)

  // Build grouped student options
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
    if (subject.length > 200) { setErr('Subject too long (max 200 characters).'); return }
    if (body.length > 3000)   { setErr('Message too long (max 3000 characters).'); return }
    if (!fbReady || !db.current) { setErr('Firebase is not connected.'); return }

    setSending(true)
    const isClassBroadcast = to.startsWith('class:')
    const classId = isClassBroadcast ? to.slice(6) : null
    const msgType = (to === 'all' || isClassBroadcast) ? 'announcement' : 'direct'
    const id = msgId()

    const msg = {
      id,
      from:      'admin',
      to,
      subject:   subject.trim(),
      body:      body.trim(),
      ts:        Date.now(),
      read:      [],
      adminRead: true,
      replies:   [],
      type:      msgType,
      classId:   classId || null,
    }

    try {
      await setDoc(doc(db.current, 'messages', id), msg)
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
        <select
          className="input w-full"
          value={to}
          onChange={e => setTo(e.target.value)}
        >
          <option value="all">📢 All Students (Announcement)</option>
          {Object.keys(classGroups).sort().map(label => {
            const grp = classGroups[label]
            const cls = classes.find(c => c.id === grp[0]?.classId)
            if (cls) {
              return <option key={'class:' + cls.id} value={'class:' + cls.id}>📋 All in {label}</option>
            }
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
        <input
          className="input w-full"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="e.g. Class reminder"
          maxLength={200}
        />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Message</label>
        <textarea
          className="input w-full"
          rows={5}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type your message here…"
          maxLength={3000}
        />
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

// ── Thread Panel ──────────────────────────────────────────────────────
function ThreadPanel({ thread, onReply, onClose }) {
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink3 text-sm">
        Select a conversation to view messages.
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface flex-shrink-0">
        <div>
          <div className="font-semibold text-ink text-sm">{thread.headerName}</div>
          <div className="text-xs text-ink2">{thread.headerSub}</div>
        </div>
        {onClose && (
          <button className="text-ink3 hover:text-ink" onClick={onClose}><X size={18} /></button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1">
        {thread.entries.map((entry, i) => {
          const isAdmin = entry.from === 'admin'
          const date = new Date(entry.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          return (
            <div key={i}>
              <div className={`msg-bubble-row ${isAdmin ? 'sent' : 'received'}`}>
                <div className={`msg-bubble ${isAdmin ? 'sent' : 'received'}`}>
                  {entry.isMain && entry.subject && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: isAdmin ? 'rgba(255,255,255,.7)' : 'var(--c-accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {entry.subject}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                </div>
              </div>
              <div className={`msg-meta ${isAdmin ? 'msg-meta-sent' : 'msg-meta-recv'}`}>
                {entry.senderLabel} · {date}
                {isAdmin && (
                  <span className={`msg-tick ${entry.studentRead ? 'msg-tick-read' : ''}`} title={entry.readTitle}>✓✓</span>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      <ReplyBox onSend={onReply} />
    </div>
  )
}

// ── Reply Box ─────────────────────────────────────────────────────────
function ReplyBox({ onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const t = text.trim()
    if (!t) return
    setSending(true)
    await onSend(t)
    setText('')
    setSending(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend()
  }

  return (
    <div id="admin-reply-input-wrap" className="flex gap-2 px-4 py-3 border-t border-border bg-surface flex-shrink-0">
      <textarea
        className="input flex-1 resize-none"
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a reply… (Ctrl+Enter to send)"
        disabled={sending}
      />
      <button
        className="msg-send-btn btn btn-primary btn-sm self-end"
        onClick={handleSend}
        disabled={sending || !text.trim()}
      >
        {sending ? '…' : '➤'}
      </button>
    </div>
  )
}

// ── Conversation Item ─────────────────────────────────────────────────
function ConvItem({ isActive, isUnread, avatarChar, isAnnounce, name, preview, time, onClick }) {
  return (
    <div
      className={`msg-conv-item ${isUnread ? 'unread' : ''} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className={`msg-conv-avatar ${isAnnounce ? 'announce-avatar' : ''}`}>{avatarChar}</div>
      <div className="msg-conv-body">
        <div className="msg-conv-name">{name}</div>
        <div className="msg-conv-preview">{preview}</div>
      </div>
      <div className="msg-conv-meta">
        <div className="msg-conv-time">{time}</div>
        {isUnread && <div className="msg-unread-badge">●</div>}
      </div>
    </div>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
const PER_PAGE = 10

export default function MessagesTab() {
  const { students, messages, db, fbReady } = useData()
  const { toast } = useUI()
  const [activeTab, setActiveTab]       = useState('inbox')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [activeConv, setActiveConv]     = useState(null) // { type, studentId?, msgId? }
  const [showCompose, setShowCompose]   = useState(false)
  const [replyTo, setReplyTo]           = useState(null)

  // Categorized message lists
  const inboxMsgs    = useMemo(() => messages.filter(m => m.from !== 'admin').sort((a, b) => b.ts - a.ts), [messages])
  const sentMsgs     = useMemo(() => messages.filter(m => m.from === 'admin' && m.type === 'direct').sort((a, b) => b.ts - a.ts), [messages])
  const announceMsgs = useMemo(() => messages.filter(m => m.from === 'admin' && m.type === 'announcement').sort((a, b) => b.ts - a.ts), [messages])

  // Inbox conversations grouped by student
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

  // Apply search
  const filteredList = useMemo(() => {
    const q = search.toLowerCase()
    if (activeTab === 'inbox') {
      if (!q) return inboxConvs
      return inboxConvs.filter(cv => {
        const s = students.find(x => x.id === cv.sid)
        const name = (s?.name || cv.sid).toLowerCase()
        return name.includes(q) ||
          cv.allMsgs.some(m =>
            m.subject?.toLowerCase().includes(q) ||
            m.body?.toLowerCase().includes(q) ||
            (m.replies || []).some(r => r.body?.toLowerCase().includes(q))
          )
      })
    }
    const raw = activeTab === 'sent' ? sentMsgs : announceMsgs
    if (!q) return raw
    return raw.filter(m => {
      const recip = (students.find(s => s.id === m.to)?.name || m.to || '').toLowerCase()
      return m.subject?.toLowerCase().includes(q) ||
        m.body?.toLowerCase().includes(q) ||
        recip.includes(q)
    })
  }, [activeTab, search, inboxConvs, sentMsgs, announceMsgs, students])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PER_PAGE))
  const pageSlice  = useMemo(
    () => filteredList.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filteredList, page]
  )

  // Reset page + active conv when tab or search changes
  function switchTab(tab) {
    setActiveTab(tab)
    setPage(1)
    setSearch('')
    setActiveConv(null)
  }

  function handleSearch(v) {
    setSearch(v)
    setPage(1)
  }

  // ── Build thread data for panel ───────────────────────────────────
  const thread = useMemo(() => {
    if (!activeConv) return null

    if (activeConv.type === 'conversation') {
      const sid = activeConv.studentId
      const s = students.find(x => x.id === sid)
      const name = s?.name || sid
      const studentMsgs = messages.filter(m =>
        m.from === sid ||
        (m.from === 'admin' && m.to === sid && m.type === 'direct')
      ).sort((a, b) => a.ts - b.ts)

      const entries = []
      studentMsgs.forEach(m => {
        const studentRead = Array.isArray(m.read) && m.read.length > 0
        const readTime = studentRead && m.readAt ? Object.values(m.readAt)[0] : null
        entries.push({
          from: m.from,
          body: m.body,
          ts: m.ts,
          subject: m.subject,
          msgId: m.id,
          isMain: true,
          senderLabel: m.from === 'admin' ? 'You' : name,
          studentRead,
          readTitle: studentRead ? 'Read ' + (readTime ? relativeTime(readTime) : '') : 'Delivered',
        })
        ;(m.replies || []).forEach(r => entries.push({
          from: r.from,
          body: r.body,
          ts: r.ts,
          subject: null,
          msgId: m.id,
          isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : name,
          studentRead: false,
          readTitle: 'Delivered',
        }))
      })
      entries.sort((a, b) => a.ts - b.ts)

      return {
        type: 'conversation',
        studentId: sid,
        latestMsgId: studentMsgs.length ? studentMsgs[studentMsgs.length - 1].id : null,
        headerName: name,
        headerSub: sid + (s?.course ? ' · ' + s.course : ''),
        entries,
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
          from: m.from,
          body: m.body,
          ts: m.ts,
          subject: m.subject,
          isMain: true,
          senderLabel: 'You',
          studentRead: anyRead,
          readTitle: anyRead ? `${readCount} student${readCount !== 1 ? 's' : ''} read this` : 'Delivered',
        },
        ...(m.replies || []).map(r => ({
          from: r.from,
          body: r.body,
          ts: r.ts,
          subject: null,
          isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : (students.find(s => s.id === r.from)?.name || r.from),
          studentRead: false,
          readTitle: 'Delivered',
        })),
      ].sort((a, b) => a.ts - b.ts)

      return {
        type: 'message',
        msgId: m.id,
        headerName: '→ ' + recipientName,
        headerSub: m.subject + ' · ' + new Date(m.ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
        entries,
      }
    }

    return null
  }, [activeConv, messages, students])

  // ── Open conversation / message ──────────────────────────────────
  async function openConversation(sid) {
    // Mark unread as read
    const unread = messages.filter(m => m.from === sid && !m.adminRead)
    if (unread.length && fbReady && db.current) {
      const now = Date.now()
      await Promise.all(unread.map(m =>
        updateDoc(doc(db.current, 'messages', m.id), { adminRead: true, adminReadAt: now }).catch(() => {})
      ))
    }
    setActiveConv({ type: 'conversation', studentId: sid })
  }

  function openMessage(id) {
    const m = messages.find(x => x.id === id)
    if (!m) return
    if (m.from !== 'admin') { openConversation(m.from); return }
    if (!m.adminRead && fbReady && db.current) {
      updateDoc(doc(db.current, 'messages', id), { adminRead: true }).catch(() => {})
    }
    setActiveConv({ type: 'message', msgId: id })
  }

  // ── Send reply ───────────────────────────────────────────────────
  async function handleReply(text) {
    if (!thread || !fbReady || !db.current) {
      toast('Firebase not connected.', 'red')
      return
    }
    const reply = { from: 'admin', body: text, ts: Date.now() }

    try {
      if (thread.type === 'conversation') {
        // Append to most recent student message
        const studentMsgs = messages.filter(m => m.from === thread.studentId).sort((a, b) => b.ts - a.ts)
        const targetMsg = studentMsgs[0]
        if (!targetMsg) return
        const updatedReplies = [...(targetMsg.replies || []), reply]
        await updateDoc(doc(db.current, 'messages', targetMsg.id), { replies: updatedReplies, adminRead: true })
      } else {
        const m = messages.find(x => x.id === thread.msgId)
        if (!m) return
        const updatedReplies = [...(m.replies || []), reply]
        await updateDoc(doc(db.current, 'messages', m.id), { replies: updatedReplies, adminRead: true })
      }
    } catch (e) {
      toast('Failed to send reply: ' + e.message, 'red')
    }
  }

  // ── Render list items ────────────────────────────────────────────
  function renderListItems() {
    if (!filteredList.length) {
      const emptyMsg = search ? 'No messages match your search.'
        : activeTab === 'inbox' ? 'No messages from students yet.'
        : activeTab === 'sent' ? 'No direct messages sent yet.'
        : 'No announcements sent yet.'
      return <div className="empty" style={{ padding: '32px 20px' }}>{emptyMsg}</div>
    }

    if (activeTab === 'inbox') {
      return pageSlice.map(cv => {
        const s = students.find(x => x.id === cv.sid)
        const name = s?.name || cv.sid
        const preview = cv.latestMsg.body.slice(0, 60) + (cv.latestMsg.body.length > 60 ? '…' : '')
        const isActive = activeConv?.type === 'conversation' && activeConv.studentId === cv.sid
        return (
          <ConvItem
            key={cv.sid}
            isActive={isActive}
            isUnread={cv.hasUnread}
            avatarChar={getInitials(name)}
            isAnnounce={false}
            name={name}
            preview={preview}
            time={relativeTime(cv.lastActivity)}
            onClick={() => openConversation(cv.sid)}
          />
        )
      })
    }

    // Sent / Announcements
    return pageSlice.map(m => {
      const recipientName = m.to === 'all' ? 'All Students'
        : m.to.startsWith('class:') ? 'Class Broadcast'
        : (students.find(s => s.id === m.to)?.name || m.to)
      const initials = activeTab === 'announce' ? '📢' : getInitials(recipientName)
      const preview = m.body.slice(0, 60) + (m.body.length > 60 ? '…' : '')
      const isActive = activeConv?.type === 'message' && activeConv.msgId === m.id
      return (
        <ConvItem
          key={m.id}
          isActive={isActive}
          isUnread={false}
          avatarChar={initials}
          isAnnounce={activeTab === 'announce'}
          name={'→ ' + recipientName}
          preview={m.subject + ' — ' + preview}
          time={relativeTime(m.ts)}
          onClick={() => openMessage(m.id)}
        />
      )
    })
  }

  const inboxUnread    = inboxMsgs.filter(m => !m.adminRead).length
  const inboxConvCount = inboxConvs.length
  const sentCount      = sentMsgs.length
  const announceCount  = announceMsgs.length

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)', minHeight: 480 }}>
      {/* Header */}
      <div className="sec-hdr mb-3 flex-shrink-0">
        <div className="sec-title">Messages</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}>✏️ New</button>
      </div>

      {/* Main layout: list + thread */}
      <div className="flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden bg-surface">

        {/* Left: conversation list */}
        <div className="flex flex-col border-r border-border" style={{ width: 300, minWidth: 260, flexShrink: 0 }}>
          {/* Tabs */}
          <div className="flex border-b border-border px-2 pt-2 gap-1 flex-shrink-0">
            <button
              className={`msg-conv-tab ${activeTab === 'inbox' ? 'active-tab' : ''}`}
              onClick={() => switchTab('inbox')}
            >
              Inbox {inboxConvCount > 0 && <span className="msg-tab-count">({inboxConvCount})</span>}
              {inboxUnread > 0 && <span className="msg-unread-badge ml-1" style={{ fontSize: 8, verticalAlign: 'middle' }}>●</span>}
            </button>
            <button
              className={`msg-conv-tab ${activeTab === 'sent' ? 'active-tab' : ''}`}
              onClick={() => switchTab('sent')}
            >
              Sent {sentCount > 0 && <span className="msg-tab-count">({sentCount})</span>}
            </button>
            <button
              className={`msg-conv-tab ${activeTab === 'announce' ? 'active-tab' : ''}`}
              onClick={() => switchTab('announce')}
            >
              Broadcast {announceCount > 0 && <span className="msg-tab-count">({announceCount})</span>}
            </button>
          </div>

          {/* Search */}
          <div className="px-2 py-2 flex-shrink-0">
            <input
              className="input w-full"
              style={{ fontSize: 12 }}
              placeholder="Search messages…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          {/* List */}
          <div id="admin-conv-list" className="flex-1 overflow-y-auto">
            {renderListItems()}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 px-2 py-2 border-t border-border flex-shrink-0">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >‹</button>
              <span className="text-xs text-ink2">{page} / {totalPages}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >›</button>
            </div>
          )}
        </div>

        {/* Right: thread panel */}
        <div className="flex flex-1 min-w-0">
          {thread ? (
            <ThreadPanel
              thread={thread}
              onReply={handleReply}
              onClose={() => setActiveConv(null)}
            />
          ) : (
            <div id="admin-conv-empty" className="flex-1 flex items-center justify-center text-ink3 text-sm">
              Select a conversation to view messages.
            </div>
          )}
        </div>
      </div>

      {showCompose && (
        <ComposeModal
          replyToStudentId={replyTo}
          onClose={() => { setShowCompose(false); setReplyTo(null) }}
        />
      )}
    </div>
  )
}
