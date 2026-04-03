import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { Megaphone, ClipboardList, BookOpen, CalendarCheck, FileQuestion, ChevronDown, ChevronUp, Clock, Users, Award, CheckCircle2, XCircle, AlertCircle, Plus, Trash2, CalendarOff, Video, ToggleLeft, ToggleRight, Link, X, MessageSquare, CornerDownRight, Send, Bold, Italic, Underline, Highlighter, List, ListOrdered } from 'lucide-react'
import DOMPurify from 'dompurify'
import { v4 as uuidv4 } from 'uuid'

function timeAgo(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function TypeIcon({ type }) {
  if (type === 'announcement') return <span style={{ color: '#f59e0b' }}><Megaphone size={16} /></span>
  if (type === 'activity') return <span style={{ color: '#6366f1' }}><ClipboardList size={16} /></span>
  if (type === 'grade') return <span style={{ color: '#10b981' }}><BookOpen size={16} /></span>
  if (type === 'attendance') return <span style={{ color: '#0ea5e9' }}><CalendarCheck size={16} /></span>
  if (type === 'quiz') return <span style={{ color: '#8b5cf6' }}><FileQuestion size={16} /></span>
  return null
}

function TypeBadge({ type }) {
  const map = {
    announcement: { label: 'Announcement', bg: '#fef3c7', color: '#92400e' },
    activity:     { label: 'Activity',     bg: '#ede9fe', color: '#4c1d95' },
    grade:        { label: 'Grade Update', bg: '#d1fae5', color: '#065f46' },
    attendance:   { label: 'Attendance',   bg: '#e0f2fe', color: '#0c4a6e' },
    quiz:         { label: 'Quiz',         bg: '#f3e8ff', color: '#581c87' },
  }
  const { label, bg, color } = map[type] || { label: type, bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {label}
    </span>
  )
}

// ── HTML Sanitization Config ──────────────────────────────────────────
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'mark', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4'],
  ALLOWED_ATTR: [],
  FORCE_BODY: false,
}

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

// ── Rich Text Editor ───────────────────────────────────────────────────
function RichTextEditor({ value, onChange, placeholder, rows = 3 }) {
  const editorRef = useRef(null)
  const isInitialized = useRef(false)

  useEffect(() => {
    if (editorRef.current && !isInitialized.current) {
      editorRef.current.innerHTML = sanitizeHtml(value || '')
      isInitialized.current = true
    }
  }, [])

  function exec(cmd, val = null) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val)
    onChange(sanitizeHtml(editorRef.current.innerHTML))
  }

  function handleInput() {
    onChange(sanitizeHtml(editorRef.current.innerHTML))
  }

  const btnStyle = {
    padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', background: 'var(--bg)' }}>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('bold') }} title="Bold"><Bold size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('italic') }} title="Italic"><Italic size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('underline') }} title="Underline"><Underline size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('hiliteColor', '#fef08a') }} title="Highlight"><Highlighter size={13} /></button>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }} title="Bullet list"><List size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list"><ListOrdered size={13} /></button>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        <select
          style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}
          defaultValue=""
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('formatBlock', e.target.value); e.target.value = '' }}
        >
          <option value="" disabled>Heading</option>
          <option value="h3">Heading 1</option>
          <option value="h4">Heading 2</option>
          <option value="p">Normal</option>
        </select>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        style={{
          minHeight: `${rows * 1.6}em`,
          padding: '10px 12px',
          fontSize: 13,
          color: 'var(--ink)',
          lineHeight: 1.6,
          outline: 'none',
          overflowY: 'auto',
        }}
        className="rich-editor"
      />
    </div>
  )
}

// ── Comments Section ───────────────────────────────────────────────────
function CommentsSection({ ann, authorId, authorName, role }) {
  const { addAnnouncementComment, addCommentReply } = useData()
  const comments = ann.comments || []
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
      const comment = {
        id: 'c_' + uuidv4(),
        authorId, authorName, role,
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
        id: 'r_' + uuidv4(),
        authorId, authorName, role,
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
      {comments.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 10 }}>No comments yet.</div>
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
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{c.role === 'teacher' ? 'Teacher' : 'Student'}</span>
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
                      <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.role === 'teacher' ? 'Teacher' : 'Student'}</span>
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
              <input ref={replyRef} className="form-input" style={{ flex: 1, fontSize: 12, padding: '6px 10px' }} placeholder={`Reply to ${c.authorName}…`} value={replyText} onChange={e => setReplyText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(c.id) } }} disabled={replyPosting} />
              <button className="btn btn-primary btn-sm" style={{ padding: '6px 10px', flexShrink: 0 }} onClick={() => handleReply(c.id)} disabled={replyPosting || !replyText.trim()}><Send size={12} /></button>
              <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px', flexShrink: 0 }} onClick={() => { setReplyTo(null); setReplyText('') }}><X size={12} /></button>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input className="form-input" style={{ flex: 1, fontSize: 13, padding: '7px 10px' }} placeholder="Write a comment…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }} disabled={posting} />
        <button className="btn btn-primary btn-sm" style={{ padding: '7px 12px', flexShrink: 0 }} onClick={handlePost} disabled={posting || !text.trim()}><Send size={14} /></button>
      </div>
    </div>
  )
}

