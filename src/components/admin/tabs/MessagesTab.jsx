import React, { useState, useMemo, useRef, useEffect } from 'react'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName, dayLabel, getInitials, fmtTime as timeLabel, relativeTime } from '@/utils/format'
import { groupFlags, previewText } from '@/utils/messageThread'
import { isClassCurrent } from '@/utils/active'
import { isGroupMessage, autoGroupName, groupName, studentTag, groupMembers, courseShort } from '@/utils/groupChat'
import ChatMembersModal from '@/components/primitives/ChatMembersModal'
import SeenAvatars from '@/components/primitives/SeenAvatars'
import { anchorMap as seenAnchorMap } from '@/utils/seenReceipts'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import EmptyState from '@/components/ds/EmptyState'
import TypingIndicator from '@/components/primitives/TypingIndicator'
import { useTyping } from '@/hooks/useTyping'
import { notifyStudentMessage, notifyStudentsBroadcast, notifyMention } from '@/firebase/messageNotify'
import { resolveMentions } from '@/utils/mentions'
import { fbAddMessageReply, fbDeleteMessage, fbEditMessageEntry, fbDeleteMessageEntry, fbToggleMessageReaction } from '@/firebase/persistence'
import { ReactionTrigger, ReactionBar, ReactionPills } from '@/components/primitives/MessageReactions'
import Modal from '@/components/primitives/Modal'
import MentionInput from '@/components/primitives/MentionInput'
import MessageText from '@/components/primitives/MessageText'
import PostRefCard from '@/components/primitives/PostRefCard'
import KebabMenu from '@/components/primitives/KebabMenu'
import { X, Pencil, Send, CheckCheck, Megaphone, Trash2, Search, ChevronDown, ChevronLeft, Check, BookOpen, SquarePen, MoreHorizontal, Camera, Lock, Ban } from 'lucide-react'
import SecureBubble from '@/components/primitives/SecureBubble'
import SwipeReply from '@/components/primitives/SwipeReply'
import { classifySensitivity, sensitivityLabel } from '@/utils/sensitiveContent'
import { Reply } from 'lucide-react'
import useInfiniteFeed from '@/hooks/useInfiniteFeed'

// Human-readable recipient label for a message's `to` field.
function recipientDisplay(to, students) {
  if (to === 'all') return 'All Students'
  if (typeof to === 'string' && to.startsWith('class:')) return 'Class Broadcast'
  if (typeof to === 'string' && to.startsWith('subject:')) return to.slice(8) + ' (subject)'
  return students.find(s => s.id === to)?.name || to
}

