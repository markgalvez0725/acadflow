import React, { useState, useRef, useEffect, useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { relativeTime, dayLabel, getInitials, fmtTime as timeLabel } from '@/utils/format'
import { getStudentMessages } from '@/utils/studentMessages'
import { groupName, isGroupMessage, groupMembers } from '@/utils/groupChat'
import ChatMembersModal from '@/components/primitives/ChatMembersModal'
import SeenAvatars from '@/components/primitives/SeenAvatars'
import { anchorMap as seenAnchorMap } from '@/utils/seenReceipts'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { groupFlags, previewText } from '@/utils/messageThread'
import TypingIndicator from '@/components/primitives/TypingIndicator'
import { useTyping } from '@/hooks/useTyping'
import { isClassCurrent } from '@/utils/active'
import { notifyAdminMessage, notifyMention } from '@/firebase/messageNotify'
import { resolveMentions } from '@/utils/mentions'
import MentionInput from '@/components/primitives/MentionInput'
import MessageText from '@/components/primitives/MessageText'
import ProfessorBadge from '@/components/primitives/ProfessorBadge'
import PostRefCard from '@/components/primitives/PostRefCard'
import { fbAddMessageReply, fbMarkMessageRead, fbEditMessageEntry, fbDeleteMessageEntry, fbToggleMessageReaction } from '@/firebase/persistence'
import { ReactionTrigger, ReactionBar, ReactionPills } from '@/components/primitives/MessageReactions'
import { toggleReaction } from '@/utils/reactions'
import useInfiniteFeed from '@/hooks/useInfiniteFeed'
import KebabMenu from '@/components/primitives/KebabMenu'
import SecureBubble from '@/components/primitives/SecureBubble'
import SwipeReply from '@/components/primitives/SwipeReply'
import EmptyState from '@/components/ds/EmptyState'
import { useScreenshotGuard } from '@/hooks/useScreenshotGuard'
import { classifySensitivity, sensitivityLabel } from '@/utils/sensitiveContent'
import { MessageSquare, GraduationCap, CheckCheck, Trash2, Check, Lock, Send, ChevronLeft, Megaphone, Search, SquarePen, Camera, Reply, X, MoreHorizontal, Ban } from 'lucide-react'

// A class/section or subject group chat - professor-owned, students may not delete it.
function isGroupChat(m) {
  return m?.type === 'announcement' && (!!m.classId || (Array.isArray(m.classIds) && m.classIds.length > 0))
}

// Student-side "delete" hides items from this device's inbox only - it must NOT
// delete the shared Firestore docs (announcements/direct threads belong to the
// professor too). Stored per student: { announce: [msgId…], directUpTo: ts }.
// The direct conversation is hidden only up to a timestamp, so any newer message
// or reply brings it back automatically.
// Flatten messages + their replies into ts-sorted bubble entries. Every entry
// carries msgId and the edit/delete fields (deleted/editedAt/hiddenFor) so the
// per-bubble edit + delete actions can locate and render their state.
function toEntries(msgs) {
  const out = []
  ;(msgs || []).forEach(m => {
    out.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, secure: m.secure, quote: m.quote, kind: m.kind, mentions: m.mentions, postRef: m.postRef, isMain: true, msgId: m.id, deleted: m.deleted, deletedBy: m.deletedBy, editedAt: m.editedAt, hiddenFor: m.hiddenFor, reactions: m.reactions })
    ;(m.replies || []).forEach(r => out.push({ ...r, isMain: false, msgId: m.id }))
  })
  return out.sort((a, b) => a.ts - b.ts)
}

// Stable identity for one rendered entry, matched between an optimistic bubble
// and its eventual snapshot echo (same doc id + ts + sender). Used to reconcile
// the two without flashing or duplicating.
function reconcileKey(e) { return (e.isMain ? 'm:' : 'r:') + (e.msgId || '') + ':' + e.ts + ':' + e.from }

// Merge still-in-flight optimistic bubbles into the canonical (snapshot) list.
// A 'sending'/'failed' entry is kept only until its echo appears in `canonical`
// (matched by reconcileKey); once the real doc arrives it wins, so the bubble
// never blinks out and never doubles up. Failed entries linger (no echo ever
// comes) so the user can retry.
function mergePending(canonical, prev) {
  const have = new Set(canonical.map(reconcileKey))
  const pend = (prev || []).filter(e => (e.status === 'sending' || e.status === 'failed') && !have.has(reconcileKey(e)))
  return pend.length ? [...canonical, ...pend].sort((a, b) => a.ts - b.ts) : canonical
}

