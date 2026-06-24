import React, { useState, useRef, useEffect, useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { relativeTime, dayLabel } from '@/utils/format'
import { getStudentMessages } from '@/utils/studentMessages'
import { groupName, isGroupMessage, groupMembers } from '@/utils/groupChat'
import GroupMembers from '@/components/primitives/GroupMembers'
import TypingIndicator from '@/components/primitives/TypingIndicator'
import { useTyping } from '@/hooks/useTyping'
import { isClassCurrent } from '@/utils/active'
import { notifyAdminMessage } from '@/firebase/messageNotify'
import { fbAddMessageReply, fbMarkMessageRead } from '@/firebase/persistence'
import Pagination from '@/components/primitives/Pagination'
import KebabMenu from '@/components/primitives/KebabMenu'
import SecureBubble from '@/components/primitives/SecureBubble'
import SwipeReply from '@/components/primitives/SwipeReply'
import { useScreenshotGuard } from '@/hooks/useScreenshotGuard'
import { classifySensitivity, sensitivityLabel } from '@/utils/sensitiveContent'
import { MessageSquare, GraduationCap, CheckCheck, Trash2, Check, Lock, Send, ChevronLeft, Megaphone, Search, SquarePen, MoreHorizontal, Camera, Reply, X } from 'lucide-react'

const PER_PAGE = 10

function getInitials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// A class/section or subject group chat — teacher-owned, students may not delete it.
function isGroupChat(m) {
  return m?.type === 'announcement' && (!!m.classId || (Array.isArray(m.classIds) && m.classIds.length > 0))
}

// Student-side "delete" hides items from this device's inbox only — it must NOT
// delete the shared Firestore docs (announcements/direct threads belong to the
// teacher too). Stored per student: { announce: [msgId…], directUpTo: ts }.
// The direct conversation is hidden only up to a timestamp, so any newer message
// or reply brings it back automatically.
function hiddenKey(sid) { return `acadflow_hidden_msgs_${sid}` }
function loadHidden(sid) {
  try {
    const o = JSON.parse(localStorage.getItem(hiddenKey(sid)) || '{}')
    return { announce: Array.isArray(o.announce) ? o.announce : [], directUpTo: Number(o.directUpTo) || 0 }
  } catch (e) { return { announce: [], directUpTo: 0 } }
}
function saveHidden(sid, h) { try { localStorage.setItem(hiddenKey(sid), JSON.stringify(h)) } catch (e) {} }

export default function MessagesTab({ student: s, messages }) {
  const { db, fbReady, classes, semester, students, reportScreenshot } = useData()
  const { toast, openDialog, pendingMessageId, clearPendingMessage } = useUI()

  // A group chat is "open" only while at least one of its classes is still in the
  // current semester. Once the semester/class ends, students can no longer reply.
  function groupChatActive(m) {
    const ids = m.classId ? [m.classId] : (Array.isArray(m.classIds) ? m.classIds : [])
    if (!ids.length) return true // not a class/subject group (e.g. all-students)
    return ids.some(cid => { const c = classes.find(x => x.id === cid); return c && isClassCurrent(c, semester) })
  }

  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  const [hidden, setHidden]     = useState(() => loadHidden(s.id))
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set()) // tokens: 'direct' or announcement msgId
  const [activeKey, setActiveKey] = useState(null) // open thread in the right pane: 'direct' | announcement msgId

  // Reload the per-student hidden set when the signed-in student changes.
  useEffect(() => { setHidden(loadHidden(s.id)); setSelectMode(false); setSelected(new Set()); setActiveKey(null); setView('list') }, [s.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function exitSelect() { setSelectMode(false); setSelected(new Set()) }
  function toggleSelect(token) {
    setSelected(prev => { const n = new Set(prev); n.has(token) ? n.delete(token) : n.add(token); return n })
  }

  async function deleteSelected(tokens) {
    if (!tokens.length) return
    const ok = await openDialog({
      title: `Remove ${tokens.length} item${tokens.length > 1 ? 's' : ''}?`,
      msg: 'This hides the selected message(s) from your inbox on this device. Your teacher keeps their copy, and any new reply brings the conversation back.',
      type: 'danger', confirmLabel: 'Delete', showCancel: true,
    })
    if (!ok) return
    const next = { announce: [...hidden.announce], directUpTo: hidden.directUpTo }
    tokens.forEach(tok => {
      if (tok === 'direct') next.directUpTo = Date.now()
      else if (!next.announce.includes(tok)) next.announce.push(tok)
    })
    setHidden(next)
    saveHidden(s.id, next)
    toast(`Removed ${tokens.length} item${tokens.length > 1 ? 's' : ''}.`, 'green')
    exitSelect()
  }
  const [view, setView]         = useState('list') // 'list' | 'thread'
  const [threadTitle, setThreadTitle] = useState('')
  const [threadEntries, setThreadEntries] = useState([])
  const [replyMsgId, setReplyMsgId] = useState(null) // null = new msg to admin
  const [canReply, setCanReply]  = useState(true)
  const [endedNotice, setEndedNotice] = useState('') // shown when a group chat is closed

  // Screenshot log (Instagram / Messenger style): when a capture is detected
  // while a thread is open, drop a "… took a screenshot" notice into the
  // conversation so BOTH the student and the teacher see it, and alert the
  // teacher's feed. Detection is best-effort — see useScreenshotGuard for why
  // browsers (especially iOS Safari) can't catch every screenshot.
  useScreenshotGuard({
    enabled: view === 'thread',
    onDetect: () => { logScreenshot() },
  })
  const [replyText, setReplyText] = useState('')
  const [sending, setSending]    = useState(false)
  // Quoted reply: the bubble the student swiped / clicked the reply icon on.
  const [replyingTo, setReplyingTo] = useState(null) // { author, text } | null
  // Smart-lock: send the draft as a private (blurred) message. The on-device
  // classifier auto-suggests it for sensitive drafts; the student can override.
  const [secureOn, setSecureOn]       = useState(false)
  const [secureTouched, setSecureTouched] = useState(false)
  const draftFlag = useMemo(() => classifySensitivity(replyText), [replyText])
  useEffect(() => {
    if (secureTouched) return
    setSecureOn(draftFlag.sensitive)
  }, [draftFlag, secureTouched])
  // Reset the composer when the open thread changes so a half-typed draft, a
  // pending reply target, or a primed lock never leaks into a different thread.
  useEffect(() => {
    setReplyingTo(null); setReplyText(''); setSecureOn(false); setSecureTouched(false)
  }, [activeKey])
  const threadRef = useRef(null)

  // Build conversation items
  const allMsgs = useMemo(() => getStudentMessages(messages, s, classes, semester), [messages, s, classes, semester])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allMsgs
    return allMsgs.filter(m =>
      m.subject?.toLowerCase().includes(q) ||
      groupName(m, classes).toLowerCase().includes(q) ||
      m.body?.toLowerCase().includes(q) ||
      (m.replies || []).some(r => r.body?.toLowerCase().includes(q))
    )
  }, [allMsgs, search, classes])

  const items = useMemo(() => {
    const announcements = filtered.filter(m => m.type === 'announcement').sort((a, b) => b.ts - a.ts)
    const directMsgs    = filtered.filter(m => m.type !== 'announcement').sort((a, b) => b.ts - a.ts)

    const result = []
    if (directMsgs.length) {
      const latest = directMsgs[0]
      const allReplies = directMsgs.flatMap(m => m.replies || [])
      const lastActivity = allReplies.length ? Math.max(latest.ts, ...allReplies.map(r => r.ts)) : latest.ts
      // Newest entry across messages AND replies, so the list preview reflects
      // the most recent line of the conversation (not just the last top-level
      // message). Without this a teacher's latest reply never shows in the list.
      const allEntries = directMsgs.flatMap(m => [
        { body: m.body || '', from: m.from, ts: m.ts || 0, secure: m.secure },
        ...(m.replies || []).map(r => ({ body: r.body || '', from: r.from, ts: r.ts || 0, secure: r.secure })),
      ]).filter(e => e.body).sort((a, b) => b.ts - a.ts)
      const lastEntry = allEntries[0] || latest
      const hasUnread = directMsgs.some(m => {
        if (m.from === s.id) return false
        const studentRead = Array.isArray(m.read) && m.read.includes(s.id)
        if (!studentRead) return true
        const lastReadAt = m.readAt?.[s.id] || 0
        const lastAdminReply = (m.replies || []).filter(r => r.from === 'admin').reduce((max, r) => Math.max(max, r.ts || 0), 0)
        return lastAdminReply > lastReadAt
      })
      const totalReplies = directMsgs.reduce((a, m) => a + (m.replies || []).length, 0)
      result.push({ type: 'direct', latest, lastEntry, lastActivity, hasUnread, replyCount: totalReplies, msgCount: directMsgs.length })
    }
    announcements.forEach(m => {
      const isRead = Array.isArray(m.read) && m.read.includes(s.id)
      const lastAct = (m.replies || []).length ? Math.max(m.ts, ...(m.replies || []).map(r => r.ts)) : m.ts
      result.push({ type: 'announcement', msg: m, lastActivity: lastAct, hasUnread: !isRead })
    })
    // Drop items the student hid on this device (announcements by id; the direct
    // conversation only while no newer activity has arrived since the hide).
    return result
      .filter(it => it.type === 'announcement'
        ? !hidden.announce.includes(it.msg.id)
        : it.lastActivity > hidden.directUpTo)
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }, [filtered, s.id, hidden])

  const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // Keep the OPEN thread live: rebuild its entries from the latest messages so a
  // teacher's reply (or another group member's) shows without reopening. The
  // teacher side already does this via a memo; the student side previously froze
  // the thread to a snapshot taken at open time.
  useEffect(() => {
    if (view !== 'thread' || !activeKey) return
    const src = activeKey === 'direct'
      ? allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
      : (messages.find(x => x.id === activeKey) ? [messages.find(x => x.id === activeKey)] : [])
    const entries = []
    src.forEach(m => {
      entries.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, secure: m.secure, quote: m.quote, kind: m.kind, isMain: true })
      ;(m.replies || []).forEach(r => entries.push({ ...r, isMain: false }))
    })
    entries.sort((a, b) => a.ts - b.ts)
    setThreadEntries(entries)
  }, [messages, allMsgs, view, activeKey])

  // Scroll thread to bottom when opened
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
    setEndedNotice('')
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
    if (!directMsgs.length) {
      // New conversation — open thread with empty, allow compose
      setThreadTitle('Teacher')
      setThreadEntries([])
      setReplyMsgId(null)
      setCanReply(true)
      setActiveKey('direct')
      setView('thread')
      return
    }
    // Mark the whole conversation read — including the student's own messages
    // that received a teacher reply, otherwise their readAt never updates and
    // the unread badge stays lit after reading.
    const teacherMsgIds = directMsgs.map(m => m.id)
    markRead(teacherMsgIds)
    const lastMsg = directMsgs[directMsgs.length - 1]
    setReplyMsgId(lastMsg.id)
    const allEntries = []
    directMsgs.forEach(m => {
      allEntries.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, secure: m.secure, quote: m.quote, kind: m.kind, isMain: true })
      ;(m.replies || []).forEach(r => allEntries.push({ ...r, isMain: false }))
    })
    allEntries.sort((a, b) => a.ts - b.ts)
    setThreadTitle('Teacher')
    setThreadEntries(allEntries)
    setCanReply(true)
    setActiveKey('direct')
    setView('thread')
  }

  function openMessage(msgId) {
    const m = messages.find(x => x.id === msgId)
    if (!m) return
    markRead([msgId])
    setReplyMsgId(msgId)
    const allEntries = [
      { from: m.from, body: m.body, ts: m.ts, subject: m.subject, secure: m.secure, quote: m.quote, kind: m.kind, isMain: true },
      ...(m.replies || []).map(r => ({ ...r, isMain: false })),
    ].sort((a, b) => a.ts - b.ts)
    setThreadTitle(groupName(m, classes))
    setThreadEntries(allEntries)
    const active = groupChatActive(m)
    setCanReply(active)
    setEndedNotice(active ? '' : 'This class has ended — you can no longer send messages to this group chat.')
    setActiveKey(msgId)
    setView('thread')
  }

  // Deep-link: when a toast (or elsewhere) requests a specific thread, open it
  // once the messages have loaded, then clear the request.
  useEffect(() => {
    if (!pendingMessageId) return
    const m = messages.find(x => x.id === pendingMessageId)
    if (m) { openMessage(pendingMessageId); clearPendingMessage() }
  }, [pendingMessageId, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendReply() {
    const text = replyText.trim()
    if (!text) return
    // Block replies to a group chat whose class/semester has ended.
    if (replyMsgId) {
      const target = messages.find(x => x.id === replyMsgId)
      if (target && !groupChatActive(target)) {
        toast('This class has ended — you can no longer message this group chat.', 'warn'); return
      }
    }
    if (text.length > 2000) { toast('Reply too long — maximum 2000 characters.', 'warn'); return }
    if (!fbReady || !db.current) { toast('Messages require Firebase to be connected.', 'warn'); return }
    const secure = secureOn
    const quote = replyingTo
    const targetMsgId = replyMsgId
    stopTyping()
    setSending(true)
    // Clear the composer optimistically for snappy UX; restored on failure.
    setReplyText(''); setSecureOn(false); setSecureTouched(false); setReplyingTo(null)
    try {
      if (targetMsgId) {
        const newReply = { from: s.id, body: text, ts: Date.now(), ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}) }
        setThreadEntries(prev => [...prev, { ...newReply, isMain: false }])
        // Atomic append — won't clobber a teacher reply sent at the same time.
        await fbAddMessageReply(db.current, targetMsgId, newReply, { readerId: s.id, adminRead: false })
        // Notify teacher: in-app badge + best-effort web push.
        notifyAdminMessage(db.current, s.name || s.id, text, 'reply', { secure })
      } else {
        // New message to admin
        const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
        const msg = {
          id: newId, from: s.id, to: 'admin',
          subject: 'Message from ' + (s.name || s.id),
          body: text, ts: Date.now(),
          read: [s.id], adminRead: false, replies: [], type: 'direct',
          ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}),
        }
        await setDoc(doc(db.current, 'messages', newId), msg)
        // Anchor the open thread to the new doc so a follow-up message threads as
        // a reply instead of creating another top-level message.
        setReplyMsgId(newId)
        // Notify teacher of a brand-new conversation (was previously missing).
        notifyAdminMessage(db.current, s.name || s.id, text, 'message', { secure })
      }
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
      setReplyText(text) // restore the draft so it isn't lost
    } finally {
      setSending(false)
    }
  }

  // Record a detected screenshot as an in-thread system notice (shown to the
  // student now, and to the teacher when they open the thread) plus a teacher
  // alert. Only logs inline when a thread doc exists to anchor it to; otherwise
  // it still notifies the teacher.
  const lastShotRef = useRef(0)
  async function logScreenshot() {
    const now = Date.now()
    if (now - lastShotRef.current < 2500) return // collapse bursts
    lastShotRef.current = now
    toast('Screenshot detected — your teacher has been notified.', 'warn')
    reportScreenshot?.(s, threadTitle)
    if (!fbReady || !db.current || !replyMsgId) return
    const sysEntry = { from: s.id, kind: 'screenshot', body: '', ts: now }
    setThreadEntries(prev => [...prev, { ...sysEntry, isMain: false }])
    try {
      await fbAddMessageReply(db.current, replyMsgId, sysEntry, { readerId: s.id, adminRead: false })
    } catch (e) { /* best-effort — the teacher was still notified above */ }
  }

  // Live typing presence for the open thread (group_ for a group chat, else direct_).
  const openTypingMsg = (view === 'thread' && replyMsgId) ? messages.find(x => x.id === replyMsgId) : null
  const typingKey = view === 'thread'
    ? ((openTypingMsg && isGroupMessage(openTypingMsg)) ? 'group_' + openTypingMsg.id : 'direct_' + s.id)
    : null
  const { typers, notifyTyping, stopTyping } = useTyping(typingKey, { id: s.id, name: s.name || s.id })

  // ── Open thread context (right pane) ───────────────────────────────
  const groupMsg = (view === 'thread' && replyMsgId) ? messages.find(x => x.id === replyMsgId) : null
  const showGroup = groupMsg && isGroupMessage(groupMsg)
  const headerIsGroup = groupMsg && isGroupChat(groupMsg)
  const threadMemberCount = (showGroup && groupMsg) ? groupMembers(groupMsg, students).length : 0
  const threadSubtitle = showGroup
    ? `Group · ${threadMemberCount} member${threadMemberCount === 1 ? '' : 's'}`
    : (threadEntries[0] ? '' : 'New conversation')
  const GROUP_GAP = 5 * 60 * 1000 // 5 min → new visual group
  const timeLabel = ts => new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  const adminSeen = messages.filter(x => x.from === 'admin' && x.to === s.id).some(x => x.replies?.some(r => r.from === 'admin')) ||
    messages.filter(x => x.from === s.id).some(x => x.adminRead)
  let lastSelfIdx = -1
  threadEntries.forEach((e, i) => { if (e.from === s.id) lastSelfIdx = i })

  function senderInfo(entry) {
    if (entry.from === s.id)    return { self: true,  name: 'You' }
    if (entry.from === 'admin') return { self: false, name: 'Teacher', teacher: true }
    const st = students.find(x => x.id === entry.from)
    return { self: false, name: st?.name || 'Member' }
  }

  // Begin a quoted reply to a bubble (from a swipe or the hover reply icon).
  function startReplyTo(entry) {
    const info = senderInfo(entry)
    const author = info.self ? 'You' : (info.name || 'Teacher')
    const text = entry.secure ? '🔒 Private message' : (entry.body || '')
    setReplyingTo({ author, text: text.slice(0, 140) })
  }

  // One conversation-list row (shared by both panes' list).
  function renderListItems() {
    if (!items.length) {
      return (
        <div className="empty" style={{ padding: '28px 18px' }}>
          <div className="empty-icon"><MessageSquare size={36} /></div>
          {search ? 'No messages match your search.' : <>No messages yet.<br /><span style={{ fontSize: 12 }}>Messages from your teacher will appear here.</span></>}
        </div>
      )
    }
    return slice.map(item => {
      if (item.type === 'direct') {
        const m = item.lastEntry || item.latest
        const isOwn = m.from === s.id
        const body = m.body || ''
        const preview = m.secure
          ? (isOwn ? 'You: ' : '') + '🔒 Private message'
          : (isOwn ? 'You: ' : '') + body.slice(0, 60) + (body.length > 60 ? '…' : '')
        const replyHint = item.msgCount > 1
          ? `${item.msgCount} messages · ${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}`
          : item.replyCount ? `${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}` : ''
        const sel = selected.has('direct')
        const active = activeKey === 'direct'
        return (
          <div key="direct" className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}${active ? ' active' : ''}`} onClick={selectMode ? () => toggleSelect('direct') : openConversation} style={{ cursor: 'pointer' }}>
            {selectMode && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
            <div className="s-conv-avatar">T</div>
            <div className="s-conv-body">
              <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}Teacher</div>
              <div className="s-conv-preview">{preview}</div>
              {replyHint && <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{replyHint}</div>}
            </div>
            <div className="s-conv-meta">
              <div className="s-conv-time">{relativeTime(item.lastActivity)}</div>
              {item.hasUnread && <div className="msg-unread-badge">●</div>}
            </div>
            {!selectMode && <KebabMenu items={[{ label: 'Delete', danger: true, onClick: () => deleteSelected(['direct']) }]} />}
          </div>
        )
      }
      const m = item.msg
      const lastRep = (m.replies || []).reduce((mx, r) => ((r.ts || 0) > (mx?.ts || 0) ? r : mx), null)
      const newestEntry = (lastRep && (lastRep.ts || 0) > (m.ts || 0)) ? lastRep : m
      const preview = newestEntry.secure ? '🔒 Private message' : m.body.slice(0, 60) + (m.body.length > 60 ? '…' : '')
      const replyCount = (m.replies || []).length
      // Class/subject group chats are teacher-owned: students can't delete them.
      const locked = isGroupChat(m)
      const sel = selected.has(m.id)
      const active = activeKey === m.id
      const onItemClick = (selectMode && !locked) ? () => toggleSelect(m.id) : () => openMessage(m.id)
      return (
        <div key={m.id} className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}${active ? ' active' : ''}`} onClick={onItemClick} style={{ cursor: 'pointer' }}>
          {selectMode && !locked && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
          <div className="s-conv-avatar announce">A</div>
          <div className="s-conv-body">
            <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}{groupName(m, classes)}</div>
            <div className="s-conv-preview">{preview}</div>
            {replyCount > 0 && <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</div>}
          </div>
          <div className="s-conv-meta">
            <div className="s-conv-time">{relativeTime(item.lastActivity)}</div>
            {item.hasUnread && <div className="msg-unread-badge">●</div>}
          </div>
          {!selectMode && !locked && <KebabMenu items={[{ label: 'Delete', danger: true, onClick: () => deleteSelected([m.id]) }]} />}
        </div>
      )
    })
  }

  return (
    <div className="student-messages flex flex-col msg-fill-height">
      <div className={`msg-shell flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden bg-surface${view === 'thread' ? ' has-active' : ''}`}>

        {/* Left: conversation list */}
        <div className="msg-list-pane flex flex-col border-r border-border" style={{ width: 300, minWidth: 260, flexShrink: 0 }}>
          {/* Pane header: title + compose */}
          <div className="msg-pane-head">
            <span className="msg-pane-title">Messages</span>
            <button className="msg-icon-btn" onClick={openConversation} title="New message" aria-label="New message"><SquarePen size={18} /></button>
          </div>

          {/* Search pill */}
          <div className="msg-search-pill">
            <Search size={15} />
            <input aria-label="Search messages" placeholder="Search" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>

          {items.length > 0 && (
            <div className="msg-select-bar">
              {selectMode ? (
                <>
                  <span className="msg-select-count">{selected.size} selected</span>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={exitSelect}>Cancel</button>
                    <button className="btn btn-danger btn-sm" disabled={!selected.size} onClick={() => deleteSelected([...selected])}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </>
              ) : (
                <button className="msg-select-toggle" onClick={() => setSelectMode(true)}>Select</button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {renderListItems()}
          </div>

          {items.length > PER_PAGE && (
            <div className="flex-shrink-0 border-t border-border">
              <Pagination total={items.length} perPage={PER_PAGE} page={page} onChange={setPage} />
            </div>
          )}
        </div>

        {/* Right: thread pane */}
        <div className="msg-thread-pane flex flex-1 min-w-0">
          {view !== 'thread' ? (
            <div className="flex-1 flex items-center justify-center text-ink3 text-sm">Select a conversation to view messages.</div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 min-w-0">
              {/* Thread header */}
              <div className="msg-thread-head">
                <button className="md:hidden text-ink2" onClick={() => { setView('list'); setActiveKey(null) }} title="Back" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
                  <ChevronLeft size={20} />
                </button>
                <div className={`msg-thread-head-av ${showGroup ? 'announce' : ''}`}>
                  {showGroup ? <Megaphone size={16} /> : <GraduationCap size={16} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-semibold text-ink text-sm truncate">{threadTitle}</div>
                  {threadSubtitle && <div className="text-xs text-ink2 truncate">{threadSubtitle}</div>}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col" ref={threadRef}>
                {threadEntries.length === 0 && (
                  <div className="empty" style={{ padding: 32 }}><div className="empty-icon"><MessageSquare size={40} /></div>No messages yet. Send the first one!</div>
                )}
                {threadEntries.map((entry, i) => {
                  const info = senderInfo(entry)
                  if (entry.kind === 'screenshot') {
                    const who = entry.from === s.id ? 'You' : (info.name || 'Someone')
                    return (
                      <div key={i} className="msg-screenshot-note">
                        <Camera size={13} /> {who} took a screenshot
                      </div>
                    )
                  }
                  const isSelf = info.self
                  const prev = threadEntries[i - 1]
                  const next = threadEntries[i + 1]
                  const sameAsPrev = prev && prev.from === entry.from && (entry.ts - prev.ts) < GROUP_GAP
                  const sameAsNext = next && next.from === entry.from && (next.ts - entry.ts) < GROUP_GAP
                  const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(entry.ts).toDateString()
                  const lastOfGroup = !sameAsNext
                  const firstOfGroup = !sameAsPrev
                  return (
                    <React.Fragment key={i}>
                      {showDay && <div className="msg-day-sep"><span>{dayLabel(entry.ts)}</span></div>}
                      {!isSelf && showGroup && firstOfGroup && <div className="msg-sender-name">{info.name}</div>}
                      <SwipeReply side={isSelf ? 'sent' : 'received'} onReply={() => startReplyTo(entry)}>
                        <div className={`msg-bubble-row ${isSelf ? 'sent' : 'received'}`} style={{ marginTop: sameAsPrev ? 2 : 8 }} title={timeLabel(entry.ts)}>
                          {!isSelf && (
                            <div className="msg-avatar-slot">
                              {lastOfGroup && <div className="msg-avatar-sm">{info.teacher ? <GraduationCap size={13} /> : getInitials(info.name)}</div>}
                            </div>
                          )}
                          <div className={`msg-bubble ${isSelf ? 'sent' : 'received'} ${lastOfGroup ? 'tail' : ''}`}>
                            {entry.isMain && entry.subject && !isSelf && (
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{entry.subject}</div>
                            )}
                            {entry.quote && (
                              <span className="msg-quote">
                                <span className="msg-quote-author">{entry.quote.author}</span>
                                <span className="msg-quote-text">{entry.quote.text}</span>
                              </span>
                            )}
                            {entry.secure
                              ? (isSelf
                                  ? <><span className="msg-own-private"><Lock size={10} /> Private</span><div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div></>
                                  : <SecureBubble text={entry.body} />)
                              : <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>}
                          </div>
                        </div>
                      </SwipeReply>
                      {isSelf && i === lastSelfIdx && (
                        <div className={`msg-seen ${adminSeen ? 'read' : ''}`} title={adminSeen ? 'Read by teacher' : 'Delivered'}>
                          {adminSeen ? 'Seen' : 'Sent'} <CheckCheck size={13} />
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>

              {showGroup && (
                <GroupMembers
                  members={groupMembers(groupMsg, students)}
                  readerIds={Array.isArray(groupMsg.read) ? groupMsg.read : []}
                  readAt={groupMsg.readAt || {}}
                />
              )}

              <TypingIndicator typers={typers} />

              {canReply ? (
                <div>
                  {replyingTo && (
                    <div className="msg-reply-banner">
                      <Reply size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div className="rb-body">
                        <div className="rb-author">Replying to {replyingTo.author}</div>
                        <div className="rb-text">{replyingTo.text}</div>
                      </div>
                      <button className="rb-x" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={14} /></button>
                    </div>
                  )}
                  {secureOn && (
                    <div className="msg-lock-hint">
                      <Lock size={12} /> {draftFlag.sensitive ? `Private — ${sensitivityLabel(draftFlag.reasons)}. Sent blurred.` : 'Private — sent blurred until tapped.'}
                    </div>
                  )}
                  <div className="msg-reply-bar">
                    <button
                      type="button"
                      className={`msg-lock-btn${secureOn ? ' on' : ''}`}
                      onClick={() => { setSecureTouched(true); setSecureOn(v => !v) }}
                      title={secureOn ? 'Private message — tap to turn off' : 'Send as private (blurred until tapped)'}
                      aria-pressed={secureOn}
                      aria-label="Send as private message"
                    >
                      <Lock size={16} />
                    </button>
                    <div className="msg-reply-pill">
                      <textarea
                        className="msg-reply-input"
                        rows={1}
                        placeholder="Message…"
                        value={replyText}
                        onChange={e => { setReplyText(e.target.value); notifyTyping() }}
                        onBlur={() => stopTyping()}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                      />
                    </div>
                    <button className="msg-send-circle" onClick={sendReply} disabled={sending || !replyText.trim()} title="Send">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              ) : endedNotice ? (
                <div className="s-thread-ended"><Lock size={14} /> {endedNotice}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
