import React, { useState, useRef, useEffect, useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { relativeTime } from '@/utils/format'
import { getStudentMessages } from '@/utils/studentMessages'
import { notifyAdminMessage } from '@/firebase/messageNotify'
import { fbAddMessageReply, fbMarkMessageRead } from '@/firebase/persistence'
import Pagination from '@/components/primitives/Pagination'
import KebabMenu from '@/components/primitives/KebabMenu'
import { MessageSquare, GraduationCap, CheckCheck, Trash2, Check } from 'lucide-react'

const PER_PAGE = 10

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
  const { db, fbReady, classes, semester } = useData()
  const { toast, openDialog } = useUI()

  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  const [hidden, setHidden]     = useState(() => loadHidden(s.id))
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set()) // tokens: 'direct' or announcement msgId

  // Reload the per-student hidden set when the signed-in student changes.
  useEffect(() => { setHidden(loadHidden(s.id)); setSelectMode(false); setSelected(new Set()) }, [s.id])

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
  const [replyText, setReplyText] = useState('')
  const [sending, setSending]    = useState(false)
  const threadRef = useRef(null)

  // Build conversation items
  const allMsgs = useMemo(() => getStudentMessages(messages, s, classes, semester), [messages, s, classes, semester])

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
      // Newest entry across messages AND replies, so the list preview reflects
      // the most recent line of the conversation (not just the last top-level
      // message). Without this a teacher's latest reply never shows in the list.
      const allEntries = directMsgs.flatMap(m => [
        { body: m.body || '', from: m.from, ts: m.ts || 0 },
        ...(m.replies || []).map(r => ({ body: r.body || '', from: r.from, ts: r.ts || 0 })),
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
    const directMsgs = allMsgs.filter(m => m.type !== 'announcement').sort((a, b) => a.ts - b.ts)
    if (!directMsgs.length) {
      // New conversation — open thread with empty, allow compose
      setThreadTitle('Teacher')
      setThreadEntries([])
      setReplyMsgId(null)
      setCanReply(true)
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
      allEntries.push({ from: m.from, body: m.body, ts: m.ts, subject: m.subject, isMain: true })
      ;(m.replies || []).forEach(r => allEntries.push({ ...r, isMain: false }))
    })
    allEntries.sort((a, b) => a.ts - b.ts)
    setThreadTitle('Teacher')
    setThreadEntries(allEntries)
    setCanReply(true)
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
    setCanReply(true)
    setView('thread')
  }

  async function sendReply() {
    const text = replyText.trim()
    if (!text) return
    if (text.length > 2000) { toast('Reply too long — maximum 2000 characters.', 'warn'); return }
    if (!fbReady || !db.current) { toast('Messages require Firebase to be connected.', 'warn'); return }
    setSending(true)
    try {
      if (replyMsgId) {
        const newReply = { from: s.id, body: text, ts: Date.now() }
        setThreadEntries(prev => [...prev, { ...newReply, isMain: false }])
        setReplyText('')
        // Atomic append — won't clobber a teacher reply sent at the same time.
        await fbAddMessageReply(db.current, replyMsgId, newReply, { readerId: s.id, adminRead: false })
        // Notify teacher: in-app badge + best-effort web push.
        notifyAdminMessage(db.current, s.name || s.id, text, 'reply')
      } else {
        // New message to admin
        const newId = 'm' + Date.now() + Math.random().toString(36).slice(2, 6)
        const msg = {
          id: newId, from: s.id, to: 'admin',
          subject: 'Message from ' + (s.name || s.id),
          body: text, ts: Date.now(),
          read: [s.id], adminRead: false, replies: [], type: 'direct',
        }
        setReplyText('')
        await setDoc(doc(db.current, 'messages', newId), msg)
        // Notify teacher of a brand-new conversation (was previously missing).
        notifyAdminMessage(db.current, s.name || s.id, text, 'message')
      }
    } catch (e) {
      toast('Failed to send: ' + e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  if (view === 'thread') {
    return (
      <div className="student-messages thread-view">
        <div className="s-thread-header">
          <button className="btn btn-ghost btn-sm" onClick={() => setView('list')}>← Back</button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{threadTitle}</div>
            {threadEntries[0] && (
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Started {new Date(threadEntries[0].ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
          </div>
        </div>

        <div className="s-thread-messages" ref={threadRef}>
          {threadEntries.length === 0 && (
            <div className="empty" style={{ padding: 32 }}><div className="empty-icon"><MessageSquare size={40} /></div>No messages yet. Send the first one!</div>
          )}
          {threadEntries.map((entry, i) => {
            const isSelf  = entry.from === s.id
            const name    = isSelf ? 'You' : <><GraduationCap size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />Teacher</>
            const date    = new Date(entry.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            const adminSeen = messages.filter(x => x.from === 'admin' && x.to === s.id).some(x => x.replies?.some(r => r.from === 'admin')) ||
              messages.filter(x => x.from === s.id).some(x => x.adminRead)

            return (
              <React.Fragment key={i}>
                <div className={`msg-bubble-row${isSelf ? ' sent' : ''}`}>
                  <div className={`msg-bubble${isSelf ? ' sent' : ' received'}`}>
                    {entry.isMain && entry.subject && !isSelf && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{entry.subject}</div>
                    )}
                    <div>{entry.body.split('\n').map((l, j) => <React.Fragment key={j}>{l}<br /></React.Fragment>)}</div>
                  </div>
                </div>
                <div className={`msg-meta${isSelf ? ' msg-meta-sent' : ' msg-meta-recv'}`}>
                  {name} · {date}
                  {isSelf && (
                    <span className={`msg-tick${adminSeen ? ' msg-tick-read' : ''}`} title={adminSeen ? 'Read by teacher' : 'Delivered'} style={{ display: 'inline-flex', alignItems: 'center' }}> <CheckCheck size={13} /></span>
                  )}
                </div>
              </React.Fragment>
            )
          })}
        </div>

        {canReply && (
          <div className="s-thread-reply-wrap">
            <textarea
              className="s-reply-input"
              placeholder="Type your reply…"
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
              rows={3}
            />
            <div className="flex gap-2 justify-end mt-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setView('list')}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={sendReply} disabled={sending || !replyText.trim()}>
                {sending ? 'Sending…' : 'Send Reply →'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="student-messages">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Messages</div>
        <button className="btn btn-primary btn-sm" onClick={openConversation}>+ New Message</button>
      </div>

      <input
        className="input mb-3"
        aria-label="Search messages"
        placeholder="Search messages…"
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(1) }}
      />

      {items.length > 0 && (
        <div className="msg-select-bar mb-2">
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

      {!items.length ? (
        <div className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
          <div className="empty">
            <div className="empty-icon"><MessageSquare size={40} /></div>
            {search ? 'No messages match your search.' : <>No messages yet.<br /><span style={{ fontSize: 12 }}>Messages from your teacher will appear here.</span></>}
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
            {slice.map((item, i) => {
              if (item.type === 'direct') {
                const m = item.lastEntry || item.latest
                const isOwn = m.from === s.id
                const body = m.body || ''
                const preview = (isOwn ? 'You: ' : '') + body.slice(0, 60) + (body.length > 60 ? '…' : '')
                const replyHint = item.msgCount > 1
                  ? `${item.msgCount} messages · ${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}`
                  : item.replyCount ? `${item.replyCount} repl${item.replyCount === 1 ? 'y' : 'ies'}` : ''
                const sel = selected.has('direct')
                return (
                  <div key="direct" className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}`} onClick={selectMode ? () => toggleSelect('direct') : openConversation} style={{ cursor: 'pointer' }}>
                    {selectMode && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
                    <div className="s-conv-avatar">T</div>
                    <div className="s-conv-body">
                      <div className="s-conv-name">
                        {item.hasUnread && <span className="unread-dot" />}
                        Teacher
                      </div>
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
              } else {
                const m = item.msg
                const preview = m.body.slice(0, 60) + (m.body.length > 60 ? '…' : '')
                const replyCount = (m.replies || []).length
                const sel = selected.has(m.id)
                return (
                  <div key={m.id} className={`s-msg-thread-item${item.hasUnread ? ' unread' : ''}${sel ? ' selected' : ''}`} onClick={selectMode ? () => toggleSelect(m.id) : () => openMessage(m.id)} style={{ cursor: 'pointer' }}>
                    {selectMode && <span className={`msg-checkbox ${sel ? 'checked' : ''}`} aria-hidden="true">{sel && <Check size={13} />}</span>}
                    <div className="s-conv-avatar announce">A</div>
                    <div className="s-conv-body">
                      <div className="s-conv-name">
                        {item.hasUnread && <span className="unread-dot" />}
                        {m.subject}
                      </div>
                      <div className="s-conv-preview">{preview}</div>
                      {replyCount > 0 && <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</div>}
                    </div>
                    <div className="s-conv-meta">
                      <div className="s-conv-time">{relativeTime(item.lastActivity)}</div>
                      {item.hasUnread && <div className="msg-unread-badge">●</div>}
                    </div>
                    {!selectMode && <KebabMenu items={[{ label: 'Delete', danger: true, onClick: () => deleteSelected([m.id]) }]} />}
                  </div>
                )
              }
            })}
          </div>
          <Pagination total={items.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}
    </div>
  )
}
