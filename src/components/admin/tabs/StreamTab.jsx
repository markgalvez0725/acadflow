import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { useUI } from '@/context/UIContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { Megaphone, ClipboardList, BookOpen, CalendarCheck, FileQuestion, Clock, Users, Award, CheckCircle2, XCircle, AlertCircle, Plus, CalendarOff, Video, Link, X, MessageSquare, CornerDownRight, Send, Bold, Italic, Underline, Highlighter, List, ListOrdered, Paperclip, Image as ImageIcon, FileText } from 'lucide-react'
import { isConfigured as driveConfigured, getConnection as getDriveConnection, uploadFile as driveUpload } from '@/utils/googleDrive'
import DOMPurify from 'dompurify'
import { v4 as uuidv4 } from 'uuid'
import ExpandableHtml from '@/components/primitives/ExpandableHtml'
import KebabMenu from '@/components/primitives/KebabMenu'
import MentionInput from '@/components/primitives/MentionInput'
import PostShell from '@/components/primitives/StreamPost'
import CommentsSection from '@/components/primitives/CommentsSection'
import AnnouncementPost from '@/components/primitives/AnnouncementPost'
import { resolveMentions } from '@/utils/mentions'
import { notifyMention } from '@/firebase/messageNotify'
import { streamGroupLabel as getGroupLabel, fmtDateTime as formatDate } from '@/utils/format'
import { courseShort } from '@/constants/courses'

const PAGE_SIZE = 10

const shimmerStyle = {
  background: 'linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%)',
  backgroundSize: '800px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
}

function StreamSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="stream-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ ...shimmerStyle, width: 80, height: 18 }} />
            <div style={{ ...shimmerStyle, width: 50, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: '70%', height: 18 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...shimmerStyle, width: 90, height: 14 }} />
            <div style={{ ...shimmerStyle, width: 70, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: 120, height: 12 }} />
        </div>
      ))}
    </>
  )
}

