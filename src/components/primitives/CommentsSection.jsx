import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { MessageSquare, CornerDownRight, Send, X, MoreHorizontal, Check } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import ProfessorBadge from '@/components/primitives/ProfessorBadge'
import MentionText from '@/components/primitives/MentionText'
import KebabMenu from '@/components/primitives/KebabMenu'
import MentionInput from '@/components/primitives/MentionInput'
import { resolveMentions } from '@/utils/mentions'
import { notifyMention, notifyPostFollowers } from '@/firebase/messageNotify'
import { classIdsOf, annClassIds } from '@/utils/announce'

// Shared comment thread for an announcement, used by BOTH the admin Stream
// (author = professor) and the student Stream (author = the student). It owns
// the compose/reply state and writes through the transactional context helpers
// so concurrent comments never lost-update.
//
// Props:
//   ann        - the announcement object (reads ann.comments / ann.classId)
//   authorId   - id stamped on comments this user posts
//   authorName - display name for this user
//   role       - 'teacher' | 'student'

// Inline editor shown in place of a comment / reply while it is being edited.
function EditRow({ value, onChange, onSave, onCancel, saving, candidates, small = false }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
      <MentionInput className="form-input" style={{ fontSize: small ? 12 : 13, padding: '7px 14px', borderRadius: 999 }} placeholder="Edit comment…" value={value} onChange={onChange} onEnter={onSave} candidates={candidates} disabled={saving} />
      <button type="button" className="ig-send" onClick={onSave} disabled={saving || !value.trim()} aria-label="Save"><Check size={small ? 16 : 19} /></button>
      <button type="button" className="ig-send ig-send--ghost" onClick={onCancel} disabled={saving} aria-label="Cancel"><X size={small ? 15 : 18} /></button>
    </div>
  )
}

