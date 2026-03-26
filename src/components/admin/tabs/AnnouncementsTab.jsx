import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import Badge from '@/components/primitives/Badge'
import { Megaphone, Plus, Trash2, CalendarOff, Video, BookOpen, ToggleLeft, ToggleRight, Link, X, MessageSquare, CornerDownRight, Send } from 'lucide-react'

// ── Comments Section ───────────────────────────────────────────────────
function CommentsSection({ ann, authorId, authorName, role }) {
  const { addAnnouncementComment, addCommentReply } = useData()
  const comments = ann.comments || []

  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState(null) // commentId
  const [replyText, setReplyText] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const replyRef = useRef(null)

  useEffect(() => {
    if (replyTo && replyRef.current) replyRef.current.focus()
  }, [replyTo])

  async function handlePost() {
    if (!text.trim()) return
    setPosting(true)
    try {
      const comment = {
        id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5),
        authorId,
        authorName,
        role,
        text: text.trim(),
        createdAt: Date.now(),
        replies: [],
      }
      await addAnnouncementComment(ann.id, comment)
      setText('')
    } finally {
      setPosting(false)
    }
  }

  async function handleReply(commentId) {
    if (!replyText.trim()) return
    setReplyPosting(true)
    try {
      const reply = {
        id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
        authorId,
        authorName,
        role,
        text: replyText.trim(),
        createdAt: Date.now(),
      }
      await addCommentReply(ann.id, commentId, reply)
      setReplyText('')
      setReplyTo(null)
    } finally {
      setReplyPosting(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={14} />
        Comments {comments.length > 0 && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>({comments.length})</span>}
      </div>

      {/* Comment list */}
      {comments.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 10 }}>No comments yet. Be the first to comment.</div>
      )}
      {comments.map(c => (
        <div key={c.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: c.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              color: c.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
            }}>
              {c.authorName?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{c.authorName}</span>
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>
                  {c.role === 'teacher' ? 'Teacher' : 'Student'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                  {new Date(c.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{c.text}</div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 6px', marginTop: 4, color: 'var(--ink2)' }}
                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
              >
                <CornerDownRight size={11} style={{ marginRight: 3 }} />
                Reply
              </button>
            </div>
          </div>

          {/* Replies */}
          {c.replies?.length > 0 && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {c.replies.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: r.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: r.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {r.authorName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.authorName}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)' }}>
                        {r.role === 'teacher' ? 'Teacher' : 'Student'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                        {new Date(r.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{r.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reply input */}
          {replyTo === c.id && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', gap: 6 }}>
              <input
                ref={replyRef}
                className="form-input"
                style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                placeholder={`Reply to ${c.authorName}…`}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(c.id) } }}
                disabled={replyPosting}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{ padding: '6px 10px', flexShrink: 0 }}
                onClick={() => handleReply(c.id)}
                disabled={replyPosting || !replyText.trim()}
              >
                <Send size={12} />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '6px 8px', flexShrink: 0 }}
                onClick={() => { setReplyTo(null); setReplyText('') }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* New comment input */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input
          className="form-input"
          style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
          placeholder="Write a comment…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }}
          disabled={posting}
        />
        <button
          className="btn btn-primary btn-sm"
          style={{ padding: '7px 12px', flexShrink: 0 }}
          onClick={handlePost}
          disabled={posting || !text.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────
function annId() {
  return 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── New / Edit Announcement Modal ──────────────────────────────────────
function AnnouncementFormModal({ ann, onClose }) {
  const { classes, saveAnnouncement, pushAnnouncementNotifs } = useData()
  const { toast } = useUI()
  const isEdit = !!ann

  const [type,        setType]        = useState(ann?.type        || 'no_class')
  const [classId,     setClassId]     = useState(ann?.classId     || '')
  const [title,       setTitle]       = useState(ann?.title       || '')
  const [message,     setMessage]     = useState(ann?.message     || '')
  const [meetingLink, setMeetingLink] = useState(ann?.meetingLink || '')
  const [moduleLink,  setModuleLink]  = useState(ann?.moduleLink  || '')
  const [topics,      setTopics]      = useState(ann?.topics      || [''])
  const [expiresAt,   setExpiresAt]   = useState(() => {
    if (ann?.expiresAt) {
      const d = new Date(ann.expiresAt)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return ''
  })
  const [err,    setErr]    = useState('')
  const [saving, setSaving] = useState(false)

  // Auto-fill title based on type + class
  const selectedClass = classes.find(c => c.id === classId)
  const autoTitle = useMemo(() => {
    if (!selectedClass) return ''
    if (type === 'no_class') return `No Class Today — ${selectedClass.name}${selectedClass.section ? ` ${selectedClass.section}` : ''}`
    if (type === 'online_class') return `Online Class — ${selectedClass.name}${selectedClass.section ? ` ${selectedClass.section}` : ''}`
    if (type === 'meeting_topics') return `Meeting Topics — ${selectedClass.name}${selectedClass.section ? ` ${selectedClass.section}` : ''}`
    return ''
  }, [type, selectedClass])

  // Fill title when class or type changes, unless manually edited
  const [titleTouched, setTitleTouched] = useState(isEdit)
  function handleClassChange(id) {
    setClassId(id)
    if (!titleTouched) setTitle('')
  }
  function handleTypeChange(t) {
    setType(t)
    if (!titleTouched) setTitle('')
  }

  const displayTitle = titleTouched ? title : (autoTitle || title)

  async function handleSave() {
    setErr('')
    const finalTitle = displayTitle.trim()
    if (!classId)       { setErr('Please select a class.'); return }
    if (!finalTitle)    { setErr('Title is required.'); return }
    if (type === 'online_class' && meetingLink && !meetingLink.startsWith('http')) {
      setErr('Meeting link must start with http:// or https://'); return
    }
    if (moduleLink && !moduleLink.startsWith('http')) {
      setErr('Module link must start with http:// or https://'); return
    }
    if (type === 'meeting_topics') {
      const filled = topics.filter(t => t.trim())
      if (!filled.length) { setErr('Add at least one topic.'); return }
    }

    setSaving(true)
    try {
      const filledTopics = topics.map(t => t.trim()).filter(Boolean)
      const announcement = {
        id:          ann?.id || annId(),
        type,
        classId,
        title:       finalTitle,
        message:     message.trim(),
        meetingLink: type === 'online_class' ? (meetingLink.trim() || null) : null,
        moduleLink:  moduleLink.trim() || null,
        topics:      type === 'meeting_topics' ? filledTopics : null,
        createdAt:   ann?.createdAt || Date.now(),
        active:      ann?.active ?? true,
        expiresAt:   expiresAt ? new Date(expiresAt).getTime() : null,
      }
      await saveAnnouncement(announcement)
      if (!isEdit) {
        await pushAnnouncementNotifs(announcement)
      }
      toast('Announcement ' + (isEdit ? 'updated' : 'posted') + '.', 'success')
      onClose()
    } catch (e) {
      setErr('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Edit Announcement' : 'New Announcement'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 320 }}>
        {/* Class selector */}
        <div>
          <label className="form-label">Class</label>
          <select
            className="form-input"
            value={classId}
            onChange={e => handleClassChange(e.target.value)}
          >
            <option value="">— Select class —</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.section ? ` — ${c.section}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Type radio */}
        <div>
          <label className="form-label">Announcement type</label>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="radio"
                name="ann-type"
                value="no_class"
                checked={type === 'no_class'}
                onChange={() => handleTypeChange('no_class')}
              />
              <CalendarOff size={15} style={{ color: 'var(--yellow)' }} />
              No Class Today
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="radio"
                name="ann-type"
                value="online_class"
                checked={type === 'online_class'}
                onChange={() => handleTypeChange('online_class')}
              />
              <Video size={15} style={{ color: 'var(--accent)' }} />
              Online Class
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="radio"
                name="ann-type"
                value="meeting_topics"
                checked={type === 'meeting_topics'}
                onChange={() => handleTypeChange('meeting_topics')}
              />
              <BookOpen size={15} style={{ color: 'var(--purple, #a855f7)' }} />
              Meeting Topics
            </label>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="form-label">Title</label>
          <input
            className="form-input"
            value={displayTitle}
            placeholder="e.g. No Class Today — BSIT 2A"
            onChange={e => { setTitleTouched(true); setTitle(e.target.value) }}
          />
        </div>

        {/* Message */}
        <div>
          <label className="form-label">Message <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          <textarea
            className="form-input"
            rows={3}
            value={message}
            placeholder="Additional details..."
            onChange={e => setMessage(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Meeting link — only for online_class */}
        {type === 'online_class' && (
          <div>
            <label className="form-label">Meeting link <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="form-input"
              value={meetingLink}
              placeholder="https://meet.google.com/..."
              onChange={e => setMeetingLink(e.target.value)}
            />
          </div>
        )}

        {/* Topics list — only for meeting_topics */}
        {type === 'meeting_topics' && (
          <div>
            <label className="form-label">Topics covered</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topics.map((topic, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink3)', minWidth: 18, textAlign: 'right' }}>{i + 1}.</span>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    value={topic}
                    placeholder={`Topic ${i + 1}`}
                    onChange={e => {
                      const next = [...topics]
                      next[i] = e.target.value
                      setTopics(next)
                    }}
                  />
                  {topics.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 6px', color: 'var(--red)' }}
                      onClick={() => setTopics(topics.filter((_, j) => j !== i))}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 2 }}
                onClick={() => setTopics([...topics, ''])}
              >
                <Plus size={13} style={{ marginRight: 4 }} /> Add topic
              </button>
            </div>
          </div>
        )}

        {/* Module link */}
        <div>
          <label className="form-label">Module link <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="form-input"
            value={moduleLink}
            placeholder="https://drive.google.com/... or any module URL"
            onChange={e => setModuleLink(e.target.value)}
          />
        </div>

        {/* Expiry */}
        <div>
          <label className="form-label">Expires at <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional — leave blank to stay active)</span></label>
          <input
            type="datetime-local"
            className="form-input"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
          />
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Post Announcement'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Read-only Detail Modal ─────────────────────────────────────────────
function AnnouncementDetailModal({ ann, classes, onClose, onEdit }) {
  const { admin } = useData()

  function getClassName(classId) {
    const c = classes.find(x => x.id === classId)
    if (!c) return classId
    return c.name + (c.section ? ` — ${c.section}` : '')
  }

  const typeLabel = ann.type === 'no_class' ? 'No Class Today' : ann.type === 'online_class' ? 'Online Class' : 'Meeting Topics'
  const typeBadge = ann.type === 'no_class' ? 'badge-yellow' : ann.type === 'online_class' ? 'badge-blue' : 'badge-purple'
  const iconColor = ann.type === 'no_class' ? 'var(--yellow)' : ann.type === 'online_class' ? 'var(--accent)' : 'var(--purple, #a855f7)'
  const Icon = ann.type === 'no_class' ? CalendarOff : ann.type === 'online_class' ? Video : BookOpen

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader title={ann.title} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Type + class */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon size={16} style={{ color: iconColor }} />
          <span className={`badge ${typeBadge}`}>{typeLabel}</span>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{getClassName(ann.classId)}</span>
        </div>

        {/* Message */}
        {ann.message && (
          <p style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6, margin: 0 }}>
            {ann.message}
          </p>
        )}

        {/* Topics */}
        {ann.type === 'meeting_topics' && ann.topics?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Topics Covered</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--ink)', lineHeight: 2 }}>
              {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        )}

        {/* Links */}
        {(ann.meetingLink || ann.moduleLink) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ann.meetingLink && (
              <a
                href={ann.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13 }}
              >
                <Video size={14} style={{ marginRight: 6 }} />
                Join Meeting
              </a>
            )}
            {ann.moduleLink && (
              <a
                href={ann.moduleLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13, color: 'var(--green)' }}
              >
                <Link size={14} style={{ marginRight: 6 }} />
                View Module
              </a>
            )}
          </div>
        )}

        {/* Dates */}
        <div style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {ann.createdAt && <span>Posted: {formatDate(ann.createdAt)}</span>}
          {ann.expiresAt && <span>Expires: {formatDate(ann.expiresAt)}</span>}
        </div>

        {/* Comments */}
        <CommentsSection
          ann={ann}
          authorId={admin?.user || 'admin'}
          authorName={admin?.user || 'Teacher'}
          role="teacher"
        />

        {/* Footer action */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onClose(); onEdit(ann) }}>Edit</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
export default function AnnouncementsTab() {
  const { announcements, classes, saveAnnouncement, deleteAnnouncement } = useData()
  const { toast } = useUI()

  const [formOpen, setFormOpen]     = useState(false)
  const [editAnn,  setEditAnn]      = useState(null)
  const [deleteId, setDeleteId]     = useState(null)
  const [viewAnn,  setViewAnn]      = useState(null)

  const sorted = useMemo(() =>
    [...announcements].sort((a, b) => b.createdAt - a.createdAt),
    [announcements]
  )

  function getClassName(classId) {
    const c = classes.find(x => x.id === classId)
    if (!c) return classId
    return c.name + (c.section ? ` — ${c.section}` : '')
  }

  async function handleToggleActive(ann) {
    try {
      await saveAnnouncement({ ...ann, active: !ann.active })
      toast(`Announcement ${!ann.active ? 'activated' : 'deactivated'}.`, 'success')
    } catch (e) {
      toast('Failed to update announcement.', 'error')
    }
  }

  async function handleDelete(id) {
    try {
      await deleteAnnouncement(id)
      toast('Announcement deleted.', 'success')
    } catch (e) {
      toast('Failed to delete announcement.', 'error')
    } finally {
      setDeleteId(null)
    }
  }

  function isExpired(ann) {
    return ann.expiresAt && ann.expiresAt < Date.now()
  }

  return (
    <div>
      {/* Header */}
      <div className="sec-hdr mb-4">
        <div className="sec-title">Announcements</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => { setEditAnn(null); setFormOpen(true) }}
        >
          <Plus size={15} style={{ marginRight: 4 }} />
          New Announcement
        </button>
      </div>

      {/* Empty state */}
      {!sorted.length && (
        <div className="empty">
          <div className="empty-icon"><Megaphone size={40} /></div>
          No announcements yet.<br />
          <span style={{ fontSize: 12 }}>Post a "No Class" or "Online Class" notice to notify students instantly.</span>
        </div>
      )}

      {/* List */}
      {sorted.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(ann => {
            const expired = isExpired(ann)
            const effectivelyActive = ann.active && !expired

            return (
              <div
                key={ann.id}
                className="rounded-xl border border-border bg-surface"
                style={{ padding: '14px 16px', opacity: effectivelyActive ? 1 : 0.6, cursor: 'pointer' }}
                onClick={() => setViewAnn(ann)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: ann.type === 'no_class' ? 'rgba(234,179,8,0.12)' : ann.type === 'online_class' ? 'rgba(59,130,246,0.12)' : 'var(--purple-l)',
                    color: ann.type === 'no_class' ? 'var(--yellow)' : ann.type === 'online_class' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {ann.type === 'no_class' ? <CalendarOff size={18} /> : ann.type === 'online_class' ? <Video size={18} /> : <BookOpen size={18} />}
                  </div>

                  {/* Body */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ann.title}</span>
                      <span className={`badge ${ann.type === 'no_class' ? 'badge-yellow' : ann.type === 'online_class' ? 'badge-blue' : 'badge-purple'}`}>
                        {ann.type === 'no_class' ? 'No Class' : ann.type === 'online_class' ? 'Online Class' : 'Meeting Topics'}
                      </span>
                      {effectivelyActive
                        ? <span className="badge badge-green">Active</span>
                        : expired
                          ? <span className="badge badge-gray">Expired</span>
                          : <span className="badge badge-gray">Inactive</span>
                      }
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
                      {getClassName(ann.classId)}
                    </div>
                    {ann.message && (
                      <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>{ann.message}</div>
                    )}
                    {ann.type === 'meeting_topics' && ann.topics?.length > 0 && (
                      <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.7 }}>
                        {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
                      </ol>
                    )}
                    {ann.meetingLink && (
                      <a
                        href={ann.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, display: 'inline-block' }}
                      >
                        Join Meeting →
                      </a>
                    )}
                    {ann.moduleLink && (
                      <a
                        href={ann.moduleLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: 'var(--green)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Link size={12} /> View Module →
                      </a>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Posted: {formatDate(ann.createdAt)}</span>
                      {ann.expiresAt && <span>Expires: {formatDate(ann.expiresAt)}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {/* Active toggle */}
                    <button
                      className="btn btn-ghost btn-sm"
                      title={ann.active ? 'Deactivate' : 'Activate'}
                      onClick={() => handleToggleActive(ann)}
                      style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {ann.active
                        ? <ToggleRight size={18} style={{ color: 'var(--green)' }} />
                        : <ToggleLeft  size={18} style={{ color: 'var(--ink3)' }} />
                      }
                    </button>

                    {/* Edit */}
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Edit"
                      onClick={() => { setEditAnn(ann); setFormOpen(true) }}
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      Edit
                    </button>

                    {/* Delete */}
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Delete"
                      onClick={() => setDeleteId(ann.id)}
                      style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', color: 'var(--red)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail modal */}
      {viewAnn && (
        <AnnouncementDetailModal
          ann={announcements.find(a => a.id === viewAnn.id) || viewAnn}
          classes={classes}
          onClose={() => setViewAnn(null)}
          onEdit={ann => { setEditAnn(ann); setFormOpen(true) }}
        />
      )}

      {/* New / Edit modal */}
      {formOpen && (
        <AnnouncementFormModal
          ann={editAnn}
          onClose={() => { setFormOpen(false); setEditAnn(null) }}
        />
      )}

      {/* Delete confirm */}
      {deleteId && (
        <Modal onClose={() => setDeleteId(null)} title="Delete Announcement">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 14, color: 'var(--ink2)' }}>
              Are you sure you want to delete this announcement? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
