import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { MessageSquare, CornerDownRight, Send, X } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import MentionInput from '@/components/primitives/MentionInput'
import { resolveMentions } from '@/utils/mentions'
import { notifyMention, notifyPostFollowers } from '@/firebase/messageNotify'

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
export default function CommentsSection({ ann, authorId, authorName, role, compact = false, previewCount = 0, composerRef = null }) {
  const { addAnnouncementComment, addCommentReply, students = [], db } = useData()
  const comments = ann.comments || []
  const [showAll, setShowAll] = useState(false)
  const collapsed = previewCount > 0 && !showAll && comments.length > previewCount
  const visibleComments = collapsed ? comments.slice(comments.length - previewCount) : comments

  // Who can be @mentioned. A STUDENT may only mention their own classmates
  // (students who share at least one class), never students from other classes,
  // even on an "all classes" announcement. The professor keeps the post's full
  // scope (every student the announcement targets).
  const mentionCandidates = useMemo(() => {
    const list = students || []
    const classIdsOf = x => (x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : []))

    if (role === 'student') {
      const me = list.find(x => x.id === authorId)
      const myClasses = new Set(classIdsOf(me))
      if (!myClasses.size) return []
      return list
        .filter(x => x.id !== authorId)
        .filter(x => classIdsOf(x).some(id => myClasses.has(id)))
        .filter(x => ann.classId === 'all' || classIdsOf(x).includes(ann.classId))
        .map(x => ({ id: x.id, name: x.name || x.id }))
    }

    const scoped = list.filter(x => {
      if (!ann.classId || ann.classId === 'all') return true
      return classIdsOf(x).includes(ann.classId)
    })
    return scoped.map(x => ({ id: x.id, name: x.name || x.id }))
  }, [students, ann.classId, role, authorId])

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

  async function handlePost() {
    if (!text.trim()) return
    setPosting(true)
    try {
      const comment = { id: 'c_' + uuidv4(), authorId, authorName, role, text: text.trim(), createdAt: Date.now(), replies: [] }
      await addAnnouncementComment(ann.id, comment)
      fireMentions(comment.text)
      notifyFollowers(comment.text)
      setText('')
    } finally {
      setPosting(false)
    }
  }

  async function handleReply(commentId) {
    if (!replyText.trim()) return
    setReplyPosting(true)
    try {
      const reply = { id: 'r_' + uuidv4(), authorId, authorName, role, text: replyText.trim(), createdAt: Date.now() }
      await addCommentReply(ann.id, commentId, reply)
      fireMentions(reply.text)
      notifyFollowers(reply.text)
      setReplyText('')
      setReplyTo(null)
    } finally {
      setReplyPosting(false)
    }
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
                const p = c.role === 'student' && students.find(x => x.id === c.authorId)?.photo
                return p
                  ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (c.authorName?.charAt(0)?.toUpperCase() || '?')
              })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{c.authorName}</span>
                <VerifiedBadge studentId={c.authorId} students={students} size={13} />
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{c.role === 'teacher' ? 'Professor' : 'Student'}</span>
                <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                  {new Date(c.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{c.text}</div>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px', marginTop: 4, color: 'var(--ink2)' }} onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
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
                      const p = r.role === 'student' && students.find(x => x.id === r.authorId)?.photo
                      return p
                        ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (r.authorName?.charAt(0)?.toUpperCase() || '?')
                    })()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.authorName}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.role === 'teacher' ? 'Professor' : 'Student'}</span>
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
