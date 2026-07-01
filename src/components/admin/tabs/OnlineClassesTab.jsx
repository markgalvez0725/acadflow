import React, { useState, useMemo, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, ExternalLink, VideoOff, Trash2, CheckCircle, Save, Radio } from 'lucide-react'
import { courseShort } from '@/constants/courses'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'

// Relative-time pill for a scheduled meeting ("in 45 m", "in 2 h 15 m",
// "Fri · in 2 days", then a plain date once it is over a week out).
function fmtCountdown(ts, now) {
  const d = ts - now
  if (d <= 0) return 'now'
  const m = Math.round(d / 60000)
  if (m < 60) return `in ${m} m`
  if (m < 24 * 60) {
    const h = Math.floor(m / 60)
    const r = m % 60
    return r ? `in ${h} h ${r} m` : `in ${h} h`
  }
  const days = Math.round(d / 86400000)
  if (days <= 7) return `${new Date(ts).toLocaleDateString('en-PH', { weekday: 'short' })} · in ${days} day${days !== 1 ? 's' : ''}`
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// Elapsed time since going live. Instant meetings stamp scheduledAt at go-live,
// so "now - scheduledAt" is the true elapsed for them (and a close-enough one
// for scheduled meetings started around their planned time).
function fmtElapsed(ms) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} m ago`
}

export default function OnlineClassesTab() {
  const { classes, meetings, saveMeetLink, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting } = useData()
  const { toast } = useUI()
  const [panel, setPanel] = useState('links')
  const [goingLive, setGoingLive] = useState('') // key of the link currently going live

  // Half-minute tick so the countdown/elapsed pills stay fresh while open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

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
  // The live hero (pinned above every panel) owns live sessions; the upcoming
  // list shows only the still-scheduled ones so nothing renders twice.
  const liveNow = useMemo(() => upcoming.filter(m => m.status === 'live'), [upcoming])
  const scheduledOnly = useMemo(() => upcoming.filter(m => m.status === 'scheduled'), [upcoming])

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
  const linkedCount = useMemo(() =>
    activeClasses.filter(c =>
      (c.meetLink || '').trim() || Object.values(c.meetLinks || {}).some(v => (v || '').trim())
    ).length,
    [activeClasses]
  )

  const subtitle = [
    liveNow.length ? `${liveNow.length} live now` : null,
    `${scheduledOnly.length} upcoming`,
    `${linkedCount} of ${activeClasses.length} class${activeClasses.length !== 1 ? 'es' : ''} linked`,
  ].filter(Boolean).join(' · ')

  return (
    <>
    <PageHeader title="Online Classes" subtitle={subtitle} />
    <div className="online-classes-tab" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      <div className="seg-filter">
        <button className={`seg-btn${panel === 'links' ? ' active' : ''}`} onClick={() => setPanel('links')}>
          <Video size={14} /> Meet Links <span className="seg-count">{linkedCount}</span>
        </button>
        <button className={`seg-btn${panel === 'schedule' ? ' active' : ''}`} onClick={() => setPanel('schedule')}>
          <CalendarPlus size={14} /> Schedule
        </button>
        <button className={`seg-btn${panel === 'meetings' ? ' active' : ''}`} onClick={() => setPanel('meetings')}>
          <Clock size={14} /> Meetings{' '}
          <span className={`seg-count${liveNow.length ? ' seg-count-live' : ''}`}>
            {liveNow.length ? `● ${liveNow.length}` : scheduledOnly.length}
          </span>
        </button>
      </div>

      {/* Live hero: pinned above every panel so an ongoing class is unmissable. */}
      {liveNow.map(m => (
        <div key={m.id} className="card olc-hero">
          <span className="olc-pulse"><Radio size={17} /></span>
          <div className="olc-hero-t">
            <b>{m.title} <span className="olc-live-chip">LIVE</span></b>
            <span>{m.className}{m.subject ? ` · ${m.subject}` : ''} · started {fmtElapsed(now - m.scheduledAt)}</span>
          </div>
          <div className="olc-hero-actions">
            {!!m.meetLink?.trim() && (
              <button className="btn btn-primary btn-sm" onClick={() => window.open(m.meetLink, '_blank', 'noopener,noreferrer')} title="Open the Meet in a new tab">
                <ExternalLink size={14} style={{ marginRight: 4 }} /> Open Meet
              </button>
            )}
            <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff' }} onClick={() => handleEnd(m)} title="End the class for everyone">
              <VideoOff size={14} style={{ marginRight: 4 }} /> End class
            </button>
          </div>
        </div>
      ))}

      {/* Section 1 - Class Meet Links */}
      {panel === 'links' && <section>
        {activeClasses.length === 0 && (
          <EmptyState Icon={Video} title="No classes found." text="Add classes first." />
        )}
        <div className="olc-grid">
          {activeClasses.map(cls => {
            const subjects = cls.subjects?.length ? cls.subjects : null
            return (
              <div key={cls.id} className="card" style={{ padding: 16 }}>
                <div className="olc-lc-h">
                  <span className="olc-lc-ic"><Video size={17} /></span>
                  <div className="olc-lc-name">
                    <b title={cls.name}>{courseShort(cls.name)}</b>
                    <span>{subjects ? `${subjects.length} subject${subjects.length !== 1 ? 's' : ''}` : 'No subjects yet'}</span>
                  </div>
                  {cls.section && <span className="olc-sec-chip">{cls.section}</span>}
                </div>

                {/* Per-subject Meet links */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(subjects || [null]).map(sub => {
                    const saved = sub ? (cls.meetLinks?.[sub] || '') : (cls.meetLink || '')
                    const val = getLinkDraft(cls.id, sub, saved)
                    return (
                      <div key={sub || '_general'}>
                        {sub && (
                          <div className="olc-sub-lb">
                            {sub}
                            {saved
                              ? <CheckCircle size={12} style={{ color: 'var(--green)' }} />
                              : <span className="olc-nolink">no link yet</span>}
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
                            style={{ marginTop: 6, width: '100%', background: 'var(--red)', color: '#fff' }}
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
      {panel === 'schedule' && <section className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div className="olc-lc-h" style={{ marginBottom: 14 }}>
          <span className="olc-lc-ic"><CalendarPlus size={17} /></span>
          <div className="olc-lc-name">
            <b>Schedule a meeting</b>
            <span>Students are notified as soon as it is saved</span>
          </div>
        </div>
        <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <div className="seg-filter mb-3">
          <button className={`seg-btn${listTab === 'upcoming' ? ' active' : ''}`} onClick={() => setListTab('upcoming')}>
            Upcoming <span className="seg-count">{scheduledOnly.length}</span>
          </button>
          <button className={`seg-btn${listTab === 'past' ? ' active' : ''}`} onClick={() => setListTab('past')}>
            Past <span className="seg-count">{past.length}</span>
          </button>
        </div>

        {listTab === 'upcoming' && (
          scheduledOnly.length === 0
            ? (liveNow.length
                ? <EmptyState Icon={CalendarPlus} title="No other upcoming meetings" text="Your live class is pinned above." tone="muted" compact />
                : <EmptyState Icon={CalendarPlus} title="No upcoming meetings" text="Schedule one, or go live straight from Meet Links." />)
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {scheduledOnly.map(m => <MeetingRow key={m.id} m={m} now={now} onStart={handleStart} onCancel={handleCancel} />)}
              </div>
        )}

        {listTab === 'past' && (
          past.length === 0
            ? <EmptyState Icon={CheckCircle} title="No past meetings" text="Ended classes will appear here." tone="muted" compact />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {past.map(m => <MeetingRow key={m.id} m={m} now={now} />)}
              </div>
        )}
      </section>}
    </div>
    </>
  )
}

function classLabel(cls) {
  return cls?.section ? `${courseShort(cls.name)} - ${cls.section}` : courseShort(cls?.name) || 'Class'
}

// One meeting as a date-chip row: calendar chip, title + meta, a countdown pill
// (amber inside 3 hours) or a green Ended chip, and Start/Cancel actions.
function MeetingRow({ m, now, onStart, onCancel }) {
  const dt = new Date(m.scheduledAt)
  const ended = m.status === 'ended'
  const mo = dt.toLocaleDateString('en-PH', { month: 'short' })
  const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  const soon = !ended && m.scheduledAt - now < 3 * 3600000
  // Duration only when it is trustworthy: endedAt is stamped at End, so guard
  // against docs that ended long after (or were backfilled without) a start.
  const durMs = ended && m.endedAt ? m.endedAt - m.scheduledAt : 0
  const durMin = durMs > 0 && durMs < 12 * 3600000 ? Math.max(1, Math.round(durMs / 60000)) : null

  return (
    <div className={`card olc-row${ended ? ' past' : ''}`}>
      <div className="olc-dchip">
        <span className="olc-dchip-mo">{mo}</span>
        <span className="olc-dchip-dy">{dt.getDate()}</span>
      </div>
      <div className="olc-row-t">
        <b>{m.title}</b>
        <span>{m.className}{m.subject ? ` · ${m.subject}` : ''} · {timeStr}{durMin ? ` · ${durMin} min` : ''}</span>
        {m.description && <span style={{ display: 'block' }}>{m.description}</span>}
      </div>
      {ended
        ? <span className="olc-cd olc-cd-done"><CheckCircle size={12} /> Ended</span>
        : <span className={`olc-cd${soon ? ' olc-cd-soon' : ''}`}>{fmtCountdown(m.scheduledAt, now)}</span>}
      {!ended && onStart && (
        <div className="olc-row-actions">
          <button className="btn btn-primary btn-sm" onClick={() => onStart(m)} title="Start meeting">
            <ExternalLink size={14} style={{ marginRight: 4 }} /> Start
          </button>
          {onCancel && (
            <button className="btn btn-ghost btn-sm" onClick={() => onCancel(m)} title="Cancel meeting">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