export default function CommentsSection({ ann, authorId, authorName, role, compact = false, previewCount = 0, composerRef = null }) {
  const { addAnnouncementComment, addCommentReply, editAnnouncementComment, deleteAnnouncementComment, editCommentReply, deleteCommentReply, students = [], admin, db } = useData()
  const { toast } = useUI()
  const allComments = ann.comments || []

  // On a post shared to several classes, a STUDENT only sees comments from their
  // own classmates (and the professor / their own). The professor sees everything.
  // Each new comment is stamped with its author's classes; legacy comments (no
  // stamp) stay visible to avoid hiding old threads.
  const myClassIds = useMemo(
    () => (role === 'student' ? new Set(classIdsOf(students.find(x => x.id === authorId))) : null),
    [students, authorId, role]
  )
  const comments = useMemo(() => {
    if (role !== 'student') return allComments
    const visible = c =>
      c.authorId === authorId ||
      c.role !== 'student' ||
      !(c.authorClassIds && c.authorClassIds.length) ||
      c.authorClassIds.some(id => myClassIds.has(id))
    return allComments
      .filter(visible)
      .map(c => ({ ...c, replies: (c.replies || []).filter(visible) }))
  }, [allComments, role, authorId, myClassIds])

  const [showAll, setShowAll] = useState(false)
  const collapsed = previewCount > 0 && !showAll && comments.length > previewCount
  const visibleComments = collapsed ? comments.slice(comments.length - previewCount) : comments
  const myAuthorClassIds = () => (role === 'student' ? classIdsOf(students.find(x => x.id === authorId)) : [])

  // Who can be @mentioned. A STUDENT may only mention their own classmates
  // (students who share at least one class), never students from other classes,
  // even on an "all classes" announcement. The professor keeps the post's full
  // scope (every student the announcement targets).
  const mentionCandidates = useMemo(() => {
    const list = students || []
    const targetIds = annClassIds(ann) // [] = broadcast to all classes
    const inScope = x => !targetIds.length || classIdsOf(x).some(id => targetIds.includes(id))

    if (role === 'student') {
      const myClasses = new Set(classIdsOf(list.find(x => x.id === authorId)))
      if (!myClasses.size) return []
      return list
        .filter(x => x.id !== authorId)
        .filter(x => classIdsOf(x).some(id => myClasses.has(id)))
        .filter(inScope)
        .map(x => ({ id: x.id, name: x.name || x.id }))
    }

    return list.filter(inScope).map(x => ({ id: x.id, name: x.name || x.id }))
  }, [students, ann, role, authorId])

  // Names to highlight in posted comments: everyone mentionable PLUS anyone who
  // has actually posted in the thread (so a reply that @tags the professor, who
  // isn't in a student's mention list, still lights up).
  const mentionNames = useMemo(() => {
    const set = new Set(mentionCandidates.map(c => c.name))
    comments.forEach(c => {
      if (c.authorName) set.add(c.authorName)
      ;(c.replies || []).forEach(r => r.authorName && set.add(r.authorName))
    })
    return [...set]
  }, [mentionCandidates, comments])

  function fireMentions(body) {
    const ids = resolveMentions(body, mentionCandidates).filter(id => id && id !== authorId)
    if (!ids.length || !db?.current) return
    ids.forEach(id => notifyMention(db.current, id, { fromName: authorName || 'Someone', snippet: body, link: 'stream' }))
  }

  // Notify followers of the post ("Turn on notifications") on a new comment,
  // skipping the author and anyone already pinged by an @mention above.
  function notifyFollowers(body) {
    const followers = Array.isArray(ann.followers) ? ann.followers : []
    if (!followers.length || !db?.current) return
    const mentioned = new Set(resolveMentions(body, mentionCandidates))
    const targets = followers.filter(id => id && id !== authorId && !mentioned.has(id))
    if (!targets.length) return
    notifyPostFollowers(db.current, targets, { fromName: authorName || 'Someone', postTitle: ann.title, snippet: body })
  }

  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const replyRef = useRef(null)

  useEffect(() => {
    if (replyTo && replyRef.current) replyRef.current.focus()
  }, [replyTo])

  const MAX = 2000

  async function handlePost() {
    if (!text.trim()) return
    if (text.length > MAX) { toast(`Comment too long - maximum ${MAX} characters.`, 'warn'); return }
    setPosting(true)
    try {
      const comment = { id: 'c_' + uuidv4(), authorId, authorName, role, authorClassIds: myAuthorClassIds(), text: text.trim(), createdAt: Date.now(), replies: [] }
      await addAnnouncementComment(ann.id, comment)
      fireMentions(comment.text)
      notifyFollowers(comment.text)
      setText('')
    } catch {
      // The write failed (weak signal, timeout) - the text stays in the box.
      toast('Could not post your comment - check your connection and try again. Your text is kept.', 'error')
    } finally {
      setPosting(false)
    }
  }

  async function handleReply(commentId) {
    if (!replyText.trim()) return
    if (replyText.length > MAX) { toast(`Comment too long - maximum ${MAX} characters.`, 'warn'); return }
    setReplyPosting(true)
    try {
      const reply = { id: 'r_' + uuidv4(), authorId, authorName, role, authorClassIds: myAuthorClassIds(), text: replyText.trim(), createdAt: Date.now() }
      await addCommentReply(ann.id, commentId, reply)
      fireMentions(reply.text)
      notifyFollowers(reply.text)
      setReplyText('')
      setReplyTo(null)
    } catch {
      toast('Could not post your reply - check your connection and try again. Your text is kept.', 'error')
    } finally {
      setReplyPosting(false)
    }
  }

  // Edit / delete own comments + replies (the professor may also delete any, for
  // moderation). `editing` is the entry being edited: { commentId, replyId? }.
  const [editing, setEditing] = useState(null)
  const [editText, setEditText] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const canEdit = e => e.authorId === authorId
  const canDelete = e => e.authorId === authorId || role === 'teacher'

  function startEdit(commentId, replyId, text) { setEditing({ commentId, replyId }); setEditText(text) }
  function cancelEdit() { setEditing(null); setEditText('') }
  async function saveEdit() {
    const text = editText.trim()
    if (!text || !editing) return
    if (text.length > MAX) { toast(`Comment too long - maximum ${MAX} characters.`, 'warn'); return }
    setEditSaving(true)
    try {
      if (editing.replyId) await editCommentReply(ann.id, editing.commentId, editing.replyId, text)
      else await editAnnouncementComment(ann.id, editing.commentId, text)
      cancelEdit()
    } catch {
      toast('Could not save the edit - check your connection and try again.', 'error')
    } finally {
      setEditSaving(false)
    }
  }
  function commentMenu(c) {
    return [
      canEdit(c) && { label: 'Edit', onClick: () => startEdit(c.id, null, c.text) },
      canDelete(c) && { label: 'Delete', danger: true, onClick: () => Promise.resolve(deleteAnnouncementComment(ann.id, c.id)).catch(() => toast('Could not delete - check your connection and try again.', 'error')) },
    ]
  }
  function replyMenu(c, r) {
    return [
      canEdit(r) && { label: 'Edit', onClick: () => startEdit(c.id, r.id, r.text) },
      canDelete(r) && { label: 'Delete', danger: true, onClick: () => Promise.resolve(deleteCommentReply(ann.id, c.id, r.id)).catch(() => toast('Could not delete - check your connection and try again.', 'error')) },
    ]
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: compact ? 10 : 14, marginTop: 4 }}>
      {!compact && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={14} />
          Comments {comments.length > 0 && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>({comments.length})</span>}
        </div>
      )}
      {!compact && comments.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 10 }}>No comments yet.</div>
      )}
      {collapsed && (
        <button className="ig-viewcomments" style={{ marginBottom: 10 }} onClick={() => setShowAll(true)}>
          View all {comments.length} comments
        </button>
      )}
      {visibleComments.map(c => (
        <div key={c.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
              background: c.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              color: c.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
            }}>
              {(() => {
                const p = c.role === 'teacher' ? admin?.photo : students.find(x => x.id === c.authorId)?.photo
                return p
                  ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (c.authorName?.charAt(0)?.toUpperCase() || '?')
              })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{c.authorName}</span>
                {c.role === 'teacher' ? <ProfessorBadge size={13} /> : <VerifiedBadge studentId={c.authorId} students={students} size={13} />}
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{c.role === 'teacher' ? 'Professor' : 'Student'}</span>
                <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                  {new Date(c.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <KebabMenu items={commentMenu(c)} icon={<MoreHorizontal size={14} />} size={14} label="Comment options" />
              </div>
              {editing && editing.commentId === c.id && !editing.replyId ? (
                <EditRow value={editText} onChange={setEditText} onSave={saveEdit} onCancel={cancelEdit} saving={editSaving} candidates={mentionCandidates} />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  <MentionText text={c.text} names={mentionNames} />{c.editedAt && <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 5 }}>(edited)</span>}
                </div>
              )}
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px', marginTop: 4, color: 'var(--ink2)' }} onClick={() => {
                if (replyTo === c.id) { setReplyTo(null); setReplyText('') }
                // Pre-mention the comment's author so the reply is addressed to them.
                else { setReplyTo(c.id); setReplyText(c.authorId === authorId ? '' : `@${c.authorName} `) }
              }}>
                <CornerDownRight size={11} style={{ marginRight: 3 }} /> Reply
              </button>
            </div>
          </div>
          {c.replies?.length > 0 && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {c.replies.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                    background: r.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: r.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {(() => {
                      const p = r.role === 'teacher' ? admin?.photo : students.find(x => x.id === r.authorId)?.photo
                      return p
                        ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (r.authorName?.charAt(0)?.toUpperCase() || '?')
                    })()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.authorName}</span>
                      {r.role === 'teacher' ? <ProfessorBadge size={12} /> : <VerifiedBadge studentId={r.authorId} students={students} size={12} />}
                      <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.role === 'teacher' ? 'Professor' : 'Student'}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                        {new Date(r.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <KebabMenu items={replyMenu(c, r)} icon={<MoreHorizontal size={13} />} size={13} label="Reply options" />
                    </div>
                    {editing && editing.commentId === c.id && editing.replyId === r.id ? (
                      <EditRow value={editText} onChange={setEditText} onSave={saveEdit} onCancel={cancelEdit} saving={editSaving} candidates={mentionCandidates} small />
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        <MentionText text={r.text} names={mentionNames} />{r.editedAt && <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 5 }}>(edited)</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {replyTo === c.id && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', gap: 6 }}>
              <MentionInput inputRef={replyRef} className="form-input" style={{ fontSize: 12, padding: '7px 14px', borderRadius: 999 }} placeholder={`Reply to ${c.authorName}… (@ to mention)`} value={replyText} onChange={setReplyText} onEnter={() => handleReply(c.id)} candidates={mentionCandidates} disabled={replyPosting} />
              <button type="button" className="ig-send" onClick={() => handleReply(c.id)} disabled={replyPosting || !replyText.trim()} aria-label="Post reply"><Send size={19} /></button>
              <button type="button" className="ig-send ig-send--ghost" onClick={() => { setReplyTo(null); setReplyText('') }} aria-label="Cancel reply"><X size={18} /></button>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
        <MentionInput inputRef={composerRef} className="form-input" style={{ fontSize: 13, padding: '9px 16px', borderRadius: 999 }} placeholder="Write a comment… (@ to mention)" value={text} onChange={setText} onEnter={handlePost} candidates={mentionCandidates} disabled={posting} />
        <button type="button" className="ig-send" onClick={handlePost} disabled={posting || !text.trim()} aria-label="Post comment"><Send size={22} /></button>
      </div>
    </div>
  )
}