// Resolve a single student's display name by id (falls back to the id). One home
// for the per-student lookup the conversation/header/sender labels all need.
function peerName(students, id) {
  return students.find(s => s.id === id)?.name || id
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
      return { label: cls ? `All in ${courseShort(cls.name)} ${cls.section}` : 'Class broadcast', sub: 'Announcement', announce: true }
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
                  const label = `${courseShort(cls.name)}${cls.section ? ' ' + cls.section : ''}`
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
                    <span className="recipient-opt-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.name}<VerifiedBadge student={s} size={13} />{s.account?.registered ? '' : ' · no account'}</span>
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
  const [secureOn, setSecureOn] = useState(false)
  const [secureTouched, setSecureTouched] = useState(false)
  const draftFlag = useMemo(() => classifySensitivity(body), [body])
  useEffect(() => { if (!secureTouched) setSecureOn(draftFlag.sensitive) }, [draftFlag, secureTouched])

  // Build grouped student options
  const classGroups = useMemo(() => {
    const groups = {}
    students.forEach(s => {
      const cls = classes.find(c => c.id === s.classId)
      const label = cls ? courseShort(cls.name) + ' ' + cls.section : 'Unassigned'
      if (!groups[label]) groups[label] = []
      groups[label].push(s)
    })
    return groups
  }, [students, classes])

  // Current-semester (non-archived) classes - broadcast + subject targets.
  const currentClasses = useMemo(() => classes.filter(c => isClassCurrent(c, semester)), [classes, semester])

  // Open subjects for the CURRENT semester → a group message reaches every
  // student enrolled in a current-semester class that teaches that subject.
  // Listed even with 0 students enrolled yet: the professor can create the group
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
      subject:   '',            // no subject field - message body stands alone
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
      ...(secureOn ? { secure: true } : {}),
    }

    try {
      await setDoc(doc(db.current, 'messages', id), msg)
      // Notify the recipient(s): in-app badge + best-effort web push.
      if (to === 'all') {
        notifyStudentsBroadcast(db.current, students.map(s => s.id), snippet, { secure: secureOn })
      } else if (isClassBroadcast) {
        const ids = students
          .filter(s => s.classId === classId || s.classIds?.includes(classId))
          .map(s => s.id)
        notifyStudentsBroadcast(db.current, ids, snippet, { secure: secureOn })
      } else if (isSubjectBroadcast) {
        const ids = studentsInClasses(students, subjClassIds).map(s => s.id)
        notifyStudentsBroadcast(db.current, ids, snippet, { secure: secureOn })
      } else {
        notifyStudentMessage(db.current, to, body.trim(), undefined, { secure: secureOn })
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
    if (to.startsWith('subject:')) return 'Subject group chat - everyone taking it'
    const s = students.find(x => x.id === to)
    return s ? `Direct message to ${s.name}` : 'Choose a recipient'
  })()

  return (
    <Modal onClose={onClose} size="md">
      <div className="pr-8 mb-4">
        <h3 className="text-lg font-bold text-ink mb-1"><Pencil size={18} /> New Message</h3>
        <p className="text-xs text-ink2">Send a direct message or start a group chat - no subject needed.</p>
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

      <div className="field mb-2" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm ${secureOn ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setSecureTouched(true); setSecureOn(v => !v) }}
          aria-pressed={secureOn}
        >
          <Lock size={14} style={{ marginRight: 5 }} /> {secureOn ? 'Private - on' : 'Send as private'}
        </button>
        {secureOn && (
          <span style={{ fontSize: 12, color: 'var(--accent)' }}>
            {draftFlag.sensitive ? `Smart-lock: ${sensitivityLabel(draftFlag.reasons)} - recipients must tap to reveal.` : 'Recipients must tap to reveal.'}
          </span>
        )}
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
function ThreadPanel({ thread, students, onReply, onClose, onDelete, onRename, onEditEntry, onDeleteEntry, onToggleReaction, onRetry }) {
  const { setAdminTab } = useUI()
  const myId = 'admin'
  const messagesEndRef = useRef(null)
  const chatKey = thread ? (thread.type === 'conversation' ? 'direct_' + thread.studentId : 'group_' + thread.msgId) : null
  const { typers, notifyTyping, stopTyping } = useTyping(chatKey, { id: 'admin', name: 'Professor' })
  const [replyingTo, setReplyingTo] = useState(null) // { author, text } | null
  const [editing, setEditing] = useState(null)   // entry key being edited
  const [editDraft, setEditDraft] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [reactKey, setReactKey] = useState(null) // entryKey whose reaction picker is open

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])
  // Drop any pending reply target / open editor / members modal when the thread changes.
  useEffect(() => { setReplyingTo(null); setEditing(null); setShowMembers(false); setReactKey(null) }, [chatKey])

  function startReplyTo(entry) {
    const author = entry.from === 'admin' ? 'You' : (entry.senderLabel || 'Student')
    const text = entry.secure ? '🔒 Private message' : (entry.body || '')
    setReplyingTo({ author, text: text.slice(0, 140) })
  }
  async function doReply(text, secure) {
    await onReply(text, secure, replyingTo)
    setReplyingTo(null)
  }

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink3 text-sm">
        Select a conversation to view messages.
      </div>
    )
  }

  const isGroup = thread.isGroup
  // Mentionable members for a group chat - the professor can @tag any student in it.
  const mentionCandidates = isGroup ? (thread.members || []).map(m => ({ id: m.id, name: m.name, photo: m.photo })) : []
  const memberCount = (thread.members || []).length
  const subtitle = isGroup ? `Group · ${memberCount} member${memberCount === 1 ? '' : 's'}` : thread.headerSub
  // Hide bubbles this professor deleted "for me" only; everyone-deletes stay as a
  // tombstone (they carry deleted:true, not a hiddenFor entry).
  const entries = (thread.entries || []).filter(e => !(e.hiddenFor || []).includes(myId))
  // The 1:1 peer (for the Messenger-style "seen" avatar under the last message).
  const peer = !isGroup ? students.find(x => x.id === thread.studentId) : null
  // Read receipts, Messenger-style: each reader's avatar drops under the last of
  // my bubbles they have actually seen (by read timestamp), not blindly under the
  // newest one. See seenReceipts.js. Group members carry their own readAt; a 1:1
  // peer carries the conversation's peerReadTs.
  const seenReaders = isGroup
    ? (thread.members || []).map(m => {
        let readTs = (thread.readAt || {})[m.id] || 0
        entries.forEach(e => { if (e.from === m.id) readTs = Math.max(readTs, e.ts || 0) })
        return { id: m.id, name: m.name, photo: m.photo, readTs }
      }).filter(r => r.readTs > 0)
    : (thread.peerReadTs
        ? [{ id: thread.studentId, name: thread.headerName, photo: peer?.photo, readTs: thread.peerReadTs }]
        : [])
  const seenMap = seenAnchorMap(entries, e => e.from === 'admin', seenReaders)
  function entryKey(e) { return (e.isMain ? 'm:' : 'r:') + e.msgId + ':' + e.ts + ':' + e.from }
  function saveEdit(entry) { const t = editDraft.trim(); setEditing(null); if (t && t !== entry.body) onEditEntry?.(entry, t) }
  // Last of my still-present bubbles - where a "Sent/Delivered" hint shows when the
  // recipient has not yet caught up to it.
  let lastSelfIdx = -1
  entries.forEach((e, i) => { if (e.from === 'admin' && !e.deleted) lastSelfIdx = i })

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
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
          <div className="font-semibold text-ink text-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span className="truncate">{thread.headerName}</span>
            <VerifiedBadge studentId={thread.studentId} students={students} size={14} />
          </div>
          <div className="text-xs text-ink2 truncate">{subtitle}</div>
        </div>
        {(isGroup || onRename || onDelete) && (
          <KebabMenu icon={<MoreHorizontal size={18} />} label="Conversation actions" items={[
            isGroup && { label: 'See chat members', onClick: () => setShowMembers(true) },
            onRename && { label: 'Rename group chat', onClick: onRename },
            onDelete && { label: 'Delete conversation', onClick: onDelete, danger: true },
          ]} />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        {entries.map((entry, i) => {
          const isAdmin = entry.from === 'admin'
          if (entry.kind === 'screenshot') {
            const who = isAdmin ? 'You' : (entry.senderLabel || 'Student')
            return (
              <div key={i} className="msg-screenshot-note">
                <Camera size={13} /> {who} took a screenshot
              </div>
            )
          }
          const { sameAsPrev, sameAsNext, firstOfGroup, lastOfGroup, showDay } = groupFlags(entries, i)
          const eKey = entryKey(entry)
          const isEditing = editing === eKey
          // Own, still-present text bubbles can be edited; anyone can hide a bubble
          // for themselves; only the author can delete it for everyone.
          const editable = isAdmin && !entry.deleted && !entry.postRef && entry.kind !== 'screenshot'
          const menuItems = entry.deleted ? [] : [
            { label: 'Reply', onClick: () => startReplyTo(entry) },
            editable && { label: 'Edit', onClick: () => { setEditing(eKey); setEditDraft(entry.body || '') } },
            entry.body && !entry.secure && { label: 'Copy', onClick: () => navigator.clipboard?.writeText(entry.body).catch(() => {}) },
            { label: 'Delete for you', onClick: () => onDeleteEntry?.(entry, 'me') },
            isAdmin && { label: 'Delete for everyone', danger: true, onClick: () => onDeleteEntry?.(entry, 'everyone') },
          ].filter(Boolean)
          const reactOpen = reactKey === eKey
          const Actions = !isEditing && !entry.deleted && (
            <span className="msg-bubble-menu">
              <ReactionTrigger active={reactOpen} onToggle={() => setReactKey(reactOpen ? null : eKey)} />
              {menuItems.length > 0 && <KebabMenu items={menuItems} icon={<MoreHorizontal size={15} />} size={15} label="Message actions" />}
            </span>
          )
          return (
            <React.Fragment key={i}>
              {showDay && <div className="msg-day-sep"><span>{dayLabel(entry.ts)}</span></div>}
              {!isAdmin && isGroup && firstOfGroup && <div className="msg-sender-name">{entry.senderLabel}</div>}
              <SwipeReply side={isAdmin ? 'sent' : 'received'} onReply={() => startReplyTo(entry)} onLongPress={entry.deleted ? undefined : () => setReactKey(eKey)}>
                <div className={`msg-bubble-row ${isAdmin ? 'sent' : 'received'}`} style={{ marginTop: sameAsPrev ? 2 : 8 }} title={timeLabel(entry.ts)}>
                  {!isAdmin && (
                    <div className="msg-avatar-slot">
                      {lastOfGroup && <div className="msg-avatar-sm">{(() => {
                        const p = students.find(x => x.id === entry.from)?.photo
                        return p ? <img src={p} alt="" /> : getInitials(entry.senderLabel)
                      })()}</div>}
                    </div>
                  )}
                  {isAdmin && Actions}
                  {isEditing ? (
                    <div className="msg-edit-box">
                      <textarea
                        autoFocus
                        value={editDraft}
                        maxLength={3000}
                        onChange={e => setEditDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(entry) }
                        }}
                      />
                      <div className="msg-edit-actions">
                        <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                        <button type="button" className="primary" onClick={() => saveEdit(entry)}>Save</button>
                      </div>
                    </div>
                  ) : entry.deleted ? (
                    <div className={`msg-bubble ${isAdmin ? 'sent' : 'received'} deleted ${lastOfGroup ? 'tail' : ''}`}>
                      <span className="msg-deleted-text"><Ban size={12} /> {entry.deletedBy === myId ? 'You deleted this message' : 'This message was deleted'}</span>
                    </div>
                  ) : (
                    <div className={`msg-bubble ${isAdmin ? 'sent' : 'received'} ${lastOfGroup ? 'tail' : ''}`}>
                      {entry.isMain && entry.subject && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: isAdmin ? 'rgba(255,255,255,.7)' : 'var(--c-accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {entry.subject}
                        </div>
                      )}
                      {entry.quote && (
                        <span className="msg-quote">
                          <span className="msg-quote-author">{entry.quote.author}</span>
                          <span className="msg-quote-text">{entry.quote.text}</span>
                        </span>
                      )}
                      {entry.postRef && (
                        <PostRefCard postRef={entry.postRef} onOpen={() => setAdminTab('stream')} />
                      )}
                      {entry.secure
                        ? (isAdmin
                            ? <><span className="msg-own-private"><Lock size={10} /> Private</span><div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div></>
                            : <SecureBubble text={entry.body} />)
                        : <MessageText text={entry.body} mentions={entry.mentions} />}
                      {entry.editedAt && !entry.secure && <span className="msg-edited">edited</span>}
                    </div>
                  )}
                  {!isAdmin && Actions}
                </div>
              </SwipeReply>
              {reactOpen && (
                <ReactionBar
                  side={isAdmin ? 'sent' : 'received'}
                  onPick={emoji => { onToggleReaction?.(entry, emoji); setReactKey(null) }}
                  onClose={() => setReactKey(null)}
                />
              )}
              {!entry.deleted && (
                <ReactionPills
                  reactions={entry.reactions}
                  myId={myId}
                  side={isAdmin ? 'sent' : 'received'}
                  onToggle={emoji => onToggleReaction?.(entry, emoji)}
                />
              )}
              {/* Read receipts: avatars sit under the last bubble each reader has
                  actually seen (drops down live as they catch up). */}
              {!entry.deleted && seenMap.has(i) && (
                <SeenAvatars
                  people={seenMap.get(i).map(r => ({ id: r.id, name: r.name, photo: r.photo }))}
                  label={isGroup ? 'Seen by' : ('Seen' + (thread.peerReadTs ? ' ' + timeLabel(thread.peerReadTs) : ''))}
                  onClick={isGroup ? () => setShowMembers(true) : undefined}
                />
              )}
              {/* Send-status / Delivered hint under my newest bubble while unseen. */}
              {isAdmin && i === lastSelfIdx && !entry.deleted && !seenMap.has(i) && (
                entry.status === 'failed'
                  ? <div className="msg-seen msg-seen-failed" title="Not delivered">Not sent · <button type="button" className="msg-retry-btn" onClick={() => onRetry?.(entry)}>Retry</button></div>
                  : entry.status === 'sending'
                    ? <div className="msg-seen" title="Sending">Sending…</div>
                    : isGroup
                      ? <div className="msg-seen" title="Delivered">{seenMap.size ? 'Sent' : 'Sent · seen by 0'}</div>
                      : <div className="msg-seen" title={entry.readTitle}>Sent <CheckCheck size={12} /></div>
              )}
            </React.Fragment>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Live typing indicator */}
      <TypingIndicator typers={typers} />

      {/* Reply box */}
      <ReplyBox key={chatKey} onSend={doReply} onType={notifyTyping} onStop={stopTyping} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} candidates={mentionCandidates} />

      {/* Members + read receipts (opened from the header "See chat members") */}
      {showMembers && isGroup && (
        <ChatMembersModal members={thread.members} readerIds={thread.readerIds} readAt={thread.readAt} onClose={() => setShowMembers(false)} />
      )}
    </div>
  )
}

