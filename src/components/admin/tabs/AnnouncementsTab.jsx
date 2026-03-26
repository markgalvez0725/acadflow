import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import Badge from '@/components/primitives/Badge'
import { Megaphone, Plus, Trash2, CalendarOff, Video, ToggleLeft, ToggleRight } from 'lucide-react'

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

    setSaving(true)
    try {
      const announcement = {
        id:          ann?.id || annId(),
        type,
        classId,
        title:       finalTitle,
        message:     message.trim(),
        meetingLink: type === 'online_class' ? (meetingLink.trim() || null) : null,
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

// ── Main Tab ──────────────────────────────────────────────────────────
export default function AnnouncementsTab() {
  const { announcements, classes, saveAnnouncement, deleteAnnouncement } = useData()
  const { toast } = useUI()

  const [formOpen, setFormOpen]     = useState(false)
  const [editAnn,  setEditAnn]      = useState(null)
  const [deleteId, setDeleteId]     = useState(null)

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
                style={{ padding: '14px 16px', opacity: effectivelyActive ? 1 : 0.6 }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: ann.type === 'no_class' ? 'rgba(234,179,8,0.12)' : 'rgba(59,130,246,0.12)',
                    color: ann.type === 'no_class' ? 'var(--yellow)' : 'var(--accent)',
                  }}>
                    {ann.type === 'no_class' ? <CalendarOff size={18} /> : <Video size={18} />}
                  </div>

                  {/* Body */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ann.title}</span>
                      <span className={`badge ${ann.type === 'no_class' ? 'badge-yellow' : 'badge-blue'}`}>
                        {ann.type === 'no_class' ? 'No Class' : 'Online Class'}
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
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Posted: {formatDate(ann.createdAt)}</span>
                      {ann.expiresAt && <span>Expires: {formatDate(ann.expiresAt)}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
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
