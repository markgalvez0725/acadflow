import React, { useState, useMemo, useRef, useEffect } from 'react'
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName, dayLabel } from '@/utils/format'
import { isClassCurrent } from '@/utils/active'
import { isGroupMessage, autoGroupName, groupName, studentTag, groupMembers } from '@/utils/groupChat'
import GroupMembers from '@/components/primitives/GroupMembers'
import TypingIndicator from '@/components/primitives/TypingIndicator'
import { useTyping } from '@/hooks/useTyping'
import { notifyStudentMessage, notifyStudentsBroadcast } from '@/firebase/messageNotify'
import { fbAddMessageReply, fbDeleteMessage } from '@/firebase/persistence'
import Modal from '@/components/primitives/Modal'
import KebabMenu from '@/components/primitives/KebabMenu'
import { X, Pencil, Send, CheckCheck, Megaphone, Trash2, Search, ChevronDown, ChevronLeft, Check, BookOpen, SquarePen, MoreHorizontal } from 'lucide-react'

// Human-readable recipient label for a message's `to` field.
function recipientDisplay(to, students) {
  if (to === 'all') return 'All Students'
  if (typeof to === 'string' && to.startsWith('class:')) return 'Class Broadcast'
  if (typeof to === 'string' && to.startsWith('subject:')) return to.slice(8) + ' (subject)'
  return students.find(s => s.id === to)?.name || to
}