// ── Reply Box ─────────────────────────────────────────────────────────
function ReplyBox({ onSend, onType, onStop, replyingTo, onCancelReply, candidates = [] }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [secureOn, setSecureOn] = useState(false)
  const [secureTouched, setSecureTouched] = useState(false)
  const flag = useMemo(() => classifySensitivity(text), [text])
  useEffect(() => { if (!secureTouched) setSecureOn(flag.sensitive) }, [flag, secureTouched])

  async function handleSend() {
    const t = text.trim()
    if (!t) return
    const secure = secureOn
    onStop?.()
    // Optimistic clear: empty the composer immediately so the professor can fire
    // off the next message without waiting on the Firestore round-trip (group
    // sends felt slow because the input stayed disabled until the write landed).
    setText(''); setSecureOn(false); setSecureTouched(false)
    try { await onSend(t, secure) }
    catch (e) { setText(t) } // restore the draft if the send threw
  }

  return (
    <div>
      {replyingTo && (
        <div className="msg-reply-banner">
          <Reply size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div className="rb-body">
            <div className="rb-author">Replying to {replyingTo.author}</div>
            <div className="rb-text">{replyingTo.text}</div>
          </div>
          <button className="rb-x" onClick={onCancelReply} aria-label="Cancel reply"><X size={14} /></button>
        </div>
      )}
      {secureOn && (
        <div className="msg-lock-hint">
          <Lock size={12} /> {flag.sensitive ? `Private - ${sensitivityLabel(flag.reasons)}. Sent blurred.` : 'Private - sent blurred until tapped.'}
        </div>
      )}
      <div id="admin-reply-input-wrap" className="msg-reply-bar">
        <button
          type="button"
          className={`msg-lock-btn${secureOn ? ' on' : ''}`}
          onClick={() => { setSecureTouched(true); setSecureOn(v => !v) }}
          title={secureOn ? 'Private message - click to turn off' : 'Send as private (blurred until tapped)'}
          aria-pressed={secureOn}
          aria-label="Send as private message"
        >
          <Lock size={16} />
        </button>
        <div className="msg-reply-pill">
          <MentionInput
            multiline
            className="msg-reply-input"
            value={text}
            onChange={setText}
            onType={onType}
            onBlur={() => onStop?.()}
            onEnter={handleSend}
            candidates={candidates}
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
    </div>
  )
}

