import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, VideoOff, Trash2, CheckCircle, Radio, Play, Info } from 'lucide-react'
import LiveMeetingRoom from '@/components/online/LiveMeetingRoom'

export default function OnlineClassesTab() {
  const { classes, meetings, admin, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting } = useData()
  const { toast } = useUI()
  const [panel, setPanel] = useState('start')
  const [room, setRoom] = useState(null) // meeting the teacher is hosting in the embedded room
  const [starting, setStarting] = useState('') // key of the class/subject currently spinning up

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  // ── Start now — spin up a live room immediately ───────────────────────
  async function handleInstant(cls, subject) {
    const key = subject ? `${cls.id}::${subject}` : cls.id
    setStarting(key)
    try {
      const m = await startInstantMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: null, // the title already carries the subject for instant rooms
        title: subject || `${cls.name} — live class`,
        description: '',
      })
      if (m) setRoom(m)
      else toast('Failed to start the meeting.', 'error')
    } catch (e) {
      toast('Failed to start the meeting.', 'error')
    } finally {
      setStarting('')
    }
  }

  // ── Schedule a meeting for later ──────────────────────────────────────
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
      await scheduleMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: form.subject || null,
        title: form.title.trim(),
        description: form.description.trim(),
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

  // ── Meetings list ─────────────────────────────────────────────────────
  const [listTab, setListTab] = useState('upcoming')
  const upcoming = useMemo(() =>
    meetings.filter(m => m.status === 'scheduled' || m.status === 'live')
      .sort((a, b) => a.scheduledAt - b.scheduledAt),
    [meetings]
  )
  const past = useMemo(() =>
    meetings.filter(m => m.status === 'ended')
      .sort((a, b) => b.scheduledAt - a.scheduledAt),
    [meetings]
  )

  async function handleStart(m) {
    try {
      await startMeeting(m)
      setRoom({ ...m, status: 'live' })
      toast('Meeting is now live. Students have been notified.', 'success')
    } catch (e) {
      toast('Failed to start meeting.', 'error')
    }
  }
  function handleJoin(m) { setRoom(m) }
  async function handleEnd(m) {
    try { await endMeeting(m); toast('Meeting ended.', 'success') }
    catch (e) { toast('Failed to end meeting.', 'error') }
  }
  async function handleCancel(m) {
    try { await cancelMeeting(m); toast('Meeting cancelled. Students have been notified.', 'success') }
    catch (e) { toast('Failed to cancel meeting.', 'error') }
  }

  const liveCount = useMemo(() => meetings.filter(m => m.status === 'live').length, [meetings])

  return (
    <div className="online-classes-tab" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      <section className="card" style={{ padding: 12, background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${panel === 'start' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPanel('start')}>
            <Radio size={14} /> Start now
          </button>
          <button className={`btn btn-sm ${panel === 'schedule' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPanel('schedule')}>
            <CalendarPlus size={14} /> Schedule
          </button>
          <button className={`btn btn-sm ${panel === 'meetings' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPanel('meetings')}>
            <Clock size={14} /> Meetings{liveCount > 0 ? ` · ${liveCount} live` : ''}
          </button>
        </div>
      </section>

      {/* Panel 1 — Start an instant class in the built-in room */}
      {panel === 'start' && <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Radio size={18} /> Start a live class
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink3)', margin: '0 0 12px' }}>
          Pick a class to open AcadFlow's built-in meeting room right now. Students in that class are notified and can join in one tap — no links to set up.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', marginBottom: 16, background: 'var(--accent-l)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 10 }}>
          <Info size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--ink)' }}>First time hosting?</strong> The video service (Jitsi) may ask you to sign in with a Google account the first time you start a class — this confirms you as the host. It's a one-time step per browser; do it a minute before class and students can join straight away.
          </div>
        </div>
        {activeClasses.length === 0 ? (
          <div className="empty"><div className="empty-icon"><Video size={36} /></div>No classes found. Add classes first.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {activeClasses.map(cls => {
              const subjects = cls.subjects?.length ? cls.subjects : null
              return (
                <div key={cls.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Video size={17} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cls.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{subjects ? `${subjects.length} subject${subjects.length !== 1 ? 's' : ''}` : 'No subjects yet'}</div>
                    </div>
                    {cls.section && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-l)', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>{cls.section}</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(subjects || [null]).map(sub => {
                      const key = sub ? `${cls.id}::${sub}` : cls.id
                      const busy = starting === key
                      return (
                        <div key={sub || '_general'} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sub || 'Class session'}
                          </span>
                          <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} disabled={!!starting} onClick={() => handleInstant(cls, sub)}>
                            <Play size={13} style={{ marginRight: 5 }} />{busy ? 'Starting…' : 'Start'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>}

      {/* Panel 2 — Schedule a meeting for later */}
      {panel === 'schedule' && <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarPlus size={18} /> Schedule a meeting
          </div>
        </div>
        <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Class</label>
              <select className="input" value={form.classId} onChange={e => setForm(f => ({ ...f, classId: e.target.value, subject: '' }))} required>
                <option value="">Select class...</option>
                {activeClasses.map(cls => (
                  <option key={cls.id} value={cls.id}>{classLabel(cls)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date & Time</label>
              <input className="input" type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
          </div>
          {scheduleClass?.subjects?.length > 0 && (
            <div>
              <label className="label">Subject <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional — names the session)</span></label>
              <select className="input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}>
                <option value="">No specific subject</option>
                {scheduleClass.subjects.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Meeting Title</label>
            <input className="input" placeholder="e.g. Chapter 5 Review" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea className="input" placeholder="Topics to be covered..." rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>
          <div>
            <button className="btn btn-primary" type="submit" disabled={scheduling}>
              <CalendarPlus size={15} style={{ marginRight: 6 }} />
              {scheduling ? 'Scheduling...' : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </section>}

      {/* Panel 3 — Meetings list */}
      {panel === 'meetings' && <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title">Meetings</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn btn-sm ${listTab === 'upcoming' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setListTab('upcoming')}>Upcoming</button>
            <button className={`btn btn-sm ${listTab === 'past' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setListTab('past')}>Past</button>
          </div>
        </div>

        {listTab === 'upcoming' && (
          upcoming.length === 0
            ? <div className="empty"><div className="empty-icon"><CalendarPlus size={36} /></div>No upcoming meetings.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {upcoming.map(m => <MeetingRow key={m.id} m={m} onStart={handleStart} onJoin={handleJoin} onEnd={handleEnd} onCancel={handleCancel} />)}
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

      {room && (
        <LiveMeetingRoom
          meeting={room}
          displayName={admin?.name || admin?.displayName || 'Teacher'}
          email={admin?.email}
          isHost
          subtitle={room.className || 'Online class'}
          onLeave={() => setRoom(null)} // step out, keep the class running
          onEnd={() => {
            const m = room
            setRoom(null)
            // End for everyone — flip it out of "live" so students stop seeing it.
            if (m && m.status !== 'ended') endMeeting(m).catch(() => {})
          }}
        />
      )}
    </div>
  )
}

function classLabel(cls) {
  return cls?.section ? `${cls.name} - ${cls.section}` : cls?.name || 'Class'
}

function MeetingRow({ m, onStart, onJoin, onEnd, onCancel }) {
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
            <Video size={14} style={{ marginRight: 4 }} /> Start
          </button>
        )}
        {m.status === 'scheduled' && onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(m)} title="Cancel meeting">
            <Trash2 size={14} />
          </button>
        )}
        {m.status === 'live' && onJoin && (
          <button className="btn btn-primary btn-sm" onClick={() => onJoin(m)} title="Rejoin meeting">
            <Radio size={14} style={{ marginRight: 4 }} /> Join
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