function annId() {
  return 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// ── Announcement Form Modal ────────────────────────────────────────────
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

  const selectedClass = classes.find(c => c.id === classId)
  const autoTitle = useMemo(() => {
    const label = classId === 'all' ? 'All Classes' : selectedClass ? `${selectedClass.name}${selectedClass.section ? ` ${selectedClass.section}` : ''}` : ''
    if (!label) return ''
    if (type === 'no_class') return `No Class Today — ${label}`
    if (type === 'online_class') return `Online Class — ${label}`
    if (type === 'meeting_topics') return `Meeting Topics — ${label}`
    return ''
  }, [type, selectedClass, classId])

  const [titleTouched, setTitleTouched] = useState(isEdit)
  function handleClassChange(id) { setClassId(id); if (!titleTouched) setTitle('') }
  function handleTypeChange(t)   { setType(t);   if (!titleTouched) setTitle('') }

  const displayTitle = titleTouched ? title : (autoTitle || title)

  async function handleSave() {
    setErr('')
    const finalTitle = displayTitle.trim()
    if (!classId)    { setErr('Please select a class.'); return }
    if (!finalTitle) { setErr('Title is required.'); return }
    if (type === 'online_class' && meetingLink && !meetingLink.startsWith('http')) { setErr('Meeting link must start with http:// or https://'); return }
    if (moduleLink && !moduleLink.startsWith('http')) { setErr('Module link must start with http:// or https://'); return }
    if (type === 'meeting_topics') {
      const filled = topics.filter(t => t.trim())
      if (!filled.length) { setErr('Add at least one topic.'); return }
    }
    setSaving(true)
    try {
      const announcement = {
        id:          ann?.id || annId(),
        type,
        classId,
        title:       finalTitle,
        message:     message.trim(),
        meetingLink: type === 'online_class' ? (meetingLink.trim() || null) : null,
        moduleLink:  moduleLink.trim() || null,
        topics:      type === 'meeting_topics' ? topics.map(t => t.trim()).filter(Boolean) : null,
        createdAt:   ann?.createdAt || Date.now(),
        active:      ann?.active ?? true,
        expiresAt:   expiresAt ? new Date(expiresAt).getTime() : null,
        comments:    ann?.comments || [],
      }
      await saveAnnouncement(announcement)
      if (!isEdit) await pushAnnouncementNotifs(announcement)
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
        <div>
          <label className="form-label">Class</label>
          <select className="form-input" value={classId} onChange={e => handleClassChange(e.target.value)}>
            <option value="">— Select class —</option>
            <option value="all">All Classes</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Announcement type</label>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="ann-type" value="no_class" checked={type === 'no_class'} onChange={() => handleTypeChange('no_class')} />
              <CalendarOff size={15} style={{ color: 'var(--yellow)' }} /> No Class Today
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="ann-type" value="online_class" checked={type === 'online_class'} onChange={() => handleTypeChange('online_class')} />
              <Video size={15} style={{ color: 'var(--accent)' }} /> Online Class
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="ann-type" value="meeting_topics" checked={type === 'meeting_topics'} onChange={() => handleTypeChange('meeting_topics')} />
              <BookOpen size={15} style={{ color: 'var(--purple, #a855f7)' }} /> Meeting Topics
            </label>
          </div>
        </div>
        <div>
          <label className="form-label">Title</label>
          <input className="form-input" value={displayTitle} placeholder="e.g. No Class Today — BSIT 2A" onChange={e => { setTitleTouched(true); setTitle(e.target.value) }} />
        </div>
        <div>
          <label className="form-label">Message <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          <RichTextEditor value={message} onChange={setMessage} placeholder="Additional details..." rows={3} />
        </div>
        {type === 'online_class' && (
          <div>
            <label className="form-label">Meeting link <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
            <input className="form-input" value={meetingLink} placeholder="https://meet.google.com/..." onChange={e => setMeetingLink(e.target.value)} />
          </div>
        )}
        {type === 'meeting_topics' && (
          <div>
            <label className="form-label">Topics covered</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topics.map((topic, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink3)', minWidth: 18, textAlign: 'right' }}>{i + 1}.</span>
                  <input className="form-input" style={{ flex: 1 }} value={topic} placeholder={`Topic ${i + 1}`} onChange={e => { const next = [...topics]; next[i] = e.target.value; setTopics(next) }} />
                  {topics.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '4px 6px', color: 'var(--red)' }} onClick={() => setTopics(topics.filter((_, j) => j !== i))}><X size={13} /></button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 2 }} onClick={() => setTopics([...topics, ''])}>
                <Plus size={13} style={{ marginRight: 4 }} /> Add topic
              </button>
            </div>
          </div>
        )}
        <div>
          <label className="form-label">Module link <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          <input className="form-input" value={moduleLink} placeholder="https://drive.google.com/..." onChange={e => setModuleLink(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Expires at <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          <input type="datetime-local" className="form-input" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Update' : 'Post Announcement'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Announcement Detail Modal ──────────────────────────────────────────
function AnnouncementDetailModal({ ann, classes, onClose, onEdit }) {
  const { admin } = useData()

  function getClassName(classId) {
    if (classId === 'all') return 'All Classes'
    const c = classes.find(x => x.id === classId)
    return c ? c.name + (c.section ? ` — ${c.section}` : '') : classId
  }

  const typeLabel = ann.type === 'no_class' ? 'No Class Today' : ann.type === 'online_class' ? 'Online Class' : 'Meeting Topics'
  const typeBadge = ann.type === 'no_class' ? 'badge-yellow' : ann.type === 'online_class' ? 'badge-blue' : 'badge-purple'
  const iconColor = ann.type === 'no_class' ? 'var(--yellow)' : ann.type === 'online_class' ? 'var(--accent)' : 'var(--purple, #a855f7)'
  const Icon = ann.type === 'no_class' ? CalendarOff : ann.type === 'online_class' ? Video : BookOpen

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader title={ann.title} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon size={16} style={{ color: iconColor }} />
          <span className={`badge ${typeBadge}`}>{typeLabel}</span>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{getClassName(ann.classId)}</span>
        </div>
        {ann.message && <div className="ann-message" dangerouslySetInnerHTML={{ __html: sanitizeHtml(ann.message) }} />}
        {ann.type === 'meeting_topics' && ann.topics?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Topics Covered</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--ink)', lineHeight: 2 }}>
              {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        )}
        {(ann.meetingLink || ann.moduleLink) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ann.meetingLink && (
              <a href={ann.meetingLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13 }}>
                <Video size={14} style={{ marginRight: 6 }} /> Join Meeting
              </a>
            )}
            {ann.moduleLink && (
              <a href={ann.moduleLink} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13, color: 'var(--green)' }}>
                <Link size={14} style={{ marginRight: 6 }} /> View Module
              </a>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {ann.createdAt && <span>Posted: {formatDate(ann.createdAt)}</span>}
          {ann.expiresAt && <span>Expires: {formatDate(ann.expiresAt)}</span>}
        </div>
        <CommentsSection ann={ann} authorId={admin?.user || 'admin'} authorName={admin?.user || 'Teacher'} role="teacher" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onClose(); onEdit(ann) }}>Edit</button>
        </div>
      </div>
    </Modal>
  )
}