function Pagination({ page, total, pageSize, onPrev, onNext }) {
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'var(--ink2)' }}>
      <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={page === 0}>← Prev</button>
      <span>Showing {from}-{to} of {total}</span>
      <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={to >= total}>Next →</button>
    </div>
  )
}

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
  ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'mark', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'a', 'pre', 'code', 'font', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'size', 'colspan', 'rowspan'],
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

  function insertLink() {
    const url = window.prompt('Enter the link URL:', 'https://')
    if (!url || url === 'https://') return
    editorRef.current?.focus()
    document.execCommand('createLink', false, url)
    onChange(sanitizeHtml(editorRef.current.innerHTML))
  }

  function insertTable() {
    const dims = window.prompt('Table size (rows x columns):', '2 x 2')
    if (!dims) return
    const [r, c] = dims.split(/[x×,]/i).map(n => parseInt(n.trim(), 10))
    const rows = Math.min(Math.max(r || 2, 1), 10)
    const cols = Math.min(Math.max(c || 2, 1), 8)
    let html = '<table><tbody>'
    for (let i = 0; i < rows; i++) {
      html += '<tr>'
      for (let j = 0; j < cols; j++) html += '<td>&nbsp;</td>'
      html += '</tr>'
    }
    html += '</tbody></table><p><br></p>'
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, html)
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
        <select
          style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}
          defaultValue=""
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('fontSize', e.target.value); e.target.value = '' }}
          title="Font size"
        >
          <option value="" disabled>Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">Huge</option>
        </select>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'pre') }} title="Code block">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); insertLink() }} title="Insert link"><Link size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); insertTable() }} title="Insert table">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        </button>
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

  // Google Drive attachments (browser-only upload to the teacher's own Drive).
  const [attachments, setAttachments] = useState(ann?.attachments || [])
  const [uploads, setUploads] = useState([]) // in-flight: { id, name, pct, error }
  const photoInput = useRef(null)
  const fileInput  = useRef(null)
  const drive = getDriveConnection()
  // Folder name for this post's class: AcadFlow / {this} / {Photos|Modules} / file
  const driveClassLabel = classId === 'all'
    ? 'All Classes'
    : (() => { const c = classes.find(x => x.id === classId); return c ? `${courseShort(c.name)}${c.section ? ' ' + c.section : ''}`.trim() : '' })()

  function addFiles(fileList) {
    if (!drive.connected) { toast('Connect Google Drive in Settings first.', 'error'); return }
    if (!classId) { toast('Pick a class first so files go to the right folder.', 'error'); return }
    Array.from(fileList || []).forEach(file => {
      const uid = 'u' + Math.random().toString(36).slice(2)
      setUploads(prev => [...prev, { id: uid, name: file.name, pct: 0, error: '' }])
      driveUpload(file, { classLabel: driveClassLabel, onProgress: pct => setUploads(prev => prev.map(u => u.id === uid ? { ...u, pct } : u)) })
        .then(att => { setAttachments(prev => [...prev, att]); setUploads(prev => prev.filter(u => u.id !== uid)) })
        .catch(e => setUploads(prev => prev.map(u => u.id === uid ? { ...u, error: e?.message || 'Upload failed' } : u)))
    })
  }
  function removeAttachment(id) { setAttachments(prev => prev.filter(a => a.driveId !== id)) }

  const selectedClass = classes.find(c => c.id === classId)
  const autoTitle = useMemo(() => {
    const label = classId === 'all' ? 'All Classes' : selectedClass ? `${selectedClass.name}${selectedClass.section ? ` ${selectedClass.section}` : ''}` : ''
    if (!label) return ''
    if (type === 'no_class') return `No Class Today - ${label}`
    if (type === 'online_class') return `Online Class - ${label}`
    if (type === 'meeting_topics') return `Meeting Topics - ${label}`
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
        attachments: attachments,
        // Preserve fields not managed by this form so editing doesn't drop them.
        pinned:      ann?.pinned ?? false,
        publishAt:   ann?.publishAt ?? null,
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
            <option value="">- Select class -</option>
            <option value="all">All Classes</option>
            {classes.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{courseShort(c.name)}{c.section ? ` - ${c.section}` : ''}</option>)}
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
          <input className="form-input" value={displayTitle} placeholder="e.g. No Class Today - BSIT 2A" onChange={e => { setTitleTouched(true); setTitle(e.target.value) }} />
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
          <label className="form-label">Attachments <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
          {!driveConfigured() ? (
            <div style={{ fontSize: 12, color: 'var(--ink3)', background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              Google Drive is not set up for this deployment. You can still paste a Drive link above and it previews inline.
            </div>
          ) : !drive.connected ? (
            <div style={{ fontSize: 12, color: 'var(--ink3)', background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              Connect Google Drive in Settings to upload files and photos.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attachments.map(a => (
                <div key={a.driveId} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px' }}>
                  {/^image\//.test(a.mimeType || '') ? <ImageIcon size={16} style={{ color: '#10b981', flexShrink: 0 }} /> : <FileText size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => removeAttachment(a.driveId)} aria-label="Remove attachment"><X size={13} /></button>
                </div>
              ))}
              {uploads.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px' }}>
                  <Paperclip size={16} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                  <span style={{ fontSize: 11, color: u.error ? 'var(--red)' : 'var(--accent)' }}>{u.error ? u.error : u.pct + '%'}</span>
                  {u.error && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setUploads(prev => prev.filter(x => x.id !== u.id))} aria-label="Dismiss"><X size={13} /></button>}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => photoInput.current?.click()}><ImageIcon size={14} style={{ marginRight: 5 }} /> Add photo</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}><Paperclip size={14} style={{ marginRight: 5 }} /> Add file</button>
              </div>
              <input ref={photoInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              <input ref={fileInput} type="file" multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
          )}
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
    return c ? c.name + (c.section ? ` - ${c.section}` : '') : classId
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
        <CommentsSection ann={ann} authorId={admin?.user || 'admin'} authorName={admin?.user || 'Professor'} role="teacher" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onClose(); onEdit(ann) }}>Edit</button>
        </div>
      </div>
    </Modal>
  )
}

function adminClassLabel(classObj) {
  return classObj?.name ? `${classObj.name}${classObj.section ? ' · ' + classObj.section : ''}` : ''
}