// ── Conversation Item ─────────────────────────────────────────────────
function ConvItem({ isActive, isUnread, avatarChar, photo, isAnnounce, name, badge, preview, time, onClick, selectMode, selected, onToggleSelect, menuItems }) {
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
        <div className="msg-conv-name" style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
          {badge}
        </div>
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

// Stable identity for one rendered entry, matched between an optimistic bubble
// and its snapshot echo (same doc id + ts + sender) so the two reconcile cleanly.
function reconcileKey(e) { return (e.isMain ? 'm:' : 'r:') + (e.msgId || '') + ':' + e.ts + ':' + e.from }
// Which open thread a pending bubble belongs to, so it only shows in its own thread.
function threadTokenOf(conv) {
  if (!conv) return null
  return conv.type === 'conversation' ? 'c:' + conv.studentId : 'm:' + conv.msgId
}

export default function MessagesTab() {
  const { students, classes, messages, db, fbReady } = useData()
  const { toast, openDialog } = useUI()
  // Optimistic, not-yet-echoed outgoing bubbles. Each carries a threadToken so it
  // renders only in its thread, and a status ('sending' | 'failed').
  const [pending, setPending] = useState([])

  const [search, setSearch]             = useState('')
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
    // Conversation/group-specific wording for a single delete; generic for bulk.
    let title, msg
    if (tokens.length === 1) {
      const tok = tokens[0]
      if (tok.startsWith('conv:')) {
        const who = (students.find(x => x.id === tok.slice(5))?.name) || 'this student'
        title = 'Delete this conversation?'
        msg = `This permanently deletes your conversation with ${who} for everyone, and removes it from their inbox. This cannot be undone.`
      } else {
        const gm = messages.find(x => x.id === tok.slice(4))
        const gname = gm ? groupName(gm, classes) : 'this group chat'
        title = 'Delete this group chat?'
        msg = `This permanently deletes "${gname}" for everyone in it, and removes it from their inboxes. This cannot be undone.`
      }
    } else {
      title = `Delete ${tokens.length} conversations?`
      msg = `This permanently removes the selected conversations for everyone, and removes them from the students' inboxes. This cannot be undone.`
    }
    const ok = await openDialog({ title, msg, type: 'danger', confirmLabel: 'Delete', showCancel: true })
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

  // Group chats / broadcasts - every admin announcement is its own thread item.
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

  // Infinite scroll: render a growing window of the inbox as the bottom sentinel
  // scrolls into view (same hook as the Stream feed), replacing pagination.
  const { visibleCount, sentinelRef, hasMore } = useInfiniteFeed(filteredList.length, { resetKey: search })

  function handleSearch(v) {
    setSearch(v)
  }

  // ── Build thread data for panel ───────────────────────────────────
  const baseThread = useMemo(() => {
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
          secure: m.secure,
          quote: m.quote,
          kind: m.kind,
          postRef: m.postRef,
          deleted: m.deleted, deletedBy: m.deletedBy, editedAt: m.editedAt, hiddenFor: m.hiddenFor,
          reactions: m.reactions,
          isMain: true,
          senderLabel: m.from === 'admin' ? 'You' : name,
          studentRead,
          readAtTs: readTime,
          readTitle: studentRead ? 'Read ' + (readTime ? relativeTime(readTime) : '') : 'Delivered',
        })
        ;(m.replies || []).forEach(r => entries.push({
          from: r.from,
          body: r.body,
          ts: r.ts,
          subject: null,
          msgId: m.id,
          kind: r.kind,
          secure: r.secure,
          quote: r.quote,
          postRef: r.postRef,
          deleted: r.deleted, deletedBy: r.deletedBy, editedAt: r.editedAt, hiddenFor: r.hiddenFor,
          reactions: r.reactions,
          isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : name,
          studentRead: false,
          readTitle: 'Delivered',
        }))
      })
      entries.sort((a, b) => a.ts - b.ts)

      // When the student last live-read this conversation: the newest of their
      // recorded read timestamps, plus any of their own bubbles (sending one
      // proves they were present and had seen everything up to that point). Drives
      // the Messenger-style drop of the "Seen" avatar - see seenReceipts.js.
      let peerReadTs = 0
      studentMsgs.forEach(m => { const t = m.readAt?.[sid]; if (t) peerReadTs = Math.max(peerReadTs, t) })
      entries.forEach(e => { if (e.from === sid) peerReadTs = Math.max(peerReadTs, e.ts || 0) })

      return {
        type: 'conversation',
        studentId: sid,
        latestMsgId: studentMsgs.length ? studentMsgs[studentMsgs.length - 1].id : null,
        headerName: name,
        headerSub: studentTag(s, classes) || sid,
        headerPhoto: s?.photo || null,
        isGroup: false,
        peerReadTs,
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
          secure: m.secure,
          quote: m.quote,
          kind: m.kind,
          mentions: m.mentions,
          msgId: m.id,
          deleted: m.deleted, deletedBy: m.deletedBy, editedAt: m.editedAt, hiddenFor: m.hiddenFor,
          reactions: m.reactions,
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
          kind: r.kind,
          secure: r.secure,
          quote: r.quote,
          mentions: r.mentions,
          msgId: m.id,
          deleted: r.deleted, deletedBy: r.deletedBy, editedAt: r.editedAt, hiddenFor: r.hiddenFor,
          reactions: r.reactions,
          isMain: false,
          senderLabel: r.from === 'admin' ? 'You' : peerName(students, r.from),
          studentRead: false,
          readTitle: 'Delivered',
        })),
      ].sort((a, b) => a.ts - b.ts)

      const group = isGroupMessage(m)
      // For a 1:1 broadcast, the recipient's last-read time (newest readAt entry)
      // drives the same Messenger-style "Seen" drop as a conversation thread.
      const readTimes = Object.values(m.readAt || {}).filter(Boolean)
      const peerReadTs = (!group && readTimes.length) ? Math.max(...readTimes) : 0
      return {
        type: 'message',
        msgId: m.id,
        isGroup: group,
        studentId: group ? null : m.to,
        peerReadTs,
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

  // Inject still-in-flight optimistic bubbles for THIS thread (merge, not
  // replace) so a sent bubble paints instantly and never blinks out before its
  // echo lands. Matched/echoed entries are pruned from `pending` by the effect
  // below; failed ones linger so the professor can retry.
  const activeToken = threadTokenOf(activeConv)
  const thread = useMemo(() => {
    if (!baseThread) return null
    const have = new Set((baseThread.entries || []).map(reconcileKey))
    const mine = pending.filter(p => p.threadToken === activeToken && !have.has(reconcileKey(p)))
    if (!mine.length) return baseThread
    return { ...baseThread, entries: [...baseThread.entries, ...mine].sort((a, b) => a.ts - b.ts) }
  }, [baseThread, pending, activeToken])

  // Once an optimistic bubble's real doc arrives in the snapshot, drop it from
  // `pending` (its canonical copy now renders). Failed bubbles never match an
  // echo, so they stay until retried/dismissed.
  useEffect(() => {
    if (!pending.length || !baseThread) return
    const have = new Set((baseThread.entries || []).map(reconcileKey))
    setPending(prev => {
      const next = prev.filter(p => !have.has(reconcileKey(p)))
      return next.length === prev.length ? prev : next
    })
  }, [baseThread]) // eslint-disable-line react-hooks/exhaustive-deps

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
  async function handleReply(text, secure = false, quote = null) {
    if (!thread || !fbReady || !db.current) {
      toast('Firebase not connected.', 'red')
      return
    }
    // Resolve @mentions against this group's members (empty for a 1:1 thread).
    const mentionCandidates = thread.isGroup ? (thread.members || []).map(m => ({ id: m.id, name: m.name })) : []
    const mentionedIds = resolveMentions(text, mentionCandidates)
    const mentions = mentionCandidates.filter(c => mentionedIds.includes(c.id)).map(c => ({ id: c.id, name: c.name }))
    // Single ts shared by the optimistic bubble and the persisted reply so their
    // reconcileKey matches and the echo replaces the pending bubble in place.
    const ts = Date.now()
    const reply = { from: 'admin', body: text, ts, ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}), ...(mentions.length ? { mentions } : {}) }

    // Work out which doc this lands in (and whether it's a fresh top-level doc)
    // so the bubble can paint immediately, before the network round trip.
    const token = threadTokenOf(activeConv)
    let targetDocId, optimisticMain = false
    if (thread.type === 'conversation') {
      const studentMsgs = messages.filter(m => m.from === thread.studentId).sort((a, b) => b.ts - a.ts)
      const targetMsg = studentMsgs[0]
      if (targetMsg) { targetDocId = targetMsg.id }
      else { targetDocId = msgId(); optimisticMain = true } // professor-started: fresh doc
    } else {
      targetDocId = thread.msgId
    }
    const pendKey = (optimisticMain ? 'm:' : 'r:') + targetDocId + ':' + ts + ':admin'
    setPending(prev => [...prev, {
      from: 'admin', body: text, ts, msgId: targetDocId, isMain: optimisticMain,
      ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}), ...(mentions.length ? { mentions } : {}),
      senderLabel: 'You', studentRead: false, readTitle: 'Delivered',
      threadToken: token, status: 'sending',
    }])

    try {
      if (thread.type === 'conversation') {
        // Append to most recent student message - but if the student has never
        // messaged (a professor-started conversation), there's nothing to attach a
        // reply to. Send a fresh direct message doc instead so the reply isn't
        // silently dropped.
        if (optimisticMain) {
          await setDoc(doc(db.current, 'messages', targetDocId), {
            id: targetDocId, from: 'admin', to: thread.studentId, subject: '',
            body: text, ts, read: [], adminRead: true, replies: [], type: 'direct',
            ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}),
          })
        } else {
          await fbAddMessageReply(db.current, targetDocId, reply, { adminRead: true })
        }
        notifyStudentMessage(db.current, thread.studentId, text, undefined, { secure })
      } else {
        const m = messages.find(x => x.id === thread.msgId)
        if (!m) { setPending(prev => prev.filter(p => reconcileKey(p) !== pendKey)); return }
        await fbAddMessageReply(db.current, m.id, reply, { adminRead: true })
        // Notify the recipient(s) of this thread.
        if (m.to === 'all') {
          notifyStudentsBroadcast(db.current, students.map(s => s.id), text, { secure })
        } else if (typeof m.to === 'string' && m.to.startsWith('class:')) {
          const cid = m.to.slice(6)
          const ids = students.filter(s => s.classId === cid || s.classIds?.includes(cid)).map(s => s.id)
          notifyStudentsBroadcast(db.current, ids, text, { secure })
        } else if (typeof m.to === 'string' && m.to.startsWith('subject:')) {
          const ids = studentsInClasses(students, m.classIds).map(s => s.id)
          notifyStudentsBroadcast(db.current, ids, text, { secure })
        } else if (m.to && m.to !== 'admin') {
          notifyStudentMessage(db.current, m.to, text, undefined, { secure })
        }
        // Targeted "mentioned you" ping on top of the group notification.
        mentionedIds.forEach(id => notifyMention(db.current, id, {
          fromName: 'Your professor',
          snippet: secure ? 'Private message' : text,
          link: 'messages',
        }))
      }
    } catch (e) {
      toast('Failed to send reply: ' + e.message, 'red')
      // Mark the optimistic bubble failed so it shows a Retry affordance.
      setPending(prev => prev.map(p => (reconcileKey(p) === pendKey ? { ...p, status: 'failed' } : p)))
    }
  }

  // Retry a failed admin bubble: drop it from pending and resend its text.
  function retryReply(entry) {
    setPending(prev => prev.filter(p => reconcileKey(p) !== reconcileKey(entry)))
    handleReply(entry.body || '', !!entry.secure, entry.quote || null)
  }

  // ── Edit / delete a single bubble ─────────────────────────────────
  function entryTarget(entry) { return entry.isMain ? { main: true } : { ts: entry.ts, from: entry.from } }
  async function handleEditEntry(entry, newText) {
    if (!entry?.msgId || !fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    try { await fbEditMessageEntry(db.current, entry.msgId, entryTarget(entry), newText.trim()) }
    catch (e) { toast('Edit failed: ' + e.message, 'red') }
  }
  async function handleDeleteEntry(entry, mode) {
    if (!entry?.msgId || !fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    if (mode === 'everyone') {
      const ok = await openDialog({
        title: 'Delete for everyone?',
        msg: 'This replaces the message with a "deleted" note for everyone in this chat. This cannot be undone.',
        type: 'danger', confirmLabel: 'Delete', showCancel: true,
      })
      if (!ok) return
    }
    try { await fbDeleteMessageEntry(db.current, entry.msgId, entryTarget(entry), mode, 'admin') }
    catch (e) { toast('Delete failed: ' + e.message, 'red') }
  }
  async function handleToggleReaction(entry, emoji) {
    if (!entry?.msgId || !fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    try { await fbToggleMessageReaction(db.current, entry.msgId, entryTarget(entry), emoji, 'admin') }
    catch (e) { toast('Could not react: ' + e.message, 'red') }
  }

  // ── Render the unified list (direct conversations + group chats) ──────
  function renderListItems() {
    if (!filteredList.length) {
      return (
        <EmptyState
          compact
          tone={search ? 'muted' : 'accent'}
          title={search ? 'No messages match your search.' : 'No messages yet.'}
        />
      )
    }
    return filteredList.slice(0, visibleCount).map(item => {
      if (item.kind === 'conversation') {
        const s = students.find(x => x.id === item.sid)
        const name = s?.name || item.sid
        const lastEntry = (item.allMsgs || []).flatMap(m => [
          { body: m.body || '', ts: m.ts || 0, secure: m.secure, from: m.from, deleted: m.deleted, hiddenFor: m.hiddenFor },
          ...(m.replies || []).map(r => ({ body: r.body || '', ts: r.ts || 0, secure: r.secure, from: r.from, deleted: r.deleted, hiddenFor: r.hiddenFor })),
        ]).filter(e => (e.body || e.deleted) && !(e.hiddenFor || []).includes('admin')).sort((a, b) => b.ts - a.ts)[0] || item.latestMsg
        const preview = (lastEntry.from === 'admin' ? 'You: ' : '') + (lastEntry.deleted ? 'Message deleted' : previewText(lastEntry.body, { secure: lastEntry.secure }))
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
            badge={<VerifiedBadge studentId={item.sid} students={students} size={13} />}
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
      const lastRep = (m.replies || []).reduce((mx, r) => ((r.ts || 0) > (mx?.ts || 0) ? r : mx), null)
      const newestEntry = (lastRep && (lastRep.ts || 0) > (m.ts || 0)) ? lastRep : m
      const newestIsReply = newestEntry !== m
      const preview = newestEntry.deleted
        ? 'Message deleted'
        : newestIsReply
          ? (newestEntry.from === 'admin' ? 'You: ' : ((peerName(students, newestEntry.from).split(',')[0]) + ': ')) + previewText(newestEntry.body, { secure: newestEntry.secure })
          : (m.subject ? m.subject + ' - ' : '') + previewText(m.body, { secure: m.secure })
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
            {hasMore && (
              <div ref={sentinelRef} className="feed-sentinel">
                <span className="feed-spinner" aria-hidden="true" />
                <span>Loading more…</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: thread panel */}
        <div className="msg-thread-pane flex flex-1 min-w-0">
          {thread ? (
            <ThreadPanel
              thread={thread}
              students={students}
              onReply={handleReply}
              onClose={() => setActiveConv(null)}
              onDelete={() => deleteTokens([thread.type === 'conversation' ? 'conv:' + thread.studentId : 'msg:' + thread.msgId])}
              onRename={thread.isGroup ? () => setRenameTargetId(thread.msgId) : null}
              onEditEntry={handleEditEntry}
              onDeleteEntry={handleDeleteEntry}
              onToggleReaction={handleToggleReaction}
              onRetry={retryReply}
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
