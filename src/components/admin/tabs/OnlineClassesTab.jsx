import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, ExternalLink, VideoOff, Trash2, CheckCircle, Save, Radio } from 'lucide-react'
import { courseShort } from '@/constants/courses'

export default function OnlineClassesTab() {
  const { classes, meetings, saveMeetLink, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting } = useData()
  const { toast } = useUI()
  const [panel, setPanel] = useState('links')
  const [goingLive, setGoingLive] = useState('') // key of the link currently going live

  // ── Section 1: Meet Links ─────────────────────────────────────────────
  const [linkDrafts, setLinkDrafts] = useState({})

  function linkKey(classId, subject) { return subject ? `${classId}::${subject}` : classId }
  function getLinkDraft(classId, subject, fallback) {
    const k = linkKey(classId, subject)
    return linkDrafts[k] !== undefined ? linkDrafts[k] : (fallback || '')
  }

  async function handleSaveLink(cls, subject, fallback) {
    const url = getLinkDraft(cls.id, subject, fallback)
    if (!url.trim()) return
    try {
      await saveMeetLink(cls.id, url.trim(), subject || undefined)
      toast(subject ? `Meet link saved for ${subject}.` : 'Meet link saved.', 'success')
    } catch (e) {
      toast('Failed to save Meet link.', 'error')
    }
  }

  // One-click: mark the class live in AcadFlow (so enrolled students see Join)
  // AND open the Meet for the professor.
  async function handleGoLive(cls, subject, link) {
    const url = (link || '').trim()
    if (!url) { toast('Add a Meet link first.', 'error'); return }
    const key = linkKey(cls.id, subject)
    setGoingLive(key)
    try {
      await startInstantMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: subject || null,
        title: subject || `${cls.name} - live class`,
        description: '',
        meetLink: url,
      })
      window.open(url, '_blank', 'noopener,noreferrer')
      toast('You are live - students can now join.', 'success')
      setPanel('meetings') // hand the professor off to manage/end the live class
    } catch (e) {
      toast('Failed to go live.', 'error')
    } finally {
      setGoingLive('')
    }
  }

  // A currently-live meeting for this class/subject, if any.
  function liveMeetingFor(classId, subject) {
    return meetings.find(m => m.status === 'live' && m.classId === classId && (m.subject || null) === (subject || null))
  }

  // ── Section 2: Schedule Form ──────────────────────────────────────────
  const [form, setForm] = useState({ classId: '', subject: '', title: '', scheduledAt: '', description: '' })
  const [scheduling, setScheduling] = useState(false)
  const scheduleClass = classes.find(c => c.id === form.classId)

  async function handleSchedule(e) {
    e.preventDefault()
    if (!form.classId || !form.title || !form.scheduledAt) return
    const cls = classes.find(c => c.id === form.classId)
    if (!cls) return
    setScheduling(true)
    try {
      const meetLink = (form.subject && cls.meetLinks?.[form.subject]) || cls.meetLink || ''
      await scheduleMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: form.subject || null,
        title: form.title.trim(),
        description: form.description.trim(),
        meetLink,
        scheduledAt: new Date(form.scheduledAt).getTime(),
      })
      toast('Meeting scheduled. Students have been notified.', 'success')
      setForm({ classId: '', subject: '', title: '', scheduledAt: '', description: '' })
    } catch (e) {
      toast('Failed to schedule meeting.', 'error')
    } finally {
      setScheduling(false)
    }
  }

  // ── Section 3: Meetings List ──────────────────────────────────────────
  const [listTab, setListTab] = useState('upcoming')
  const upcoming = useMemo(() => {
    const active = meetings.filter(m => m.status === 'scheduled' || m.status === 'live')
    // Collapse duplicate sessions for the same class + subject + status that an
    // earlier double "Go Live" could have created, keeping the newest doc. This
    // hides the "two sessions displaying" bug even for already-created dupes.
    const byKey = new Map()
    for (const m of active) {
      const key = `${m.classId}::${m.subject || ''}::${m.status}`
      const prev = byKey.get(key)
      if (!prev || (m.createdAt || 0) > (prev.createdAt || 0)) byKey.set(key, m)
    }
    return [...byKey.values()].sort((a, b) => a.scheduledAt - b.scheduledAt)
  }, [meetings])
  const past = useMemo(() =>
    meetings.filter(m => m.status === 'ended')
      .sort((a, b) => b.scheduledAt - a.scheduledAt),
    [meetings]
  )

  async function handleStart(m) {
    if (!m.meetLink?.trim()) {
      toast('No Meet link set for this class. Add one in the Meet Links panel first.', 'error')
      return
    }
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

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  return (
    <div className="online-classes-tab" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      <section className="card" style={{ padding: 12, background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${panel === 'links' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPanel('links')}
          >
            <Video size={14} /> Meet Links
          </button>
          <button
            className={`btn btn-sm ${panel === 'schedule' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPanel('schedule')}
          >
            <CalendarPlus size={14} /> Schedule
          </button>
          <button
            className={`btn btn-sm ${panel === 'meetings' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPanel('meetings')}
          >
            <Clock size={14} /> Meetings
          </button>
        </div>
      </section>

      {/* Section 1 - Class Meet Links */}
      {panel === 'links' && <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={18} /> Class Meet Links
          </div>
        </div>
        {activeClasses.length === 0 && (
          <div className="empty"><div className="empty-icon"><Video size={36} /></div>No classes found. Add classes first.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
          {activeClasses.map(cls => {
            const subjects = cls.subjects?.length ? cls.subjects : null
            return (
              <div key={cls.id} className="card" style={{ padding: 16 }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Video size={17} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cls.name}>{courseShort(cls.name)}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{subjects ? `${subjects.length} subject${subjects.length !== 1 ? 's' : ''}` : 'No subjects yet'}</div>
                  </div>
                  {cls.section && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-l)', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>{cls.section}</span>
                  )}
                </div>

                {/* Per-subject Meet links */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(subjects || [null]).map(sub => {
                    const saved = sub ? (cls.meetLinks?.[sub] || '') : (cls.meetLink || '')
                    const val = getLinkDraft(cls.id, sub, saved)
                    return (
                      <div key={sub || '_general'}>
                        {sub && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {sub}{saved && <CheckCircle size={12} style={{ color: 'var(--green)' }} />}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="input"
                            style={{ flex: 1, fontSize: 12 }}
                            placeholder="Paste Google Meet URL…"
                            value={val}
                            onChange={e => setLinkDrafts(prev => ({ ...prev, [linkKey(cls.id, sub)]: e.target.value }))}
                          />
                          {saved && (
                            <a href={saved} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" title="Open link">
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => handleSaveLink(cls, sub, saved)} title="Save Meet link">
                            <Save size={14} />
                          </button>
                        </div>
                        {liveMeetingFor(cls.id, sub) ? (
                          <button
                            className="btn btn-sm"
                            style={{ marginTop: 6, width: '100%', background: '#ef4444', color: '#fff' }}
                            onClick={() => setPanel('meetings')}
                            title="This class is live - manage or end it in the Meetings tab"
                          >
                            <Radio size={13} className="animate-pulse" style={{ marginRight: 5 }} /> Live now - manage in Meetings
                          </button>
                        ) : val.trim() ? (
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ marginTop: 6, width: '100%' }}
                            disabled={goingLive === linkKey(cls.id, sub)}
                            onClick={() => handleGoLive(cls, sub, val)}
                            title="Start the class now - students get a Join button"
                          >
                            <Radio size={13} style={{ marginRight: 5 }} />
                            {goingLive === linkKey(cls.id, sub) ? 'Going live…' : 'Go Live now'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>}

      {/* Section 2 - Schedule Meeting Form */}
      {panel === 'schedule' && <section>
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
                onChange={e => setForm(f => ({ ...f, classId: e.target.value, subject: '' }))}
                required
              >
                <option value="">Select class...</option>
                {activeClasses.map(cls => (
                  <option key={cls.id} value={cls.id}>{classLabel(cls)}</option>
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
          {scheduleClass?.subjects?.length > 0 && (
            <div>
              <label className="label">Subject <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(picks that subject's saved Meet link)</span></label>
              <select
                className="input"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              >
                <option value="">Use class default link</option>
                {scheduleClass.subjects.map(s => (
                  <option key={s} value={s}>{s}{scheduleClass.meetLinks?.[s] ? '' : ' (no link set)'}</option>
                ))}
              </select>
            </div>
          )}
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
      </section>}

      {/* Section 3 - Meetings List */}
      {panel === 'meetings' && <section>
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
      </section>}
    </div>
  )
}

function classLabel(cls) {
  return cls?.section ? `${courseShort(cls.name)} - ${cls.section}` : courseShort(cls?.name) || 'Class'
}

function MeetingRow({ m, onStart, onEnd, onCancel }) {
  const dt = new Date(m.scheduledAt)
  const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{m.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{m.className}{m.subject ? ` · ${m.subject}` : ''}</div>
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