// Students enrolled in any of the given class ids.
function studentsInClasses(students, classIds) {
  const ids = classIds || []
  return students.filter(s => ids.some(id => s.classId === id || s.classIds?.includes(id)))
}

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
function RecipientPicker({ students, classes, classGroups, classBroadcasts, subjectGroups, value, onChange }) {
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
    if (typeof value === 'string' && value.startsWith('subject:')) {
      const name = value.slice(8)
      const g = (subjectGroups || []).find(x => x.subject === name)
      return { label: name, sub: g ? `Subject group · ${g.count} student${g.count !== 1 ? 's' : ''}` : 'Subject group', subjectIcon: true }
    }
    const s = students.find(x => x.id === value)
    return s ? { label: s.name, sub: studentTag(s, classes), photo: s.photo, char: getInitials(s.name) } : { label: 'Select recipient…', sub: '' }
  }, [value, students, classes, subjectGroups])

  const ql = q.trim().toLowerCase()
  const matchStudent = s => !ql || s.name.toLowerCase().includes(ql) || String(s.id).toLowerCase().includes(ql)
  const matchSubject = g => !ql || g.subject.toLowerCase().includes(ql)

  function pick(v) { onChange(v); setOpen(false); setQ('') }

  return (
    <div className="recipient-picker" ref={wrapRef}>
      <button type="button" className="recipient-trigger input w-full" onClick={() => setOpen(o => !o)}>
        <Avatar photo={selected.photo} char={selected.char || (selected.subjectIcon ? <BookOpen size={14} /> : <Megaphone size={15} />)} announce={selected.announce || selected.subjectIcon} size={26} />
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
                {(classBroadcasts || []).map(cls => {
                  const v = 'class:' + cls.id
                  const label = `${cls.name}${cls.section ? ' ' + cls.section : ''}`
                  return (
                    <button type="button" key={v} className="recipient-opt" onClick={() => pick(v)}>
                      <Avatar char={<Megaphone size={15} />} announce size={30} />
                      <span className="recipient-opt-text"><span className="recipient-opt-name">All in {label}</span><span className="recipient-opt-sub">Class broadcast</span></span>
                      {value === v && <Check size={15} className="recipient-check" />}
                    </button>
                  )
                })}
              </>
            )}
            {/* Current-semester subjects → group message to everyone taking it */}
            {(subjectGroups || []).some(matchSubject) && (
              <>
                <div className="recipient-divider">Subjects (this semester)</div>
                {(subjectGroups || []).filter(matchSubject).map(g => {
                  const v = 'subject:' + g.subject
                  return (
                    <button type="button" key={v} className="recipient-opt" onClick={() => pick(v)}>
                      <Avatar char={<BookOpen size={14} />} announce size={30} />
                      <span className="recipient-opt-text">
                        <span className="recipient-opt-name">{g.subject}</span>
                        <span className="recipient-opt-sub">Group chat · {g.count} student{g.count !== 1 ? 's' : ''}</span>
                      </span>
                      {value === v && <Check size={15} className="recipient-check" />}
                    </button>
                  )
                })}
              </>
            )}
            {!ql && <div className="recipient-divider">Individual students</div>}
            {/* Individual students */}
            {Object.keys(classGroups).sort().flatMap(label =>
              sortByLastName(classGroups[label]).filter(matchStudent).map(s => (
                <button type="button" key={s.id} className="recipient-opt" onClick={() => pick(s.id)}>
                  <Avatar photo={s.photo} char={getInitials(s.name)} size={30} />
                  <span className="recipient-opt-text">
                    <span className="recipient-opt-name">{s.name}{s.account?.registered ? '' : ' · no account'}</span>
                    <span className="recipient-opt-sub">{studentTag(s, classes) || label}</span>
                  </span>
                  {value === s.id && <Check size={15} className="recipient-check" />}
                </button>
              ))
            )}
            {ql && !students.some(matchStudent) && !(subjectGroups || []).some(matchSubject) && (
              <div className="recipient-empty">No recipients match “{q}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Compose Modal ─────────────────────────────────────────────────────
function ComposeModal({ onClose, replyToStudentId = null }) {
  const { students, classes, messages, semester, db, fbReady } = useData()
  const { toast } = useUI()
  const [to, setTo]           = useState(replyToStudentId || 'all')
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

  // Current-semester (non-archived) classes — broadcast + subject targets.
  const currentClasses = useMemo(() => classes.filter(c => isClassCurrent(c, semester)), [classes, semester])

  // Open subjects for the CURRENT semester → a group message reaches every
  // student enrolled in a current-semester class that teaches that subject.
  // Listed even with 0 students enrolled yet: the teacher can create the group
  // chat now, and students auto-join when they're added to the class.
  const subjectGroups = useMemo(() => {
    const bySubject = {}
    currentClasses.forEach(c => {
      (c.subjects || []).forEach(sub => {
        if (!bySubject[sub]) bySubject[sub] = new Set()
        bySubject[sub].add(c.id)
      })
    })
    return Object.keys(bySubject).sort().map(sub => {
      const classIds = [...bySubject[sub]]
      const count = studentsInClasses(students, classIds).length
      return { subject: sub, classIds, count }
    })
  }, [currentClasses, students])

  // Resolve the target class ids for the chosen subject (used at send time).
  function subjectClassIds(name) {
    return (subjectGroups.find(g => g.subject === name)?.classIds) || []
  }

  async function handleSend() {
    setErr('')
    if (!body.trim())       { setErr('Type a message first.'); return }
    if (body.length > 3000) { setErr('Message too long (max 3000 characters).'); return }
    if (!fbReady || !db.current) { setErr('Firebase is not connected.'); return }

    setSending(true)
    const isClassBroadcast   = to.startsWith('class:')
    const isSubjectBroadcast = to.startsWith('subject:')
    const classId     = isClassBroadcast ? to.slice(6) : null
    const subjectName = isSubjectBroadcast ? to.slice(8) : null
    const subjClassIds = isSubjectBroadcast ? subjectClassIds(subjectName) : null
    const msgType = (to === 'all' || isClassBroadcast || isSubjectBroadcast) ? 'announcement' : 'direct'
    const id = msgId()
    const snippet = body.trim().slice(0, 80)

    if (isSubjectBroadcast && (!subjClassIds || !subjClassIds.length)) {
      setErr('That subject has no current-semester classes.'); setSending(false); return
    }

    const msg = {
      id,
      from:      'admin',
      to,
      subject:   '',            // no subject field — message body stands alone
      body:      body.trim(),
      ts:        Date.now(),
      read:      [],
      adminRead: true,
      replies:   [],
      type:      msgType,
      classId:   classId || null,
      // Subject group messages fan out to every current-semester class teaching
      // the subject; students receive it if enrolled in any of these.
      classIds:  subjClassIds || null,
      targetSubject: subjectName || null,
    }

    try {
      await setDoc(doc(db.current, 'messages', id), msg)
      // Notify the recipient(s): in-app badge + best-effort web push.
      if (to === 'all') {
        notifyStudentsBroadcast(db.current, students.map(s => s.id), snippet)
      } else if (isClassBroadcast) {
        const ids = students
          .filter(s => s.classId === classId || s.classIds?.includes(classId))
          .map(s => s.id)
        notifyStudentsBroadcast(db.current, ids, snippet)
      } else if (isSubjectBroadcast) {
        const ids = studentsInClasses(students, subjClassIds).map(s => s.id)
        notifyStudentsBroadcast(db.current, ids, snippet)
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

  // Contextual hint describing where this message goes.
  const sendHint = (() => {
    if (to === 'all') return 'Announcement to every student'
    if (to.startsWith('class:')) return 'Class broadcast group chat'
    if (to.startsWith('subject:')) return 'Subject group chat — everyone taking it'
    const s = students.find(x => x.id === to)
    return s ? `Direct message to ${s.name}` : 'Choose a recipient'
  })()

  return (
    <Modal onClose={onClose} size="md">
      <div className="pr-8 mb-4">
        <h3 className="text-lg font-bold text-ink mb-1"><Pencil size={18} /> New Message</h3>
        <p className="text-xs text-ink2">Send a direct message or start a group chat — no subject needed.</p>
      </div>

      <div className="field mb-1">
        <label className="text-xs font-semibold text-ink2 mb-1 block">To</label>
        <RecipientPicker
          students={students}
          classes={classes}
          classGroups={classGroups}
          classBroadcasts={currentClasses}
          subjectGroups={subjectGroups}
          value={to}
          onChange={setTo}
        />
      </div>
      <div className="text-xs text-ink3 mb-3" style={{ paddingLeft: 2 }}>{sendHint}</div>

      <div className="field mb-2">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Message</label>
        <textarea
          className="input w-full"
          rows={6}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend() }}
          placeholder="Type your message here…  (Ctrl/⌘ + Enter to send)"
          maxLength={3000}
          autoFocus
        />
        <div className="text-xs text-ink3 mt-1" style={{ textAlign: 'right' }}>{body.length}/3000</div>
      </div>

      {err && <div className="err-msg mb-2">{err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSend} disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : <><Send size={16} /> Send</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Thread Panel ──────────────────────────────────────────────────────
function ThreadPanel({ thread, onReply, onClose, onDelete, onRename }) {
  const messagesEndRef = useRef(null)
  const chatKey = thread ? (thread.type === 'conversation' ? 'direct_' + thread.studentId : 'group_' + thread.msgId) : null
  const { typers, notifyTyping, stopTyping } = useTyping(chatKey, { id: 'admin', name: 'Teacher' })

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

  const GROUP_GAP = 5 * 60 * 1000 // 5 min → start a new visual group
  const timeLabel = ts => new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  const isGroup = thread.isGroup
  const memberCount = (thread.members || []).length
  const subtitle = isGroup ? `Group · ${memberCount} member${memberCount === 1 ? '' : 's'}` : thread.headerSub
  let lastSelfIdx = -1
  thread.entries.forEach((e, i) => { if (e.from === 'admin') lastSelfIdx = i })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread header */}
      <div className="msg-thread-head">
        {onClose && (
          <button className="msg-icon-btn md:hidden" onClick={onClose} title="Back" style={{ width: 28, marginLeft: -4 }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <div className={`msg-thread-head-av ${isGroup ? 'announce' : ''}`}>
          {thread.headerPhoto
            ? <img src={thread.headerPhoto} alt="" />
            : (isGroup ? <Megaphone size={16} /> : getInitials(thread.headerName))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-semibold text-ink text-sm truncate">{thread.headerName}</div>
          <div className="text-xs text-ink2 truncate">{subtitle}</div>
        </div>
        {(onRename || onDelete) && (
          <KebabMenu icon={<MoreHorizontal size={18} />} label="Conversation actions" items={[
            onRename && { label: 'Rename group chat', onClick: onRename },
            onDelete && { label: 'Delete conversation', onClick: onDelete, danger: true },
          ]} />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        {thread.entries.map((entry, i) => {
          const isAdmin = entry.from === 'admin'
          const prev = thread.entries[i - 1]
          const next = thread.entries[i + 1]
          const sameAsPrev = prev && prev.from === entry.from && (entry.ts - prev.ts) < GROUP_GAP
          const sameAsNext = next && next.from === entry.from && (next.ts - entry.ts) < GROUP_GAP
          const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(entry.ts).toDateString()
          const lastOfGroup = !sameAsNext
          const firstOfGroup = !sameAsPrev
          return (
            <React.Fragment key={i}>
              {showDay && <div className="msg-day-sep"><span>{dayLabel(entry.ts)}</span></div>}
              {!isAdmin && isGroup && firstOfGroup && <div className="msg-sender-name">{entry.senderLabel}</div>}
              <div className={`msg-bubble-row ${isAdmin ? 'sent' : 'received'}`} style={{ marginTop: sameAsPrev ? 2 : 8 }} title={timeLabel(entry.ts)}>
                {!isAdmin && (
                  <div className="msg-avatar-slot">
                    {lastOfGroup && <div className="msg-avatar-sm">{getInitials(entry.senderLabel)}</div>}
                  </div>
                )}
                <div className={`msg-bubble ${isAdmin ? 'sent' : 'received'} ${lastOfGroup ? 'tail' : ''}`}>
                  {entry.isMain && entry.subject && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: isAdmin ? 'rgba(255,255,255,.7)' : 'var(--c-accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {entry.subject}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                </div>
              </div>
              {isAdmin && i === lastSelfIdx && (
                <div className={`msg-seen ${entry.studentRead ? 'read' : ''}`} title={entry.readTitle}>
                  {entry.studentRead ? 'Seen' : 'Sent'} <CheckCheck size={13} />
                </div>
              )}
            </React.Fragment>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Group members + read receipts */}
      {thread.isGroup && (
        <GroupMembers members={thread.members} readerIds={thread.readerIds} readAt={thread.readAt} />
      )}

      {/* Live typing indicator */}
      <TypingIndicator typers={typers} />

      {/* Reply box */}
      <ReplyBox onSend={onReply} onType={notifyTyping} onStop={stopTyping} />
    </div>
  )
}

// ── Reply Box ─────────────────────────────────────────────────────────
function ReplyBox({ onSend, onType, onStop }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const t = text.trim()
    if (!t) return
    setSending(true)
    onStop?.()
    await onSend(t)
    setText('')
    setSending(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div id="admin-reply-input-wrap" className="msg-reply-bar">
      <div className="msg-reply-pill">
        <textarea
          className="msg-reply-input"
          rows={1}
          value={text}
          onChange={e => { setText(e.target.value); onType?.() }}
          onBlur={() => onStop?.()}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={sending}
        />
      </div>
      <button
        className="msg-send-circle"
        onClick={handleSend}
        disabled={sending || !text.trim()}
        title="Send (Ctrl/⌘+Enter)"
      >
        <Send size={16} />
      </button>
    </div>
  )
}

// ── Conversation Item ─────────────────────────────────────────────────
function ConvItem({ isActive, isUnread, avatarChar, photo, isAnnounce, name, preview, time, onClick, selectMode, selected, onToggleSelect, menuItems }) {
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
      {!selectMode && menuItems && menuItems.length > 0 && (
        <KebabMenu items={menuItems} />
      )}
    </div>
  )
}

// ── Rename group chat ─────────────────────────────────────────────────
function RenameGroupModal({ current, autoName, onClose, onSave }) {
  const [name, setName] = useState(current || autoName)
  return (
    <Modal onClose={onClose} size="sm">
      <h3 className="text-lg font-bold text-ink mb-1"><Pencil size={18} /> Rename group chat</h3>
      <p className="text-xs text-ink2 mb-3">Give this group chat a custom name, or reset to the auto name (subject · course year).</p>
      <input
        className="input w-full mb-1"
        value={name}
        autoFocus
        maxLength={120}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(name.trim()) }}
        placeholder={autoName}
      />
      <div className="text-xs text-ink3 mb-4">Auto name: {autoName}</div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={() => onSave('')}>Reset to auto</button>
        <button className="btn btn-primary" onClick={() => onSave(name.trim())}>Save</button>
      </div>
    </Modal>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
const PER_PAGE = 10

export default function MessagesTab() {
  const { students, classes, messages, db, fbReady } = useData()
  const { toast, openDialog } = useUI()

  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [activeConv, setActiveConv]     = useState(null) // { type, studentId?, msgId? }
  const [showCompose, setShowCompose]   = useState(false)
  const [replyTo, setReplyTo]           = useState(null)
  const [selectMode, setSelectMode]     = useState(false)
  const [selected, setSelected]         = useState(() => new Set()) // typed tokens: conv:{sid} | msg:{id}
  const [renameTargetId, setRenameTargetId] = useState(null)

  function exitSelect() { setSelectMode(false); setSelected(new Set()) }
  function toggleSelect(token) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(token) ? next.delete(token) : next.add(token)
      return next
    })
  }

  // Typed tokens: conv:{sid} → every doc of that direct conversation; msg:{id} → that doc.
  function resolveDocIds(token) {
    if (token.startsWith('conv:')) {
      const sid = token.slice(5)
      return messages
        .filter(m => m.from === sid || (m.from === 'admin' && m.to === sid && m.type === 'direct'))
        .map(m => m.id)
    }
    if (token.startsWith('msg:')) return [token.slice(4)]
    return []
  }

  async function deleteTokens(tokens) {
    if (!tokens.length) return
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    const ids = new Set()
    tokens.forEach(t => resolveDocIds(t).forEach(id => ids.add(id)))
    if (!ids.size) return
    const ok = await openDialog({
      title: `Delete ${tokens.length} ${tokens.length > 1 ? 'items' : 'item'}?`,
      msg: `This permanently removes the selected message${tokens.length > 1 ? 's' : ''} for everyone — they are also removed from the students' inboxes. This cannot be undone.`,
      type: 'danger', confirmLabel: 'Delete', showCancel: true,
    })
    if (!ok) return
    try {
      await Promise.all([...ids].map(id => fbDeleteMessage(db.current, id).catch(() => {})))
      toast(`Deleted ${tokens.length} ${tokens.length > 1 ? 'items' : 'item'}.`, 'green')
      // Close the open thread if its document was just deleted.
      if (activeConv?.type === 'conversation' && tokens.includes('conv:' + activeConv.studentId)) setActiveConv(null)
      if (activeConv?.type === 'message' && tokens.includes('msg:' + activeConv.msgId)) setActiveConv(null)
      exitSelect()
    } catch (e) {
      toast('Delete failed: ' + e.message, 'red')
    }
  }

  // Persist a group-chat rename (empty → reset to the auto name).
  async function saveGroupName(id, newName) {
    setRenameTargetId(null)
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    try {
      await updateDoc(doc(db.current, 'messages', id), { groupName: newName || '' })
      toast(newName ? 'Group chat renamed.' : 'Reset to auto name.', 'green')
    } catch (e) {
      toast('Rename failed: ' + e.message, 'red')
    }
  }

  // ── Unified inbox: direct conversations (both directions) + group chats ──
  // Direct conversations keyed by the student party of each direct message.
  const directConvs = useMemo(() => {
    const byStudent = {}
    messages.forEach(m => {
      if (m.type === 'announcement') return
      let sid = null
      if (m.from && m.from !== 'admin') sid = m.from
      else if (m.from === 'admin' && m.to && m.to !== 'admin' && m.to !== 'all'
        && !String(m.to).startsWith('class:') && !String(m.to).startsWith('subject:')) sid = m.to
      if (!sid) return
      ;(byStudent[sid] ||= []).push(m)
    })
    return Object.entries(byStudent).map(([sid, arr]) => {
      arr.sort((a, b) => b.ts - a.ts)
      const latest = arr[0]
      const allReplies = arr.flatMap(m => m.replies || [])
      const lastActivity = allReplies.length ? Math.max(latest.ts, ...allReplies.map(r => r.ts || 0)) : latest.ts
      const hasUnread = arr.some(m => !m.adminRead)
      return { kind: 'conversation', token: 'conv:' + sid, sid, latestMsg: latest, allMsgs: arr, lastActivity, hasUnread }
    })
  }, [messages])

  // Group chats / broadcasts — every admin announcement is its own thread item.
  const groupItems = useMemo(() => {
    return messages.filter(isGroupMessage).map(m => {
      const replies = m.replies || []
      const lastActivity = replies.length ? Math.max(m.ts, ...replies.map(r => r.ts || 0)) : m.ts
      return { kind: 'message', token: 'msg:' + m.id, msg: m, lastActivity, hasUnread: !m.adminRead }
    })
  }, [messages])

  // Merge + search.
  const filteredList = useMemo(() => {
    const all = [...directConvs, ...groupItems].sort((a, b) => b.lastActivity - a.lastActivity)
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(item => {
      if (item.kind === 'conversation') {
        const s = students.find(x => x.id === item.sid)
        const name = (s?.name || item.sid).toLowerCase()
        return name.includes(q) || item.allMsgs.some(m =>
          m.subject?.toLowerCase().includes(q) || m.body?.toLowerCase().includes(q) ||
          (m.replies || []).some(r => r.body?.toLowerCase().includes(q)))
      }
      const m = item.msg
      return groupName(m, classes).toLowerCase().includes(q) ||
        m.subject?.toLowerCase().includes(q) || m.body?.toLowerCase().includes(q)
    })
  }, [directConvs, groupItems, search, students, classes])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PER_PAGE))
  const pageSlice  = useMemo(
    () => filteredList.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filteredList, page]
  )

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
        headerSub: studentTag(s, classes) || sid,
        headerPhoto: s?.photo || null,
        isGroup: false,
        entries,
      }
    }

    if (activeConv.type === 'message') {
      const m = messages.find(x => x.id === activeConv.msgId)
      if (!m) return null
      const recipientName = recipientDisplay(m.to, students)
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

      const group = isGroupMessage(m)
      return {
        type: 'message',
        msgId: m.id,
        isGroup: group,
        headerName: group ? groupName(m, classes) : ('→ ' + recipientName),
        headerSub: (m.subject ? m.subject + ' · ' : '') + new Date(m.ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
        entries,
        members: group ? groupMembers(m, students) : [],
        readerIds: Array.isArray(m.read) ? m.read : [],
        readAt: m.readAt || {},
      }
    }

    return null
  }, [activeConv, messages, students, classes])

  // ── Open conversation / message ──────────────────────────────────
  async function openConversation(sid) {
    // Mark the whole conversation (both directions) read.
    const unread = messages.filter(m =>
      (m.from === sid || (m.from === 'admin' && m.to === sid && m.type === 'direct')) && !m.adminRead)
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
        } else if (typeof m.to === 'string' && m.to.startsWith('subject:')) {
          const ids = studentsInClasses(students, m.classIds).map(s => s.id)
          notifyStudentsBroadcast(db.current, ids, text)
        } else if (m.to && m.to !== 'admin') {
          notifyStudentMessage(db.current, m.to, text)
        }
      }
    } catch (e) {
      toast('Failed to send reply: ' + e.message, 'red')
    }
  }

  // ── Render the unified list (direct conversations + group chats) ──────
  function renderListItems() {
    if (!filteredList.length) {
      return <div className="empty" style={{ padding: '32px 20px' }}>{search ? 'No messages match your search.' : 'No messages yet.'}</div>
    }
    return pageSlice.map(item => {
      if (item.kind === 'conversation') {
        const s = students.find(x => x.id === item.sid)
        const name = s?.name || item.sid
        const preview = (item.latestMsg.body || '').slice(0, 60) + ((item.latestMsg.body || '').length > 60 ? '…' : '')
        const isActive = activeConv?.type === 'conversation' && activeConv.studentId === item.sid
        return (
          <ConvItem
            key={item.token}
            isActive={isActive}
            isUnread={item.hasUnread}
            avatarChar={getInitials(name)}
            photo={s?.photo}
            isAnnounce={false}
            name={name}
            preview={preview}
            time={relativeTime(item.lastActivity)}
            onClick={() => openConversation(item.sid)}
            selectMode={selectMode}
            selected={selected.has(item.token)}
            onToggleSelect={() => toggleSelect(item.token)}
            menuItems={[{ label: 'Delete', danger: true, onClick: () => deleteTokens([item.token]) }]}
          />
        )
      }
      // Group chat / broadcast
      const m = item.msg
      const isSubject = typeof m.to === 'string' && m.to.startsWith('subject:')
      const preview = (m.subject ? m.subject + ' — ' : '') + (m.body || '').slice(0, 60) + ((m.body || '').length > 60 ? '…' : '')
      const isActive = activeConv?.type === 'message' && activeConv.msgId === m.id
      return (
        <ConvItem
          key={item.token}
          isActive={isActive}
          isUnread={item.hasUnread}
          avatarChar={isSubject ? <BookOpen size={16} /> : <Megaphone size={18} />}
          isAnnounce
          name={groupName(m, classes)}
          preview={preview}
          time={relativeTime(item.lastActivity)}
          onClick={() => openMessage(m.id)}
          selectMode={selectMode}
          selected={selected.has(item.token)}
          onToggleSelect={() => toggleSelect(item.token)}
          menuItems={[
            { label: 'Rename', onClick: () => setRenameTargetId(m.id) },
            { label: 'Delete', danger: true, onClick: () => deleteTokens([item.token]) },
          ]}
        />
      )
    })
  }

  const totalUnread = filteredList.filter(it => it.hasUnread).length

  return (
    <div className="flex flex-col msg-fill-height">
      {/* Main layout: list + thread (single-pane on mobile) */}
      <div className={`msg-shell flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden bg-surface${activeConv ? ' has-active' : ''}`}>

        {/* Left: conversation list */}
        <div className="msg-list-pane flex flex-col border-r border-border" style={{ width: 300, minWidth: 260, flexShrink: 0 }}>
          {/* Pane header: title + compose */}
          <div className="msg-pane-head">
            <span className="msg-pane-title">Inbox</span>
            <button className="msg-icon-btn" onClick={() => setShowCompose(true)} title="New message" aria-label="New message"><SquarePen size={18} /></button>
          </div>

          {/* Search pill */}
          <div className="msg-search-pill">
            <Search size={15} />
            <input aria-label="Search messages" placeholder="Search" value={search} onChange={e => handleSearch(e.target.value)} />
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
              onDelete={() => deleteTokens([thread.type === 'conversation' ? 'conv:' + thread.studentId : 'msg:' + thread.msgId])}
              onRename={thread.isGroup ? () => setRenameTargetId(thread.msgId) : null}
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

      {renameTargetId && (() => {
        const m = messages.find(x => x.id === renameTargetId)
        if (!m) return null
        return (
          <RenameGroupModal
            current={m.groupName}
            autoName={autoGroupName(m, classes)}
            onClose={() => setRenameTargetId(null)}
            onSave={name => saveGroupName(m.id, name)}
          />
        )
      })()}
    </div>
  )
}
