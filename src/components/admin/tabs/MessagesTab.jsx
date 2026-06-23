import React, { useState, useMemo, useRef, useEffect } from 'react'
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import { notifyStudentMessage, notifyStudentsBroadcast } from '@/firebase/messageNotify'
import { fbAddMessageReply, fbDeleteMessage } from '@/firebase/persistence'
import Modal from '@/components/primitives/Modal'
import KebabMenu from '@/components/primitives/KebabMenu'
import { X, Pencil, Send, CheckCheck, Megaphone, Trash2, Search, ChevronDown, Check } from 'lucide-react'

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

// Round avatar that prefers a profile photo, falling back to initials/icon.
function Avatar({ photo, char, announce = false, size = 38 }) {
  return (
    <div className={`msg-conv-avatar ${announce ? 'announce-avatar' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size / 2.9) }}>
      {photo ? <img src={photo} alt="" className="msg-conv-avatar-img" /> : char}
    </div>
  )
}

// ── Recipient Picker ──────────────────────────────────────────────────
// Searchable dropdown replacing the native <select> that dumped every student
// at once. Shows All-Students + per-class broadcasts + individual students with
// their profile photos, filtered by a search box.
function RecipientPicker({ students, classes, classGroups, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Resolve the label/avatar for the current selection.
  const selected = useMemo(() => {
    if (value === 'all') return { label: 'All Students', sub: 'Announcement', announce: true }
    if (typeof value === 'string' && value.startsWith('class:')) {
      const cid = value.slice(6)
      const cls = classes.find(c => c.id === cid)
      return { label: cls ? `All in ${cls.name} ${cls.section}` : 'Class broadcast', sub: 'Announcement', announce: true }
    }
    const s = students.find(x => x.id === value)
    return s ? { label: s.name, sub: s.id, photo: s.photo, char: getInitials(s.name) } : { label: 'Select recipient…', sub: '' }
  }, [value, students, classes])

  const ql = q.trim().toLowerCase()
  const matchStudent = s => !ql || s.name.toLowerCase().includes(ql) || String(s.id).toLowerCase().includes(ql)

  function pick(v) { onChange(v); setOpen(false); setQ('') }

  return (
    <div className="recipient-picker" ref={wrapRef}>
      <button type="button" className="recipient-trigger input w-full" onClick={() => setOpen(o => !o)}>
        <Avatar photo={selected.photo} char={selected.char || <Megaphone size={15} />} announce={selected.announce} size={26} />
        <span className="recipient-trigger-label">
          <span className="recipient-trigger-name">{selected.label}</span>
          {selected.sub && <span className="recipient-trigger-sub">{selected.sub}</span>}
        </span>
        <ChevronDown size={16} className="recipient-chevron" />
      </button>

      {open && (
        <div className="recipient-menu">
          <div className="recipient-search">
            <Search size={14} />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search students…"
              aria-label="Search recipients"
            />
          </div>
          <div className="recipient-list">
            {/* Broadcast options */}
            {!ql && (
              <>
                <button type="button" className="recipient-opt" onClick={() => pick('all')}>
                  <Avatar char={<Megaphone size={15} />} announce size={30} />
                  <span className="recipient-opt-text"><span className="recipient-opt-name">All Students</span><span className="recipient-opt-sub">Announcement to everyone</span></span>
                  {value === 'all' && <Check size={15} className="recipient-check" />}
                </button>
                {Object.keys(classGroups).sort().map(label => {
                  const grp = classGroups[label]
                  const cls = classes.find(c => c.id === grp[0]?.classId)
                  if (!cls) return null
                  const v = 'class:' + cls.id
                  return (
                    <button type="button" key={v} className="recipient-opt" onClick={() => pick(v)}>
                      <Avatar char={<Megaphone size={15} />} announce size={30} />
                      <span className="recipient-opt-text"><span className="recipient-opt-name">All in {label}</span><span className="recipient-opt-sub">Class broadcast</span></span>
                      {value === v && <Check size={15} className="recipient-check" />}
                    </button>
                  )
                })}
                <div className="recipient-divider">Individual students</div>
              </>
            )}
            {/* Individual students */}
            {Object.keys(classGroups).sort().flatMap(label =>
              sortByLastName(classGroups[label]).filter(matchStudent).map(s => (
                <button type="button" key={s.id} className="recipient-opt" onClick={() => pick(s.id)}>
                  <Avatar photo={s.photo} char={getInitials(s.name)} size={30} />
                  <span className="recipient-opt-text">
                    <span className="recipient-opt-name">{s.name}{s.account?.registered ? '' : ' · no account'}</span>
                    <span className="recipient-opt-sub">{s.id} · {label}</span>
                  </span>
                  {value === s.id && <Check size={15} className="recipient-check" />}
                </button>
              ))
            )}
            {ql && !students.some(matchStudent) && (
              <div className="recipient-empty">No students match “{q}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
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
      // Notify the recipient(s): in-app badge + best-effort web push.
      if (to === 'all') {
        notifyStudentsBroadcast(db.current, students.map(s => s.id), subject.trim())
      } else if (isClassBroadcast) {
        const ids = students
          .filter(s => s.classId === classId || s.classIds?.includes(classId))
          .map(s => s.id)
        notifyStudentsBroadcast(db.current, ids, subject.trim())
      } else {
        notifyStudentMessage(db.current, to, body.trim())
      }
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
      <h3 className="text-lg font-bold text-ink mb-1"><Pencil size={18} /> New Message</h3>
      <p className="text-xs text-ink2 mb-4">Send a direct message or announcement to students.</p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">To</label>
        <RecipientPicker
          students={students}
          classes={classes}
          classGroups={classGroups}
          value={to}
          onChange={setTo}
        />
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
          {sending ? 'Sending…' : <><Send size={16} /> Send Message</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Thread Panel ──────────────────────────────────────────────────────
function ThreadPanel({ thread, onReply, onClose, onDelete }) {
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
        <div className="flex items-center gap-1">
          {onDelete && (
            <button className="msg-thread-del" onClick={onDelete} title="Delete this conversation"><Trash2 size={17} /></button>
          )}
          {onClose && (
            <button className="text-ink3 hover:text-ink" onClick={onClose}><X size={18} /></button>
          )}
        </div>
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
                  <span className={`msg-tick ${entry.studentRead ? 'msg-tick-read' : ''}`} title={entry.readTitle}><CheckCheck size={14} /></span>
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
        {sending ? '…' : <Send size={16} />}
      </button>
    </div>
  )
}

// ── Conversation Item ─────────────────────────────────────────────────
function ConvItem({ isActive, isUnread, avatarChar, photo, isAnnounce, name, preview, time, onClick, selectMode, selected, onToggleSelect, onDelete }) {
  return (
    <div
      className={`msg-conv-item ${isUnread ? 'unread' : ''} ${isActive ? 'active' : ''} ${selected ? 'selected' : ''}`}
      onClick={selectMode ? onToggleSelect : onClick}
      style={{ cursor: 'pointer' }}
    >
      {selectMode && (
        <span className={`msg-checkbox ${selected ? 'checked' : ''}`} aria-hidden="true">
          {selected && <Check size={13} />}
        </span>
      )}
      <Avatar photo={photo} char={avatarChar} announce={isAnnounce} />
      <div className="msg-conv-body">
        <div className="msg-conv-name">{name}</div>
        <div className="msg-conv-preview">{preview}</div>
      </div>
      <div className="msg-conv-meta">
        <div className="msg-conv-time">{time}</div>
        {isUnread && <div className="msg-unread-badge">●</div>}
      </div>
      {!selectMode && onDelete && (
        <KebabMenu items={[{ label: 'Delete', danger: true, onClick: onDelete }]} />
      )}
    </div>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
const PER_PAGE = 10

export default function MessagesTab() {
  const { students, classes, messages, db, fbReady } = useData()
  const { toast, openDialog } = useUI()

  // Class + section label for the student behind a conversation, used to group
  // the inbox. Unassigned students fall into a trailing "Unassigned" group.
  function classLabelFor(sid) {
    const s = students.find(x => x.id === sid)
    if (!s) return 'Unassigned'
    const cid = s.classId || (s.classIds && s.classIds[0])
    const cls = classes.find(c => c.id === cid)
    return cls ? `${cls.name} ${cls.section}` : 'Unassigned'
  }
  const [activeTab, setActiveTab]       = useState('inbox')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [activeConv, setActiveConv]     = useState(null) // { type, studentId?, msgId? }
  const [showCompose, setShowCompose]   = useState(false)
  const [replyTo, setReplyTo]           = useState(null)
  const [selectMode, setSelectMode]     = useState(false)
  const [selected, setSelected]         = useState(() => new Set()) // tokens: inbox=sid, sent/announce=msgId

  function exitSelect() { setSelectMode(false); setSelected(new Set()) }
  function toggleSelect(token) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(token) ? next.delete(token) : next.add(token)
      return next
    })
  }

  // Map a selection token to the message document id(s) it represents.
  // Inbox tokens are a student id (a conversation = every doc to/from them);
  // sent/broadcast tokens are the message id itself.
  function resolveDocIds(token) {
    if (activeTab === 'inbox') {
      return messages
        .filter(m => m.from === token || (m.from === 'admin' && m.to === token && m.type === 'direct'))
        .map(m => m.id)
    }
    return [token]
  }

  async function deleteTokens(tokens) {
    if (!tokens.length) return
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    const ids = new Set()
    tokens.forEach(t => resolveDocIds(t).forEach(id => ids.add(id)))
    if (!ids.size) return
    const noun = activeTab === 'inbox' ? 'conversation' : 'message'
    const ok = await openDialog({
      title: `Delete ${tokens.length} ${noun}${tokens.length > 1 ? 's' : ''}?`,
      msg: `This permanently removes the selected ${noun}${tokens.length > 1 ? 's' : ''} for everyone (including the student${activeTab === 'inbox' ? '' : '(s)'}). This cannot be undone.`,
      type: 'danger', confirmLabel: 'Delete', showCancel: true,
    })
    if (!ok) return
    try {
      await Promise.all([...ids].map(id => fbDeleteMessage(db.current, id).catch(() => {})))
      toast(`Deleted ${tokens.length} ${noun}${tokens.length > 1 ? 's' : ''}.`, 'green')
      // Close the open thread if its document was just deleted.
      if (activeConv?.type === 'conversation' && tokens.includes(activeConv.studentId)) setActiveConv(null)
      if (activeConv?.type === 'message' && tokens.includes(activeConv.msgId)) setActiveConv(null)
      exitSelect()
    } catch (e) {
      toast('Delete failed: ' + e.message, 'red')
    }
  }

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
      const classLabel = classLabelFor(latest.from)
      return { sid: latest.from, latestMsg: latest, allMsgs: arr, lastActivity, hasUnread, classLabel }
    }).sort((a, b) => {
      // Group by class+section (Unassigned last), then most-recent activity.
      const ua = a.classLabel === 'Unassigned', ub = b.classLabel === 'Unassigned'
      if (ua !== ub) return ua ? 1 : -1
      const cmp = a.classLabel.localeCompare(b.classLabel)
      return cmp !== 0 ? cmp : b.lastActivity - a.lastActivity
    })
  }, [inboxMsgs, students, classes])

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
    exitSelect()
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
        await fbAddMessageReply(db.current, targetMsg.id, reply, { adminRead: true })
        notifyStudentMessage(db.current, thread.studentId, text)
      } else {
        const m = messages.find(x => x.id === thread.msgId)
        if (!m) return
        await fbAddMessageReply(db.current, m.id, reply, { adminRead: true })
        // Notify the recipient(s) of this thread.
        if (m.to === 'all') {
          notifyStudentsBroadcast(db.current, students.map(s => s.id), text)
        } else if (typeof m.to === 'string' && m.to.startsWith('class:')) {
          const cid = m.to.slice(6)
          const ids = students.filter(s => s.classId === cid || s.classIds?.includes(cid)).map(s => s.id)
          notifyStudentsBroadcast(db.current, ids, text)
        } else if (m.to && m.to !== 'admin') {
          notifyStudentMessage(db.current, m.to, text)
        }
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
      let lastLabel = null
      return pageSlice.map(cv => {
        const s = students.find(x => x.id === cv.sid)
        const name = s?.name || cv.sid
        const preview = cv.latestMsg.body.slice(0, 60) + (cv.latestMsg.body.length > 60 ? '…' : '')
        const isActive = activeConv?.type === 'conversation' && activeConv.studentId === cv.sid
        // Emit a class+section header at the top of each group (and at the start
        // of the page so the current group is always labelled).
        const showHeader = cv.classLabel !== lastLabel
        lastLabel = cv.classLabel
        return (
          <React.Fragment key={cv.sid}>
            {showHeader && <div className="msg-group-hdr">{cv.classLabel}</div>}
            <ConvItem
              isActive={isActive}
              isUnread={cv.hasUnread}
              avatarChar={getInitials(name)}
              photo={s?.photo}
              isAnnounce={false}
              name={name}
              preview={preview}
              time={relativeTime(cv.lastActivity)}
              onClick={() => openConversation(cv.sid)}
              selectMode={selectMode}
              selected={selected.has(cv.sid)}
              onToggleSelect={() => toggleSelect(cv.sid)}
              onDelete={() => deleteTokens([cv.sid])}
            />
          </React.Fragment>
        )
      })
    }

    // Sent / Announcements
    return pageSlice.map(m => {
      const recipStu = students.find(s => s.id === m.to)
      const recipientName = m.to === 'all' ? 'All Students'
        : m.to.startsWith('class:') ? 'Class Broadcast'
        : (recipStu?.name || m.to)
      const initials = activeTab === 'announce' ? <Megaphone size={18} /> : getInitials(recipientName)
      const preview = m.body.slice(0, 60) + (m.body.length > 60 ? '…' : '')
      const isActive = activeConv?.type === 'message' && activeConv.msgId === m.id
      return (
        <ConvItem
          key={m.id}
          isActive={isActive}
          isUnread={false}
          avatarChar={initials}
          photo={activeTab === 'sent' ? recipStu?.photo : undefined}
          isAnnounce={activeTab === 'announce'}
          name={'→ ' + recipientName}
          preview={m.subject + ' — ' + preview}
          time={relativeTime(m.ts)}
          onClick={() => openMessage(m.id)}
          selectMode={selectMode}
          selected={selected.has(m.id)}
          onToggleSelect={() => toggleSelect(m.id)}
          onDelete={() => deleteTokens([m.id])}
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
        <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}><Pencil size={16} /> New</button>
      </div>

      {/* Main layout: list + thread (single-pane on mobile) */}
      <div className={`msg-shell flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden bg-surface${activeConv ? ' has-active' : ''}`}>

        {/* Left: conversation list */}
        <div className="msg-list-pane flex flex-col border-r border-border" style={{ width: 300, minWidth: 260, flexShrink: 0 }}>
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
              aria-label="Search messages"
              placeholder="Search messages…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          {/* Select / delete toolbar */}
          {filteredList.length > 0 && (
            <div className="msg-select-bar">
              {selectMode ? (
                <>
                  <span className="msg-select-count">{selected.size} selected</span>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={exitSelect}>Cancel</button>
                    <button className="btn btn-danger btn-sm" disabled={!selected.size} onClick={() => deleteTokens([...selected])}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </>
              ) : (
                <button className="msg-select-toggle" onClick={() => setSelectMode(true)}>Select</button>
              )}
            </div>
          )}

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
        <div className="msg-thread-pane flex flex-1 min-w-0">
          {thread ? (
            <ThreadPanel
              thread={thread}
              onReply={handleReply}
              onClose={() => setActiveConv(null)}
              onDelete={() => deleteTokens([thread.type === 'conversation' ? thread.studentId : thread.msgId])}
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