function hiddenKey(sid) { return `acadflow_hidden_msgs_${sid}` }
function loadHidden(sid) {
  try {
    const o = JSON.parse(localStorage.getItem(hiddenKey(sid)) || '{}')
    return { announce: Array.isArray(o.announce) ? o.announce : [], directUpTo: Number(o.directUpTo) || 0 }
  } catch (e) { return { announce: [], directUpTo: 0 } }
}
function saveHidden(sid, h) { try { localStorage.setItem(hiddenKey(sid), JSON.stringify(h)) } catch (e) {} }

export default function MessagesTab({ student: s, messages }) {
  const { db, fbReady, classes, semester, students, reportScreenshot, admin } = useData()
  const { toast, openDialog, pendingMessageId, clearPendingMessage, pendingMessageDraft, pendingMessagePostRef, clearPendingMessageDraft, openStreamPost } = useUI()

  // The professor's display identity (shown to the student in place of a generic
  // "Professor"/"T"). Falls back to "Professor" until the admin sets a name.
  const profName = (admin?.name || '').trim() || 'Professor'
  const profPhoto = admin?.photo || null

  // A group chat is "open" only while at least one of its classes is still in the
  // current semester. Once the semester/class ends, students can no longer reply.
  function groupChatActive(m) {
    const ids = m.classId ? [m.classId] : (Array.isArray(m.classIds) ? m.classIds : [])
    if (!ids.length) return true // not a class/subject group (e.g. all-students)
    return ids.some(cid => { const c = classes.find(x => x.id === cid); return c && isClassCurrent(c, semester) })
  }

  const [search, setSearch]     = useState('')
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
    // Conversation-specific wording for a single delete; generic for bulk.
    let title, msg
    if (tokens.length === 1) {
      if (tokens[0] === 'direct') {
        title = 'Delete this conversation?'
        msg = `This hides your conversation with ${profName} from your inbox on this device. Your professor keeps their copy, and any new reply brings it back.`
      } else {
        title = 'Delete this chat?'
        msg = 'This hides this chat from your inbox on this device. Any new reply brings it back.'
      }
    } else {
      title = `Delete ${tokens.length} conversations?`
      msg = 'This hides the selected conversations from your inbox on this device. Your professor keeps their copies, and any new reply brings a conversation back.'
    }
    const ok = await openDialog({ title, msg, type: 'danger', confirmLabel: 'Delete', showCancel: true })
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
  // conversation so BOTH the student and the professor see it, and alert the
  // professor's feed. Detection is best-effort - see useScreenshotGuard for why
  // browsers (especially iOS Safari) can't catch every screenshot.
  useScreenshotGuard({
    enabled: view === 'thread',
    onDetect: () => { logScreenshot() },
  })
  const [replyText, setReplyText] = useState('')
  const [sending, setSending]    = useState(false)
  const [editing, setEditing]    = useState(null) // entry key being edited
  const [editDraft, setEditDraft] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [reactKey, setReactKey] = useState(null) // entryKey whose reaction picker is open
  // Quoted reply: the bubble the student swiped / clicked the reply icon on.
  const [replyingTo, setReplyingTo] = useState(null) // { author, text } | null
  // A Stream post attached to the next message (from "Message professor about
  // this post"); rendered as a preview chip above the composer and on the bubble.
  const [attachedPost, setAttachedPost] = useState(null)
  // Draft + post handed off from "Message professor about this post". Held in a
  // ref so the composer-reset effect (keyed on activeKey) APPLIES it instead of
  // wiping it - deterministic, with no setTimeout ordering race.
  const pendingDraftRef = useRef(null)
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
  // Exception: a draft/post handed off from the Stream ("Message professor about
  // this post") is APPLIED here rather than cleared, so it survives the thread
  // switch deterministically (no timing race).
  useEffect(() => {
    setReplyingTo(null); setSecureOn(false); setSecureTouched(false); setEditing(null); setShowMembers(false); setReactKey(null)
    const pend = pendingDraftRef.current
    if (pend) {
      setReplyText(pend.draft || '')
      setAttachedPost(pend.postRef || null)
      pendingDraftRef.current = null
    } else {
      setReplyText(''); setAttachedPost(null)
    }
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
      // message). Without this a professor's latest reply never shows in the list.
      const allEntries = directMsgs.flatMap(m => [
        { body: m.body || '', from: m.from, ts: m.ts || 0, secure: m.secure, deleted: m.deleted, hiddenFor: m.hiddenFor },
        ...(m.replies || []).map(r => ({ body: r.body || '', from: r.from, ts: r.ts || 0, secure: r.secure, deleted: r.deleted, hiddenFor: r.hiddenFor })),
      ]).filter(e => (e.body || e.deleted) && !(e.hiddenFor || []).includes(s.id)).sort((a, b) => b.ts - a.ts)
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

  // Infinite scroll: render a growing window of the inbox as the bottom sentinel
  // scrolls into view (same hook as the Stream feed), replacing pagination.
  const { visibleCount, sentinelRef, hasMore } = useInfiniteFeed(items.length, { resetKey: search })

  // Keep the OPEN thread live: rebuild its entries from the latest messages so a
  // professor's reply (or another group member's) shows without reopening. The
  // professor side already does this via a memo; the student side previously froze
  // the thread to a snapshot taken at open time.
  useEffect(() => {
    if (view !== 'thread' || !activeKey) return
    const src = activeKey === 'direct'
      ? allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
      : (messages.find(x => x.id === activeKey) ? [messages.find(x => x.id === activeKey)] : [])
    // Merge (don't replace) so an optimistic bubble survives until its echo lands.
    setThreadEntries(prev => mergePending(toEntries(src), prev))
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
      // New conversation - open thread with empty, allow compose
      setThreadTitle(profName)
      setThreadEntries([])
      setReplyMsgId(null)
      setCanReply(true)
      setActiveKey('direct')
      setView('thread')
      return
    }
    // Mark the whole conversation read - including the student's own messages
    // that received a professor reply, otherwise their readAt never updates and
    // the unread badge stays lit after reading.
    const teacherMsgIds = directMsgs.map(m => m.id)
    markRead(teacherMsgIds)
    const lastMsg = directMsgs[directMsgs.length - 1]
    setReplyMsgId(lastMsg.id)
    setThreadTitle('Professor')
    setThreadEntries(toEntries(directMsgs))
    setCanReply(true)
    setActiveKey('direct')
    setView('thread')
  }

  function openMessage(msgId) {
    const m = messages.find(x => x.id === msgId)
    if (!m) return
    markRead([msgId])
    setReplyMsgId(msgId)
    setThreadTitle(groupName(m, classes))
    setThreadEntries(toEntries([m]))
    const active = groupChatActive(m)
    setCanReply(active)
    setEndedNotice(active ? '' : 'This class has ended - you can no longer send messages to this group chat.')
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

  // "Ask the professor about this post" from the Stream: open the direct thread
  // with the professor and pre-fill the post reference. The draft + post are
  // stashed in pendingDraftRef and applied by the composer-reset effect when
  // openConversation() flips activeKey - deterministic, no setTimeout race. If
  // the direct thread is already open (activeKey unchanged), apply immediately.
  useEffect(() => {
    if (pendingMessageDraft == null) return
    const draft = pendingMessageDraft
    const postRef = pendingMessagePostRef
    clearPendingMessageDraft()
    const alreadyOpen = view === 'thread' && activeKey === 'direct'
    pendingDraftRef.current = { draft, postRef }
    openConversation()
    if (alreadyOpen) {
      setReplyText(draft)
      setAttachedPost(postRef || null)
      pendingDraftRef.current = null
    }
  }, [pendingMessageDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ping each @mentioned member (in-app notif + best-effort push). Secure drafts
  // never leak their text into the notification.
  function notifyMentioned(ids, text, secure) {
    if (!ids?.length || !fbReady || !db.current) return
    ids.forEach(id => notifyMention(db.current, id, {
      fromName: s.name || s.id,
      snippet: secure ? 'Private message' : text,
      link: 'messages',
    }))
  }

  async function sendReply() {
    const text = replyText.trim()
    if (!text) return
    // Block replies to a group chat whose class/semester has ended.
    if (replyMsgId) {
      const target = messages.find(x => x.id === replyMsgId)
      if (target && !groupChatActive(target)) {
        toast('This class has ended - you can no longer message this group chat.', 'warn'); return
      }
    }
    if (text.length > 2000) { toast('Reply too long - maximum 2000 characters.', 'warn'); return }
    if (!fbReady || !db.current) { toast('Messages require Firebase to be connected.', 'warn'); return }
    const secure = secureOn
    const quote = replyingTo
    const targetMsgId = replyMsgId
    // Resolve @mentions against the group members (empty list in a 1:1 thread,
    // so this is a no-op there). Stored on the message for highlight + notify.
    const mentionedIds = resolveMentions(text, mentionCandidates).filter(id => id !== s.id)
    const mentions = mentionCandidates.filter(c => mentionedIds.includes(c.id)).map(c => ({ id: c.id, name: c.name }))
    const mentionObj = mentions.length ? { mentions } : {}
    const postObj = attachedPost ? { postRef: attachedPost } : {}
    stopTyping()
    setSending(true)
    // Clear the composer optimistically for snappy UX; restored on failure.
    setReplyText(''); setSecureOn(false); setSecureTouched(false); setReplyingTo(null); setAttachedPost(null)
    // Single ts shared by the optimistic bubble and the persisted doc so their
    // reconcileKey matches and the echo replaces the pending bubble in place.
    const ts = Date.now()
    // Pre-compute the optimistic entry's key so we can flip it to 'failed' on error.
    const newDocId = targetMsgId ? null : ('m' + ts + Math.random().toString(36).slice(2, 6))
    const pendKey = targetMsgId
      ? 'r:' + targetMsgId + ':' + ts + ':' + s.id
      : 'm:' + newDocId + ':' + ts + ':' + s.id
    try {
      if (targetMsgId) {
        const newReply = { from: s.id, body: text, ts, ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}), ...mentionObj, ...postObj }
        setThreadEntries(prev => [...prev, { ...newReply, isMain: false, msgId: targetMsgId, status: 'sending' }])
        // Atomic append - won't clobber a professor reply sent at the same time.
        await fbAddMessageReply(db.current, targetMsgId, newReply, { readerId: s.id, adminRead: false })
        // Notify teacher: in-app badge + best-effort web push.
        notifyAdminMessage(db.current, s.name || s.id, text, 'reply', { secure })
        notifyMentioned(mentionedIds, text, secure)
      } else {
        // New message to admin - paint the bubble immediately (optimistic), then write.
        const msg = {
          id: newDocId, from: s.id, to: 'admin',
          subject: 'Message from ' + (s.name || s.id),
          body: text, ts,
          read: [s.id], adminRead: false, replies: [], type: 'direct',
          ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}), ...postObj,
        }
        setThreadEntries(prev => [...prev, { from: s.id, body: text, ts, ...(secure ? { secure: true } : {}), ...(quote ? { quote } : {}), ...postObj, isMain: true, msgId: newDocId, status: 'sending' }])
        await setDoc(doc(db.current, 'messages', newDocId), msg)
        // Anchor the open thread to the new doc so a follow-up message threads as
        // a reply instead of creating another top-level message.
        setReplyMsgId(newDocId)
        // Notify professor of a brand-new conversation (was previously missing).
        notifyAdminMessage(db.current, s.name || s.id, text, 'message', { secure })
      }
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
      setReplyText(text) // restore the draft so it isn't lost
      // Mark the optimistic bubble failed so it shows a Retry affordance.
      setThreadEntries(prev => prev.map(en => (reconcileKey(en) === pendKey ? { ...en, status: 'failed' } : en)))
    } finally {
      setSending(false)
    }
  }

  // Retry a bubble that failed to send: drop the failed marker, refill the
  // composer with its text, and resend on the next tick (once replyText applies).
  function retryFailed(entry) {
    setThreadEntries(prev => prev.filter(e => reconcileKey(e) !== reconcileKey(entry)))
    setReplyText(entry.body || '')
    setTimeout(() => sendReply(), 0)
  }

  // Record a detected screenshot as an in-thread system notice (shown to the
  // student now, and to the professor when they open the thread) plus a professor
  // alert. Only logs inline when a thread doc exists to anchor it to; otherwise
  // it still notifies the professor.
  const lastShotRef = useRef(0)
  async function logScreenshot() {
    const now = Date.now()
    if (now - lastShotRef.current < 2500) return // collapse bursts
    lastShotRef.current = now
    toast('Screenshot detected - your professor has been notified.', 'warn')
    reportScreenshot?.(s, threadTitle)
    if (!fbReady || !db.current || !replyMsgId) return
    const sysEntry = { from: s.id, kind: 'screenshot', body: '', ts: now }
    setThreadEntries(prev => [...prev, { ...sysEntry, isMain: false }])
    try {
      await fbAddMessageReply(db.current, replyMsgId, sysEntry, { readerId: s.id, adminRead: false })
    } catch (e) { /* best-effort - the professor was still notified above */ }
  }

  // ── Edit / delete a single bubble (own bubbles editable; anyone can hide a
  // bubble for themselves; only the author can delete it for everyone) ──────
  function entryTarget(entry) { return entry.isMain ? { main: true } : { ts: entry.ts, from: entry.from } }
  function entryKey(e) { return (e.isMain ? 'm:' : 'r:') + e.msgId + ':' + e.ts + ':' + e.from }
  async function handleEditEntry(entry, newText) {
    const t = (newText || '').trim()
    if (!t || !entry?.msgId || !fbReady || !db.current) return
    setThreadEntries(prev => prev.map(e => (entryKey(e) === entryKey(entry) ? { ...e, body: t, editedAt: Date.now() } : e)))
    try { await fbEditMessageEntry(db.current, entry.msgId, entryTarget(entry), t) }
    catch (e) { toast('Edit failed: ' + e.message, 'error') }
  }
  async function handleDeleteEntry(entry, mode) {
    if (!entry?.msgId || !fbReady || !db.current) { toast('Messages require Firebase.', 'warn'); return }
    if (mode === 'everyone') {
      const ok = await openDialog({
        title: 'Delete for everyone?',
        msg: 'This replaces your message with a "deleted" note for everyone in this chat. This cannot be undone.',
        type: 'danger', confirmLabel: 'Delete', showCancel: true,
      })
      if (!ok) return
    }
    try { await fbDeleteMessageEntry(db.current, entry.msgId, entryTarget(entry), mode, s.id) }
    catch (e) { toast('Delete failed: ' + e.message, 'error') }
  }
  function saveEdit(entry) { const t = editDraft.trim(); setEditing(null); if (t && t !== entry.body) handleEditEntry(entry, t) }

  // Toggle my emoji reaction on a bubble. Optimistic (so the pill updates on tap),
  // then transactional so a near-simultaneous reply can't clobber it.
  async function handleToggleReaction(entry, emoji) {
    if (!entry?.msgId || !fbReady || !db.current) return
    setThreadEntries(prev => prev.map(e => (entryKey(e) === entryKey(entry) ? { ...e, reactions: toggleReaction(e.reactions, emoji, s.id) } : e)))
    try { await fbToggleMessageReaction(db.current, entry.msgId, entryTarget(entry), emoji, s.id) }
    catch (e) { toast('Could not react: ' + e.message, 'error') }
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
  // Who the student can @mention: only in a group chat - the professor plus every
  // classmate in the group (themselves excluded). Empty in a 1:1 thread, so the
  // composer shows no mention popover there.
  const mentionCandidates = useMemo(() => {
    if (!showGroup || !groupMsg) return []
    const out = [{ id: 'admin', name: profName, photo: profPhoto }]
    groupMembers(groupMsg, students).forEach(m => { if (m.id !== s.id) out.push({ id: m.id, name: m.name, photo: m.photo }) })
    return out
  }, [showGroup, groupMsg, students, profName, profPhoto, s.id])
  const headerIsGroup = groupMsg && isGroupChat(groupMsg)
  const threadMemberCount = (showGroup && groupMsg) ? groupMembers(groupMsg, students).length : 0
  const threadSubtitle = showGroup
    ? `Group · ${threadMemberCount} member${threadMemberCount === 1 ? '' : 's'}`
    : (threadEntries[0] ? '' : 'New conversation')
  const groupMembersList = showGroup && groupMsg ? groupMembers(groupMsg, students) : []
  // When the professor last live-read this 1:1: the newest of their recorded reads
  // (adminReadAt) or any message/reply they sent (which proves they were present and
  // had seen everything up to then). Drives the Messenger-style drop of the "Seen"
  // avatar so it never sits under a message they have not actually opened.
  const profReadTs = useMemo(() => {
    if (showGroup) return 0
    let t = 0
    allMsgs.filter(m => m.type !== 'announcement').forEach(m => {
      if (m.adminReadAt) t = Math.max(t, m.adminReadAt)
      if (m.from === 'admin') t = Math.max(t, m.ts || 0)
      ;(m.replies || []).forEach(r => { if (r.from === 'admin') t = Math.max(t, r.ts || 0) })
    })
    return t
  }, [allMsgs, showGroup])
  // Hide bubbles this student deleted "for me"; everyone-deletes stay as tombstones.
  const visibleEntries = useMemo(() => threadEntries.filter(e => !(e.hiddenFor || []).includes(s.id)), [threadEntries, s.id])
  // Readers (and their last-seen time) for the open thread - classmates + professor
  // in a group, just the professor in a 1:1. Each avatar drops under the last of my
  // bubbles they've seen (seenReceipts.js).
  const seenReaders = useMemo(() => {
    if (showGroup && groupMsg) {
      const classmates = groupMembersList.filter(m => m.id !== s.id).map(m => {
        let readTs = (groupMsg.readAt || {})[m.id] || 0
        visibleEntries.forEach(e => { if (e.from === m.id) readTs = Math.max(readTs, e.ts || 0) })
        return { id: m.id, name: m.name, photo: m.photo, readTs }
      }).filter(r => r.readTs > 0)
      if (groupMsg.adminRead) {
        const adminReplyTs = (groupMsg.replies || []).filter(r => r.from === 'admin').reduce((mx, r) => Math.max(mx, r.ts || 0), 0)
        classmates.push({ id: 'admin', name: profName, photo: profPhoto, readTs: groupMsg.adminReadAt || adminReplyTs || groupMsg.ts || 0 })
      }
      return classmates
    }
    return profReadTs ? [{ id: 'admin', name: profName, photo: profPhoto, readTs: profReadTs }] : []
  }, [showGroup, groupMsg, groupMembersList, visibleEntries, profReadTs, profName, profPhoto, s.id])
  const seenMap = useMemo(() => seenAnchorMap(visibleEntries, e => e.from === s.id, seenReaders), [visibleEntries, seenReaders, s.id])
  let lastSelfIdx = -1
  visibleEntries.forEach((e, i) => { if (e.from === s.id && !e.deleted) lastSelfIdx = i })

  function senderInfo(entry) {
    if (entry.from === s.id)    return { self: true,  name: 'You' }
    if (entry.from === 'admin') return { self: false, name: profName, teacher: true, photo: profPhoto }
    const st = students.find(x => x.id === entry.from)
    return { self: false, name: st?.name || 'Member', id: entry.from, photo: st?.photo }
  }

  // Begin a quoted reply to a bubble (from a swipe or the hover reply icon).
  function startReplyTo(entry) {
    const info = senderInfo(entry)
    const author = info.self ? 'You' : (info.name || 'Professor')
    const text = entry.secure ? '🔒 Private message' : (entry.body || '')
    setReplyingTo({ author, text: text.slice(0, 140) })
  }

  // One conversation-list row (shared by both panes' list).
  function renderListItems() {
    if (!items.length) {
      return search ? (
        <EmptyState
          Icon={MessageSquare}
          title="No messages match your search."
          tone="muted"
          compact
        />
      ) : (
        <EmptyState
          Icon={MessageSquare}
          title="No messages yet."
          text="Messages from your professor will appear here."
          compact
        />
      )
    }
    return items.slice(0, visibleCount).map(item => {
      if (item.type === 'direct') {
        const m = item.lastEntry || item.latest
        const isOwn = m.from === s.id
        const preview = (isOwn ? 'You: ' : '') + (m.deleted ? 'Message deleted' : previewText(m.body, { secure: m.secure }))
        const replyHint = item.msgCount > 1
          ? `${item.msgCount} messages · ${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}`
          : item.replyCount ? `${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}` : ''
        const sel = selected.has('direct')
        const active = activeKey === 'direct'
        return (
          <div key="direct" className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}${active ? ' active' : ''}`} onClick={selectMode ? () => toggleSelect('direct') : openConversation} style={{ cursor: 'pointer' }}>
            {selectMode && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
            <div className="s-conv-avatar">{profPhoto ? <img src={profPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : getInitials(profName)}</div>
            <div className="s-conv-body">
              <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}<span className="s-conv-name-text">{profName}</span><ProfessorBadge size={12} /></div>
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
      const newestIsReply = newestEntry !== m
      const preview = newestEntry.deleted
        ? 'Message deleted'
        : newestIsReply
          ? (newestEntry.from === s.id ? 'You: ' : '') + previewText(newestEntry.body, { secure: newestEntry.secure })
          : previewText(m.body, { secure: m.secure })
      const replyCount = (m.replies || []).length
      // Class/subject group chats are professor-owned: students can't delete them.
      const locked = isGroupChat(m)
      const sel = selected.has(m.id)
      const active = activeKey === m.id
      const onItemClick = (selectMode && !locked) ? () => toggleSelect(m.id) : () => openMessage(m.id)
      return (
        <div key={m.id} className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}${active ? ' active' : ''}`} onClick={onItemClick} style={{ cursor: 'pointer' }}>
          {selectMode && !locked && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
          <div className="s-conv-avatar announce">A</div>
          <div className="s-conv-body">
            <div className="s-conv-name">{item.hasUnread && <span className="unread-dot" />}<span className="s-conv-name-text">{groupName(m, classes)}</span></div>
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
            <input aria-label="Search messages" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
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
            {hasMore && (
              <div ref={sentinelRef} className="feed-sentinel">
                <span className="feed-spinner" aria-hidden="true" />
                <span>Loading more…</span>
              </div>
            )}
          </div>
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
                  {showGroup ? <Megaphone size={16} /> : (profPhoto ? <img src={profPhoto} alt="" /> : <GraduationCap size={16} />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-semibold text-ink text-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <span className="truncate">{threadTitle}</span>{!showGroup && <ProfessorBadge size={13} />}
                  </div>
                  {threadSubtitle && <div className="text-xs text-ink2 truncate">{threadSubtitle}</div>}
                </div>
                {showGroup && (
                  <KebabMenu icon={<MoreHorizontal size={18} />} label="Chat actions" items={[
                    { label: 'See chat members', onClick: () => setShowMembers(true) },
                  ]} />
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col" ref={threadRef}>
                {visibleEntries.length === 0 && (
                  <EmptyState Icon={MessageSquare} title="No messages yet. Send the first one!" compact />
                )}
                {visibleEntries.map((entry, i) => {
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
                  const { sameAsPrev, sameAsNext, firstOfGroup, lastOfGroup, showDay } = groupFlags(visibleEntries, i)
                  const eKey = entryKey(entry)
                  const isEditing = editing === eKey
                  const editable = isSelf && !entry.deleted && !entry.postRef && entry.kind !== 'screenshot'
                  const menuItems = entry.deleted ? [] : [
                    { label: 'Reply', onClick: () => startReplyTo(entry) },
                    editable && { label: 'Edit', onClick: () => { setEditing(eKey); setEditDraft(entry.body || '') } },
                    entry.body && !entry.secure && { label: 'Copy', onClick: () => navigator.clipboard?.writeText(entry.body).catch(() => {}) },
                    { label: 'Delete for you', onClick: () => handleDeleteEntry(entry, 'me') },
                    isSelf && { label: 'Delete for everyone', danger: true, onClick: () => handleDeleteEntry(entry, 'everyone') },
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
                      {!isSelf && showGroup && firstOfGroup && (
                        <div className="msg-sender-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {info.name}{info.teacher ? <ProfessorBadge size={12} /> : <VerifiedBadge studentId={info.id} students={students} size={12} />}
                        </div>
                      )}
                      <SwipeReply side={isSelf ? 'sent' : 'received'} onReply={() => startReplyTo(entry)} onLongPress={entry.deleted ? undefined : () => setReactKey(eKey)}>
                        <div className={`msg-bubble-row ${isSelf ? 'sent' : 'received'}`} style={{ marginTop: sameAsPrev ? 2 : 8 }} title={timeLabel(entry.ts)}>
                          {!isSelf && (
                            <div className="msg-avatar-slot">
                              {lastOfGroup && <div className="msg-avatar-sm">{info.teacher ? (info.photo ? <img src={info.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : <GraduationCap size={13} />) : (info.photo ? <img src={info.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : getInitials(info.name))}</div>}
                            </div>
                          )}
                          {isSelf && Actions}
                          {isEditing ? (
                            <div className="msg-edit-box">
                              <textarea
                                autoFocus
                                value={editDraft}
                                maxLength={2000}
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
                            <div className={`msg-bubble ${isSelf ? 'sent' : 'received'} deleted ${lastOfGroup ? 'tail' : ''}`}>
                              <span className="msg-deleted-text"><Ban size={12} /> {entry.deletedBy === s.id ? 'You deleted this message' : 'This message was deleted'}</span>
                            </div>
                          ) : (
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
                              {entry.postRef && (
                                <PostRefCard postRef={entry.postRef} onOpen={() => openStreamPost(entry.postRef)} />
                              )}
                              {entry.secure
                                ? (isSelf
                                    ? <><span className="msg-own-private"><Lock size={10} /> Private</span><div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div></>
                                    : <SecureBubble text={entry.body} />)
                                : <MessageText text={entry.body} mentions={entry.mentions} />}
                              {entry.editedAt && !entry.secure && <span className="msg-edited">edited</span>}
                            </div>
                          )}
                          {!isSelf && Actions}
                        </div>
                      </SwipeReply>
                      {reactOpen && (
                        <ReactionBar
                          side={isSelf ? 'sent' : 'received'}
                          onPick={emoji => { handleToggleReaction(entry, emoji); setReactKey(null) }}
                          onClose={() => setReactKey(null)}
                        />
                      )}
                      {!entry.deleted && (
                        <ReactionPills
                          reactions={entry.reactions}
                          myId={s.id}
                          side={isSelf ? 'sent' : 'received'}
                          onToggle={emoji => handleToggleReaction(entry, emoji)}
                        />
                      )}
                      {/* Read receipts: avatars sit under the last bubble each reader
                          has actually seen, dropping down live as they catch up. */}
                      {!entry.deleted && seenMap.has(i) && (
                        <SeenAvatars
                          people={seenMap.get(i).map(r => ({ id: r.id, name: r.name, photo: r.photo }))}
                          label={showGroup ? 'Seen by' : ('Seen' + (profReadTs ? ' ' + timeLabel(profReadTs) : ''))}
                          onClick={showGroup ? () => setShowMembers(true) : undefined}
                        />
                      )}
                      {/* Send-status / Delivered hint under my newest bubble while unseen. */}
                      {isSelf && i === lastSelfIdx && !entry.deleted && !seenMap.has(i) && (
                        entry.status === 'failed'
                          ? <div className="msg-seen msg-seen-failed" title="Not delivered">Not sent · <button type="button" className="msg-retry-btn" onClick={() => retryFailed(entry)}>Retry</button></div>
                          : entry.status === 'sending'
                            ? <div className="msg-seen" title="Sending">Sending…</div>
                            : showGroup
                              ? <div className="msg-seen" title="Delivered">{seenMap.size ? 'Sent' : 'Sent · seen by 0'}</div>
                              : <div className="msg-seen" title="Delivered">Sent <CheckCheck size={12} /></div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>

              {showMembers && showGroup && groupMsg && (
                <ChatMembersModal
                  members={groupMembers(groupMsg, students)}
                  readerIds={Array.isArray(groupMsg.read) ? groupMsg.read : []}
                  readAt={groupMsg.readAt || {}}
                  onClose={() => setShowMembers(false)}
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
                  {attachedPost && (
                    <div className="msg-attach-banner">
                      <div className="msg-attach-grow"><PostRefCard postRef={attachedPost} onOpen={() => openStreamPost(attachedPost)} /></div>
                      <button className="rb-x" onClick={() => setAttachedPost(null)} aria-label="Remove attached post"><X size={14} /></button>
                    </div>
                  )}
                  {secureOn && (
                    <div className="msg-lock-hint">
                      <Lock size={12} /> {draftFlag.sensitive ? `Private - ${sensitivityLabel(draftFlag.reasons)}. Sent blurred.` : 'Private - sent blurred until tapped.'}
                    </div>
                  )}
                  <div className="msg-reply-bar">
                    <button
                      type="button"
                      className={`msg-lock-btn${secureOn ? ' on' : ''}`}
                      onClick={() => { setSecureTouched(true); setSecureOn(v => !v) }}
                      title={secureOn ? 'Private message - tap to turn off' : 'Send as private (blurred until tapped)'}
                      aria-pressed={secureOn}
                      aria-label="Send as private message"
                    >
                      <Lock size={16} />
                    </button>
                    <div className="msg-reply-pill">
                      <MentionInput
                        multiline
                        className="msg-reply-input"
                        placeholder="Message…"
                        value={replyText}
                        onChange={setReplyText}
                        onType={notifyTyping}
                        onBlur={() => stopTyping()}
                        onEnter={sendReply}
                        candidates={mentionCandidates}
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