// Thin wrapper: the IG card lives in the shared AnnouncementPost; the teacher
// side supplies its management kebab (Edit/Pin/Deactivate/Delete) + status badge
// and posts comments as the professor.
function AnnouncementCard({ item, classObj, author, viewerId, onToggleLike, onEdit, onToggleActive, onTogglePin, onDelete }) {
  const ann = item.data
  const pinned = !!item.pinned   // effective (respects expiry), computed by the feed
  const expired = ann.expiresAt && ann.expiresAt < Date.now()
  const effectivelyActive = ann.active && !expired
  const menuItems = [
    onTogglePin    && { label: ann.pinned ? 'Unpin' : 'Pin', onClick: onTogglePin },
    onToggleActive && { label: ann.active ? 'Deactivate' : 'Activate', onClick: onToggleActive },
    onEdit         && { label: 'Edit', onClick: onEdit },
    onDelete       && { label: 'Delete', onClick: onDelete, danger: true },
  ].filter(Boolean)
  const statusBadge = !effectivelyActive
    ? <span className="badge badge-gray" style={{ fontSize: 10, flexShrink: 0 }}>{expired ? 'Expired' : 'Inactive'}</span>
    : null
  return (
    <AnnouncementPost
      ann={ann}
      author={author}
      classObj={classObj}
      pinned={pinned}
      statusBadge={statusBadge}
      menuItems={menuItems}
      viewerId={viewerId}
      onToggleLike={onToggleLike}
      commentAuthor={{ id: viewerId, name: author?.name || 'Professor', role: 'teacher' }}
    />
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
  const notSubmitted = classStudents.length - subCount
  const cls = adminClassLabel(classObj)
  return (
    <PostShell
      type="activity"
      title={act.title}
      meta={<><span>Activity{act.subject ? ` · ${act.subject}` : ''}{cls ? ` · ${cls}` : ''}</span><span>·</span><span>{timeAgo(act.createdAt)}</span></>}
    >
      {act.deadline && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}
          {Date.now() > act.deadline && <span style={{ color: '#ef4444', fontWeight: 600 }}> · Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <div className="stream-stat"><CheckCircle2 size={14} style={{ color: '#10b981' }} /><span>{subCount} submitted</span></div>
        <div className="stream-stat"><Award size={14} style={{ color: '#6366f1' }} /><span>{gradedCount} graded</span></div>
        <div className="stream-stat"><AlertCircle size={14} style={{ color: '#f59e0b' }} /><span>{notSubmitted} pending</span></div>
        {totalRubric > 0 && <div className="stream-stat"><span style={{ color: 'var(--ink3)' }}>{totalRubric} pts total</span></div>}
      </div>
    </PostShell>
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
  const cls = adminClassLabel(classObj)
  return (
    <PostShell
      type="quiz"
      title={quiz.title}
      meta={<><span>Quiz{quiz.subject ? ` · ${quiz.subject}` : ''}{cls ? ` · ${cls}` : ''}</span><span>·</span><span>{timeAgo(quiz.openAt)}</span></>}
      badges={isOpen
        ? <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>OPEN</span>
        : isClosed ? <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>CLOSED</span> : null}
    >
      <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <div className="stream-stat"><FileQuestion size={14} style={{ color: '#8b5cf6' }} /><span>{totalQ} question{totalQ !== 1 ? 's' : ''}</span></div>
        <div className="stream-stat"><CheckCircle2 size={14} style={{ color: '#10b981' }} /><span>{subCount} taken</span></div>
        {avgScore != null && <div className="stream-stat"><Award size={14} style={{ color: '#f59e0b' }} /><span>Avg: {avgScore}%</span></div>}
      </div>
    </PostShell>
  )
}

function GradeCard({ item, classObj }) {
  const { studentName, subject, gradeData, uploadedAt } = item.data
  const cls = adminClassLabel(classObj)
  return (
    <PostShell
      type="grade"
      title={studentName}
      meta={<><span>Grade{subject ? ` · ${subject}` : ''}{cls ? ` · ${cls}` : ''}</span><span>·</span><span>{timeAgo(uploadedAt)}</span></>}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && <span style={{ fontSize: 13, color: 'var(--ink2)' }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>}
        {gradeData.finals != null && <span style={{ fontSize: 13, color: 'var(--ink2)' }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>}
        {gradeData.finalGrade != null && <span style={{ fontSize: 13, color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>}
      </div>
    </PostShell>
  )
}

function AttendanceCard({ item, classObj }) {
  const { subject, date, presentCount, absentCount, excusedCount } = item.data
  const cls = adminClassLabel(classObj)
  return (
    <PostShell
      type="attendance"
      title={`Attendance - ${date}`}
      meta={<span>{subject || 'Attendance'}{cls ? ` · ${cls}` : ''}</span>}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="stream-stat"><CheckCircle2 size={14} style={{ color: '#10b981' }} /><span>{presentCount} present</span></div>
        <div className="stream-stat"><XCircle size={14} style={{ color: '#ef4444' }} /><span>{absentCount} absent</span></div>
        {excusedCount > 0 && <div className="stream-stat"><AlertCircle size={14} style={{ color: '#f59e0b' }} /><span>{excusedCount} excused</span></div>}
      </div>
    </PostShell>
  )
}

export default function StreamTab() {
  const { classes, students, activities, quizzes, announcements, saveAnnouncement, deleteAnnouncement, fbReady, admin, toggleAnnouncementLike } = useData()
  const author = useMemo(() => ({ name: admin?.name || admin?.user || 'Professor', photo: admin?.photo || null }), [admin?.name, admin?.user, admin?.photo])
  const viewerId = admin?.user || 'admin'
  const { toast } = useUI()
  const [filterClass, setFilterClass] = useState('all')
  const [filterSubject, setFilterSubject] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [annPage, setAnnPage] = useState(0)
  const [streamPage, setStreamPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editAnn,  setEditAnn]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  // Subjects available for the subject filter - scoped to the selected class,
  // or the union of all active classes when "All Classes" is chosen.
  const subjectOptions = useMemo(() => {
    const src = filterClass === 'all' ? activeClasses : activeClasses.filter(c => c.id === filterClass)
    return [...new Set(src.flatMap(c => c.subjects || []))].sort()
  }, [activeClasses, filterClass])

  // Build stream items from all data sources
  const streamItems = useMemo(() => {
    const items = []

    // Announcements
    announcements.forEach(ann => {
      if (filterClass !== 'all' && ann.classId !== 'all' && ann.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'announcement') return
      // Effective pin: a pinned post stops floating once it has expired.
      items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: ann.classId, pinned: !!ann.pinned && !isExpired(ann) })
    })

    // Activities
    activities.forEach(act => {
      if (filterClass !== 'all' && act.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'activity') return
      if (filterSubject !== 'all' && act.subject !== filterSubject) return
      items.push({ id: `act-${act.id}`, type: 'activity', ts: act.createdAt || 0, data: act, classId: act.classId })
    })

    // Quizzes
    quizzes.forEach(quiz => {
      if (filterType !== 'all' && filterType !== 'quiz') return
      const matchesClass = filterClass === 'all' || (quiz.classIds || []).includes(filterClass)
      if (!matchesClass) return
      if (filterSubject !== 'all' && quiz.subject !== filterSubject) return
      items.push({ id: `quiz-${quiz.id}`, type: 'quiz', ts: quiz.openAt || 0, data: quiz, classId: quiz.classIds?.[0] })
    })

    // Grades - one card per student+subject grade upload
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
          if (filterSubject !== 'all' && subj !== filterSubject) return
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

    // Attendance - derive unique session dates per class+subject
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
            if (filterSubject !== 'all' && subj !== filterSubject) return
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

    // Pinned announcements float to the very top, then most-recent first.
    return items.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (b.ts - a.ts))
  }, [classes, students, activities, quizzes, announcements, filterClass, filterSubject, filterType])

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  function getClassName(classId) {
    if (classId === 'all') return 'All Classes'
    const c = classes.find(x => x.id === classId)
    return c ? c.name + (c.section ? ` - ${c.section}` : '') : classId
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

  const PIN_LIMIT = 3
  async function handleTogglePin(ann) {
    if (!ann.pinned) {
      // Count only currently-effective pins (expired ones don't occupy a slot).
      const activePins = announcements.filter(a => a.pinned && !isExpired(a)).length
      if (activePins >= PIN_LIMIT) {
        toast(`You can pin up to ${PIN_LIMIT} posts. Unpin one first.`, 'error')
        return
      }
    }
    try {
      await saveAnnouncement({ ...ann, pinned: !ann.pinned })
      toast(ann.pinned ? 'Unpinned.' : 'Pinned to top.', 'success')
    } catch {
      toast('Failed to update pin.', 'error')
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

  const sortedAnnouncements = useMemo(() => {
    const pin = a => (a.pinned && !isExpired(a)) ? 1 : 0
    return [...announcements].sort((a, b) => (pin(b) - pin(a)) || (b.createdAt - a.createdAt))
  }, [announcements]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!fbReady) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <StreamSkeleton />
      </div>
    )
  }

  const TYPE_FILTERS = [
    ['all', 'All'],
    ['announcement', 'Announcements'],
    ['activity', 'Activities'],
    ['quiz', 'Quizzes'],
    ['grade', 'Grades'],
    ['attendance', 'Attendance'],
  ]

  return (
    <div className="s-feed" style={{ paddingBottom: 32 }}>
      {/* Composer - opens the announcement form */}
      <div className="s-composer">
        <div className="s-composer-av">T</div>
        <button className="s-composer-prompt" onClick={() => { setEditAnn(null); setFormOpen(true) }}>Share an announcement…</button>
        <button className="s-composer-add" onClick={() => { setEditAnn(null); setFormOpen(true) }} title="New announcement"><Plus size={18} /></button>
      </div>

      {/* Type filter pills */}
      <div className="s-filter-pills">
        {TYPE_FILTERS.map(([k, label]) => (
          <button key={k} className={`s-pill${filterType === k ? ' active' : ''}`} onClick={() => { setFilterType(k); setStreamPage(0) }}>{label}</button>
        ))}
      </div>

      {/* Class + subject selectors */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 160, maxWidth: 260, fontSize: 13 }}
          value={filterClass}
          onChange={e => { setFilterClass(e.target.value); setFilterSubject('all'); setAnnPage(0); setStreamPage(0) }}
        >
          <option value="all">All Classes</option>
          {activeClasses.map(c => (
            <option key={c.id} value={c.id}>{courseShort(c.name)}{c.section ? ` - ${c.section}` : ''}</option>
          ))}
        </select>
        {subjectOptions.length > 0 && (
          <select
            className="form-input"
            style={{ flex: 1, minWidth: 140, maxWidth: 220, fontSize: 13 }}
            value={filterSubject}
            onChange={e => { setFilterSubject(e.target.value); setStreamPage(0) }}
            title="Filter the stream by subject"
          >
            <option value="all">All Subjects</option>
            {subjectOptions.map(subj => (
              <option key={subj} value={subj}>{subj}</option>
            ))}
          </select>
        )}
      </div>

      {streamItems.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink3)', padding: '48px 0', fontSize: 14 }}>
          No stream items for the selected filters.
        </div>
      )}

      {streamItems.slice(streamPage * PAGE_SIZE, (streamPage + 1) * PAGE_SIZE).map((item, idx, arr) => {
        const classObj = getClassObj(item)
        const label = item.pinned ? 'Pinned' : getGroupLabel(item.ts)
        const prevLabel = idx > 0 ? (arr[idx - 1].pinned ? 'Pinned' : getGroupLabel(arr[idx - 1].ts)) : null
        const showGroup = label !== prevLabel
        return (
          <React.Fragment key={item.id}>
            {showGroup && <div className="s-feed-day">{label}</div>}
            {item.type === 'announcement' && (
              <AnnouncementCard
                item={item}
                classObj={classObj}
                author={author}
                viewerId={viewerId}
                onToggleLike={toggleAnnouncementLike}
                onEdit={() => { setEditAnn(item.data); setFormOpen(true) }}
                onToggleActive={() => handleToggleActive(item.data)}
                onTogglePin={() => handleTogglePin(item.data)}
                onDelete={() => { if (window.confirm('Delete this announcement?')) handleDelete(item.data.id) }}
              />
            )}
            {item.type === 'activity' && <ActivityCard item={item} classObj={classObj} students={students} />}
            {item.type === 'quiz' && <QuizCard item={item} classObj={classObj} students={students} />}
            {item.type === 'grade' && <GradeCard item={item} classObj={classObj} />}
            {item.type === 'attendance' && <AttendanceCard item={item} classObj={classObj} />}
          </React.Fragment>
        )
      })}
      <Pagination page={streamPage} total={streamItems.length} pageSize={PAGE_SIZE} onPrev={() => setStreamPage(p => p - 1)} onNext={() => setStreamPage(p => p + 1)} />

      {/* Announcement modals */}
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
