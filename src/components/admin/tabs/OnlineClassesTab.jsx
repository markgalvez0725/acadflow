import React, { useState } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, ExternalLink, VideoOff, Trash2, CheckCircle, Save } from 'lucide-react'

export default function OnlineClassesTab() {
  const { classes, meetings, saveMeetLink, scheduleMeeting, startMeeting, endMeeting, cancelMeeting } = useData()
  const { toast } = useUI()

  // ── Section 1: Meet Links ─────────────────────────────────────────────
  const [linkDrafts, setLinkDrafts] = useState({})

  function getLinkDraft(classId, fallback) {
    return linkDrafts[classId] !== undefined ? linkDrafts[classId] : (fallback || '')
  }

  async function handleSaveLink(cls) {
    const url = getLinkDraft(cls.id, cls.meetLink)
    if (!url.trim()) return
    try {
      await saveMeetLink(cls.id, url.trim())
      toast('Meet link saved.', 'success')
    } catch (e) {
      toast('Failed to save Meet link.', 'error')
    }
  }

  // ── Section 2: Schedule Form ──────────────────────────────────────────
  const [form, setForm] = useState({ classId: '', title: '', scheduledAt: '', description: '' })
  const [scheduling, setScheduling] = useState(false)

  async function handleSchedule(e) {
    e.preventDefault()
    if (!form.classId || !form.title || !form.scheduledAt) return
    const cls = classes.find(c => c.id === form.classId)
    if (!cls) return
    setScheduling(true)
    try {
      await scheduleMeeting({
        classId: cls.id,
        className: cls.name,
        title: form.title.trim(),
        description: form.description.trim(),
        meetLink: cls.meetLink || '',
        scheduledAt: new Date(form.scheduledAt).getTime(),
      })
      toast('Meeting scheduled. Students have been notified.', 'success')
      setForm({ classId: '', title: '', scheduledAt: '', description: '' })
    } catch (e) {
      toast('Failed to schedule meeting.', 'error')
    } finally {
      setScheduling(false)
    }
  }

  // ── Section 3: Meetings List ──────────────────────────────────────────
  const [listTab, setListTab] = useState('upcoming')
  const upcoming = meetings
    .filter(m => m.status === 'scheduled' || m.status === 'live')
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
  const past = meetings
    .filter(m => m.status === 'ended')
    .sort((a, b) => b.scheduledAt - a.scheduledAt)

  async function handleStart(m) {
    try {
      await startMeeting(m)
      window.open(m.meetLink, '_blank', 'noopener,noreferrer')
      toast('Meeting is now live. Students have been notified.', 'success')
    } catch (e) {
      toast('Failed to start meeting.', 'error')
    }
  }

  async function handleEnd(m) {
    try {
      await endMeeting(m)
      toast('Meeting ended.', 'success')
    } catch (e) {
      toast('Failed to end meeting.', 'error')
    }
  }

  async function handleCancel(m) {
    try {
      await cancelMeeting(m)
      toast('Meeting cancelled. Students have been notified.', 'success')
    } catch (e) {
      toast('Failed to cancel meeting.', 'error')
    }
  }

  const activeClasses = classes.filter(c => !c.archived)

  return (
    <div className="online-classes-tab" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Section 1 — Class Meet Links */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={18} /> Class Meet Links
          </div>
        </div>
        {activeClasses.length === 0 && (
          <div className="empty"><div className="empty-icon"><Video size={36} /></div>No classes found. Add classes first.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {activeClasses.map(cls => (
            <div key={cls.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{cls.name}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 12 }}
                  placeholder="Paste Google Meet URL..."
                  value={getLinkDraft(cls.id, cls.meetLink)}
                  onChange={e => setLinkDrafts(prev => ({ ...prev, [cls.id]: e.target.value }))}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleSaveLink(cls)}
                  title="Save Meet link"
                >
                  <Save size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — Schedule Meeting Form */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarPlus size={18} /> Schedule a Meeting
          </div>
        </div>
        <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Class</label>
              <select
                className="input"
                value={form.classId}
                onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}
                required
              >
                <option value="">Select class...</option>
                {activeClasses.map(cls => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date & Time</label>
              <input
                className="input"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">Meeting Title</label>
            <input
              className="input"
              placeholder="e.g. Chapter 5 Review"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input"
              placeholder="Topics to be covered..."
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <button className="btn btn-primary" type="submit" disabled={scheduling}>
              <CalendarPlus size={15} style={{ marginRight: 6 }} />
              {scheduling ? 'Scheduling...' : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </section>

      {/* Section 3 — Meetings List */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title">Meetings</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-sm ${listTab === 'upcoming' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setListTab('upcoming')}
            >Upcoming</button>
            <button
              className={`btn btn-sm ${listTab === 'past' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setListTab('past')}
            >Past</button>
          </div>
        </div>

        {listTab === 'upcoming' && (
          upcoming.length === 0
            ? <div className="empty"><div className="empty-icon"><CalendarPlus size={36} /></div>No upcoming meetings.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {upcoming.map(m => <MeetingRow key={m.id} m={m} onStart={handleStart} onEnd={handleEnd} onCancel={handleCancel} />)}
              </div>
        )}

        {listTab === 'past' && (
          past.length === 0
            ? <div className="empty"><div className="empty-icon"><CheckCircle size={36} /></div>No past meetings.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {past.map(m => <MeetingRow key={m.id} m={m} />)}
              </div>
        )}
      </section>
    </div>
  )
}

function MeetingRow({ m, onStart, onEnd, onCancel }) {
  const dt = new Date(m.scheduledAt)
  const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{m.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{m.className}</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> {dateStr} at {timeStr}
        </div>
        {m.description && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>{m.description}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <StatusBadge status={m.status} />
        {m.status === 'scheduled' && onStart && (
          <button className="btn btn-primary btn-sm" onClick={() => onStart(m)} title="Start meeting">
            <ExternalLink size={14} style={{ marginRight: 4 }} /> Start
          </button>
        )}
        {m.status === 'scheduled' && onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(m)} title="Cancel meeting">
            <Trash2 size={14} />
          </button>
        )}
        {m.status === 'live' && onEnd && (
          <button className="btn btn-sm" style={{ background: 'var(--red, #ef4444)', color: '#fff' }} onClick={() => onEnd(m)} title="End meeting">
            <VideoOff size={14} style={{ marginRight: 4 }} /> End
          </button>
        )}
        {m.status === 'ended' && <CheckCircle size={16} style={{ color: 'var(--green, #22c55e)' }} />}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: 'Scheduled', color: 'var(--accent, #0ea5e9)' },
    live:      { label: 'LIVE',      color: 'var(--red, #ef4444)' },
    ended:     { label: 'Ended',     color: 'var(--ink3, #94a3b8)' },
  }
  const s = map[status] || map.ended
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: s.color + '22', color: s.color, letterSpacing: '0.03em',
    }}>
      {s.label}
    </span>
  )
}