function AnnouncementCard({ item, classObj }) {
  const ann = item.data
  const [expanded, setExpanded] = useState(false)
  const hasMessage = ann.message && ann.message !== '<p></p>' && ann.message !== ''
  const commentCount = (ann.comments || []).length

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="announcement" />
          <TypeBadge type="announcement" />
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(ann.createdAt)}</span>
      </div>
      <div className="stream-card-title">{ann.title}</div>
      {hasMessage && (
        <div
          style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(ann.message) }}
        />
      )}
      {ann.meetingLink && (
        <a href={ann.meetingLink} target="_blank" rel="noreferrer" className="stream-link-chip">
          <Video size={12} /> Join Meeting
        </a>
      )}
      {ann.moduleLink && (
        <a href={ann.moduleLink} target="_blank" rel="noreferrer" className="stream-link-chip">
          <BookOpen size={12} /> Module Link
        </a>
      )}
      {ann.topics?.length > 0 && (
        <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
          {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
        {commentCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

function ActivityCard({ item, classObj, students }) {
  const act = item.data
  const totalRubric = (act.rubric || []).reduce((s, r) => s + (r.points || 0), 0)
  const subCount = Object.keys(act.submissions || {}).length
  const gradedCount = Object.values(act.submissions || {}).filter(s => s.score != null).length
  const classStudents = students.filter(s => {
    const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    return ids.includes(act.classId)
  })
  const totalStudents = classStudents.length
  const notSubmitted = totalStudents - subCount

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="activity" />
          <TypeBadge type="activity" />
          {act.subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{act.subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(act.createdAt)}</span>
      </div>
      <div className="stream-card-title">{act.title}</div>
      {act.deadline && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}
          {Date.now() > act.deadline && <span style={{ color: '#ef4444', fontWeight: 600 }}>· Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{subCount} submitted</span>
        </div>
        <div className="stream-stat">
          <Award size={14} style={{ color: '#6366f1' }} />
          <span>{gradedCount} graded</span>
        </div>
        <div className="stream-stat">
          <AlertCircle size={14} style={{ color: '#f59e0b' }} />
          <span>{notSubmitted} pending</span>
        </div>
        {totalRubric > 0 && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink3)' }}>{totalRubric} pts total</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function QuizCard({ item, classObj, students }) {
  const quiz = item.data
  const now = Date.now()
  const isOpen = now >= quiz.openAt && now <= quiz.closeAt
  const isClosed = now > quiz.closeAt
  const totalQ = (quiz.questions || []).length
  const subCount = Object.keys(quiz.submissions || {}).length
  const scores = Object.values(quiz.submissions || {}).map(s => s.score).filter(s => s != null)
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="quiz" />
          <TypeBadge type="quiz" />
          {isOpen && <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>OPEN</span>}
          {isClosed && <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>CLOSED</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(quiz.openAt)}</span>
      </div>
      <div className="stream-card-title">{quiz.title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4, display: 'flex', gap: 16 }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <FileQuestion size={14} style={{ color: '#8b5cf6' }} />
          <span>{totalQ} question{totalQ !== 1 ? 's' : ''}</span>
        </div>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{subCount} taken</span>
        </div>
        {avgScore != null && (
          <div className="stream-stat">
            <Award size={14} style={{ color: '#f59e0b' }} />
            <span>Avg: {avgScore}%</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function GradeCard({ item, classObj }) {
  const { studentName, subject, gradeData, uploadedAt } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="grade" />
          <TypeBadge type="grade" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(uploadedAt)}</span>
      </div>
      <div className="stream-card-title">{studentName}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink2)' }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>
          </div>
        )}
        {gradeData.finals != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink2)' }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>
          </div>
        )}
        {gradeData.finalGrade != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function AttendanceCard({ item, classObj }) {
  const { subject, date, presentCount, absentCount, excusedCount } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="attendance" />
          <TypeBadge type="attendance" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{date}</span>
      </div>
      <div className="stream-card-title">Attendance — {date}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{presentCount} present</span>
        </div>
        <div className="stream-stat">
          <XCircle size={14} style={{ color: '#ef4444' }} />
          <span>{absentCount} absent</span>
        </div>
        {excusedCount > 0 && (
          <div className="stream-stat">
            <AlertCircle size={14} style={{ color: '#f59e0b' }} />
            <span>{excusedCount} excused</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

export default function StreamTab() {
  const { classes, students, activities, quizzes, announcements, saveAnnouncement, deleteAnnouncement } = useData()
  const { toast } = useUI()
  const [filterClass, setFilterClass] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editAnn,  setEditAnn]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [viewAnn,  setViewAnn]  = useState(null)

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  // Build stream items from all data sources
  const streamItems = useMemo(() => {
    const items = []

    // Announcements
    announcements.forEach(ann => {
      if (filterClass !== 'all' && ann.classId !== 'all' && ann.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'announcement') return
      items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: ann.classId })
    })

    // Activities
    activities.forEach(act => {
      if (filterClass !== 'all' && act.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'activity') return
      items.push({ id: `act-${act.id}`, type: 'activity', ts: act.createdAt || 0, data: act, classId: act.classId })
    })

    // Quizzes
    quizzes.forEach(quiz => {
      if (filterType !== 'all' && filterType !== 'quiz') return
      const matchesClass = filterClass === 'all' || (quiz.classIds || []).includes(filterClass)
      if (!matchesClass) return
      items.push({ id: `quiz-${quiz.id}`, type: 'quiz', ts: quiz.openAt || 0, data: quiz, classId: quiz.classIds?.[0] })
    })

    // Grades — one card per student+subject grade upload
    students.forEach(stu => {
      const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
      if (filterClass !== 'all' && !classIds.includes(filterClass)) return
      if (filterType !== 'all' && filterType !== 'grade') return

      const gc = stu.gradeComponents || {}
      const uploadedAts = stu.gradeUploadedAt || {}
      const seenSubjects = new Set()

      classIds.forEach(cid => {
        if (filterClass !== 'all' && cid !== filterClass) return
        const cls = classes.find(c => c.id === cid)
        if (!cls) return
        ;(cls.subjects || []).forEach(subj => {
          if (seenSubjects.has(subj)) return
          const gradeData = gc[subj]
          const uploadedAt = uploadedAts[subj]
          if (!gradeData && !uploadedAt) return
          seenSubjects.add(subj)
          items.push({
            id: `grade-${stu.id}-${subj}`,
            type: 'grade',
            ts: uploadedAt || 0,
            classId: cid,
            data: {
              studentName: stu.name,
              subject: subj,
              gradeData: gradeData || {},
              uploadedAt,
            },
          })
        })
      })
    })

    // Attendance — derive unique session dates per class+subject
    if (filterType === 'all' || filterType === 'attendance') {
      const attMap = {}
      students.forEach(stu => {
        const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
        if (filterClass !== 'all' && !classIds.includes(filterClass)) return

        classIds.forEach(cid => {
          if (filterClass !== 'all' && cid !== filterClass) return
          const cls = classes.find(c => c.id === cid)
          if (!cls) return
          ;(cls.subjects || []).forEach(subj => {
            const attDates = stu.attendance?.[subj] || new Set()
            attDates.forEach(date => {
              const key = `${cid}|${subj}|${date}`
              if (!attMap[key]) {
                attMap[key] = { classId: cid, subject: subj, date, present: 0, absent: 0, excused: 0, allClassStudents: [] }
              }
            })
          })
        })
      })

      // Count present/absent per session
      students.forEach(stu => {
        const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
        classIds.forEach(cid => {
          const cls = classes.find(c => c.id === cid)
          if (!cls) return
          ;(cls.subjects || []).forEach(subj => {
            Object.keys(attMap).filter(k => k.startsWith(`${cid}|${subj}|`)).forEach(key => {
              const dateStr = key.split('|')[2]
              const present = (stu.attendance?.[subj] instanceof Set ? stu.attendance[subj] : new Set(stu.attendance?.[subj] || [])).has(dateStr)
              const excused = (stu.excuse?.[subj] instanceof Set ? stu.excuse[subj] : new Set(stu.excuse?.[subj] || [])).has(dateStr)
              if (present) attMap[key].present++
              else if (excused) attMap[key].excused++
              else attMap[key].absent++
            })
          })
        })
      })

      Object.entries(attMap).forEach(([key, val]) => {
        const dateMs = new Date(val.date).getTime()
        items.push({
          id: `att-${key}`,
          type: 'attendance',
          ts: isNaN(dateMs) ? 0 : dateMs,
          classId: val.classId,
          data: {
            subject: val.subject,
            date: val.date,
            presentCount: val.present,
            absentCount: val.absent,
            excusedCount: val.excused,
          },
        })
      })
    }

    return items.sort((a, b) => b.ts - a.ts)
  }, [classes, students, activities, quizzes, announcements, filterClass, filterType])

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  function getClassName(classId) {
    if (classId === 'all') return 'All Classes'
    const c = classes.find(x => x.id === classId)
    return c ? c.name + (c.section ? ` — ${c.section}` : '') : classId
  }

  function isExpired(ann) {
    return ann.expiresAt && ann.expiresAt < Date.now()
  }

  async function handleToggleActive(ann) {
    try {
      await saveAnnouncement({ ...ann, active: !ann.active })
      toast(`Announcement ${!ann.active ? 'activated' : 'deactivated'}.`, 'success')
    } catch {
      toast('Failed to update announcement.', 'error')
    }
  }

  async function handleDelete(id) {
    try {
      await deleteAnnouncement(id)
      toast('Announcement deleted.', 'success')
    } catch {
      toast('Failed to delete announcement.', 'error')
    } finally {
      setDeleteId(null)
    }
  }

  const sortedAnnouncements = useMemo(() =>
    [...announcements].sort((a, b) => b.createdAt - a.createdAt),
    [announcements]
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 32 }}>
      {/* Announcements section */}
      <div className="sec-hdr mb-4">
        <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Megaphone size={18} /> Announcements
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditAnn(null); setFormOpen(true) }}>
          <Plus size={15} style={{ marginRight: 4 }} /> New Announcement
        </button>
      </div>

      {sortedAnnouncements.length === 0 && (
        <div className="empty" style={{ marginBottom: 24 }}>
          <div className="empty-icon"><Megaphone size={32} /></div>
          No announcements yet. Post a notice to notify students.
        </div>
      )}

      {sortedAnnouncements.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {sortedAnnouncements.map(ann => {
            const expired = isExpired(ann)
            const effectivelyActive = ann.active && !expired
            return (
              <div key={ann.id} className="rounded-xl border border-border bg-surface" style={{ padding: '14px 16px', opacity: effectivelyActive ? 1 : 0.6, cursor: 'pointer' }} onClick={() => setViewAnn(ann)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: ann.type === 'no_class' ? 'rgba(234,179,8,0.12)' : ann.type === 'online_class' ? 'rgba(59,130,246,0.12)' : 'var(--purple-l)',
                    color: ann.type === 'no_class' ? 'var(--yellow)' : ann.type === 'online_class' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {ann.type === 'no_class' ? <CalendarOff size={18} /> : ann.type === 'online_class' ? <Video size={18} /> : <BookOpen size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ann.title}</span>
                      <span className={`badge ${ann.type === 'no_class' ? 'badge-yellow' : ann.type === 'online_class' ? 'badge-blue' : 'badge-purple'}`}>
                        {ann.type === 'no_class' ? 'No Class' : ann.type === 'online_class' ? 'Online Class' : 'Meeting Topics'}
                      </span>
                      {effectivelyActive ? <span className="badge badge-green">Active</span> : expired ? <span className="badge badge-gray">Expired</span> : <span className="badge badge-gray">Inactive</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{getClassName(ann.classId)}</div>
                    {ann.message && <div className="ann-message ann-message--preview" style={{ fontSize: 13, marginTop: 4 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(ann.message) }} />}
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>Posted: {formatDate(ann.createdAt)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" title={ann.active ? 'Deactivate' : 'Activate'} onClick={() => handleToggleActive(ann)} style={{ padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                      {ann.active ? <ToggleRight size={18} style={{ color: 'var(--green)' }} /> : <ToggleLeft size={18} style={{ color: 'var(--ink3)' }} />}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditAnn(ann); setFormOpen(true) }} style={{ padding: '4px 8px', fontSize: 12 }}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDeleteId(ann.id)} style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', color: 'var(--red)' }}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 20 }} />

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 160, maxWidth: 260, fontSize: 13 }}
          value={filterClass}
          onChange={e => setFilterClass(e.target.value)}
        >
          <option value="all">All Classes</option>
          {activeClasses.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 140, maxWidth: 200, fontSize: 13 }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All Types</option>
          <option value="announcement">Announcements</option>
          <option value="activity">Activities</option>
          <option value="quiz">Quizzes</option>
          <option value="grade">Grades</option>
          <option value="attendance">Attendance</option>
        </select>
      </div>

      {streamItems.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink3)', padding: '48px 0', fontSize: 14 }}>
          No stream items for the selected filters.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {streamItems.map(item => {
          const classObj = getClassObj(item)
          if (item.type === 'announcement') return <AnnouncementCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'activity') return <ActivityCard key={item.id} item={item} classObj={classObj} students={students} />
          if (item.type === 'quiz') return <QuizCard key={item.id} item={item} classObj={classObj} students={students} />
          if (item.type === 'grade') return <GradeCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'attendance') return <AttendanceCard key={item.id} item={item} classObj={classObj} />
          return null
        })}
      </div>

      {/* Announcement modals */}
      {viewAnn && (
        <AnnouncementDetailModal
          ann={announcements.find(a => a.id === viewAnn.id) || viewAnn}
          classes={classes}
          onClose={() => setViewAnn(null)}
          onEdit={ann => { setEditAnn(ann); setFormOpen(true) }}
        />
      )}
      {formOpen && (
        <AnnouncementFormModal
          ann={editAnn}
          onClose={() => { setFormOpen(false); setEditAnn(null) }}
        />
      )}
      {deleteId && (
        <Modal onClose={() => setDeleteId(null)} title="Delete Announcement">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 14, color: 'var(--ink2)' }}>Are you sure you want to delete this announcement? This cannot be undone.</p>
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
