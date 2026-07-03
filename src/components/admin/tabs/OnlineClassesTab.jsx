import React, { useState, useMemo, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, ExternalLink, VideoOff, Trash2, CheckCircle, Save, Radio, MonitorPlay, Sparkles, Play, Share2, FileText, Loader2, Users, MessageSquare, CircleDot, MonitorUp, Zap, Info, AlertTriangle, Check, Copy, CalendarCheck } from 'lucide-react'
import RecapModal from '@/components/meeting/RecapModal'
import RecordingPlayerModal from '@/components/meeting/RecordingPlayerModal'
import ClassAttendanceModal from '@/components/meeting/ClassAttendanceModal'
import { shareDriveFile, checkDriveVideoProcessedNow } from '@/utils/googleDrive'
import { listSessionIds, loadSession, clearSession } from '@/utils/transcriptAudio'
import { transcribeSession } from '@/utils/whisperTranscriber'
import { courseShort } from '@/constants/courses'
import { isValidUrl, parseFutureTs } from '@/utils/validators'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'
import { useRedirectHighlight } from '@/navigation/useRedirectHighlight'

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
  const { classes, meetings, saveMeetLink, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting, generateMeetingRecap, markMeetingRecordingReady, saveMeetingRecording, saveAnnouncement, pushAnnouncementNotifs, saveClassTranscript } = useData()
  // The room itself is hosted at the layout level (MeetingHost) so the call
  // survives tab navigation - this tab only opens it by id.
  const { toast, openMeetingRoom, openDialog } = useUI()
  const [panel, setPanel] = useState('links')
  const [goingLive, setGoingLive] = useState('') // key of the link currently going live
  // Recap/transcript panel: stores { id, tab } so the modal always shows the
  // fresh doc and lands on the tab the row button asked for.
  const [recapView, setRecapView] = useState(null)
  const [recapBusyId, setRecapBusyId] = useState('')
  const recapMeeting = recapView ? meetings.find(m => m.id === recapView.id) : null

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
    if (!isValidUrl(url)) { toast('Link must start with http:// or https://', 'error'); return }
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

  // One-click "Go live in app": create + start an in-app WebRTC meeting (no
  // Meet link involved) and drop the professor straight into the room.
  async function handleGoLiveInApp(cls, subject) {
    const key = linkKey(cls.id, subject) + '::app'
    setGoingLive(key)
    try {
      const live = await startInstantMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: subject || null,
        title: subject || `${cls.name} - live class`,
        description: '',
        meetLink: '',
        provider: 'inapp',
      })
      if (!live) { toast('Failed to go live.', 'error'); return }
      if (live.provider !== 'inapp') {
        // startInstantMeeting reuses an existing live session for this
        // class+subject; if that one is a Meet-link session, don't open a
        // half-empty in-app room next to it.
        toast('This class is already live with a Meet link. End it first to switch to an in-app room.', 'error')
        setPanel('meetings')
        return
      }
      openMeetingRoom(live.id)
      toast('You are live - students can join from their Online Classes tab.', 'success')
    } catch (e) {
      toast('Failed to go live.', 'error')
    } finally {
      setGoingLive('')
    }
  }

  // ── Section 2: Schedule Form ──────────────────────────────────────────
  const [form, setForm] = useState({ classId: '', subject: '', title: '', scheduledAt: '', description: '', where: 'inapp' })
  const [scheduling, setScheduling] = useState(false)
  const scheduleClass = classes.find(c => c.id === form.classId)
  // Link availability, LINK MODE ONLY (in-app rooms never need one): the
  // meeting uses the subject's saved link, else the class default. 'none'
  // blocks scheduling so students are never sent to a dead Join button.
  const schedSubjectLink = (form.subject && scheduleClass?.meetLinks?.[form.subject]) || ''
  const schedFallbackLink = scheduleClass?.meetLink || ''
  const linkStatus = form.where !== 'link' || !scheduleClass ? null
    : schedSubjectLink ? 'ok'
    : !form.subject && schedFallbackLink ? 'ok'
    : schedFallbackLink ? 'warn'
    : 'none'

  async function handleSchedule(e) {
    e.preventDefault()
    if (!form.classId || !form.title || !form.scheduledAt) return
    const ts = parseFutureTs(form.scheduledAt)
    if (!ts) { toast('Pick a future date and time.', 'error'); return }
    const cls = classes.find(c => c.id === form.classId)
    if (!cls) return
    const inapp = form.where === 'inapp'
    const meetLink = inapp ? '' : ((form.subject && cls.meetLinks?.[form.subject]) || cls.meetLink || '')
    // Never schedule a link-mode class nobody can join.
    if (!inapp && !meetLink) {
      toast('No Google Meet link saved for this class. Set one in Classes, or use the in-app room.', 'error')
      return
    }
    setScheduling(true)
    try {
      await scheduleMeeting({
        classId: cls.id,
        className: classLabel(cls),
        subject: form.subject || null,
        title: form.title.trim(),
        description: form.description.trim(),
        meetLink,
        provider: inapp ? 'inapp' : 'link',
        scheduledAt: ts,
      })
      toast('Meeting scheduled. Students have been notified.', 'success')
      setForm({ classId: '', subject: '', title: '', scheduledAt: '', description: '', where: 'inapp' })
    } catch (e) {
      toast('Failed to schedule meeting.', 'error')
    } finally {
      setScheduling(false)
    }
  }

  // ── Section 3: Meetings List ──────────────────────────────────────────
  const [listTab, setListTab] = useState('upcoming')
  // In-app recording player (Drive embed) - shared with the student tab.
  const [watchMeeting, setWatchMeeting] = useState(null)
  const [attnMeeting, setAttnMeeting] = useState(null)

  // On-device Whisper: which ended classes still have captured audio waiting
  // in this browser, and the progress of the run currently transcribing.
  const [audioIds, setAudioIds] = useState(() => new Set())
  const [genId, setGenId] = useState('')
  const [genText, setGenText] = useState('')
  useEffect(() => {
    let dead = false
    listSessionIds().then(ids => { if (!dead) setAudioIds(new Set(ids)) }).catch(() => {})
    return () => { dead = true }
  }, [meetings.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenTranscript(m) {
    if (genId) return
    setGenId(m.id)
    setGenText('Preparing…')
    try {
      const { segments, meta } = await loadSession(m.id)
      if (!segments.length) {
        toast('No transcript audio was captured for this class on this browser.', 'error')
        setAudioIds(prev => { const n = new Set(prev); n.delete(m.id); return n })
        return
      }
      const lines = await transcribeSession({
        segments,
        speakers: meta?.speakers || [],
        onProgress: ({ stage, pct }) => setGenText(stage === 'model' ? `Model ${pct}% (one time)` : `Transcribing ${pct}%`),
      })
      if (!lines.length) { toast('Whisper heard no clear speech in this class audio.', 'error'); return }
      setGenText('Building study notes…')
      await saveClassTranscript(m, lines)
      await clearSession(m.id).catch(() => {})
      setAudioIds(prev => { const n = new Set(prev); n.delete(m.id); return n })
      toast(`Transcript ready - ${lines.length} lines. The recap was generated from it too.`, 'success')
    } catch (e) {
      toast('Transcription failed: ' + (e?.message || 'engine error'), 'error')
    } finally {
      setGenId('')
      setGenText('')
    }
  }

  // Deep-links (e.g. the "Recording is ready to view" notification carries
  // link "meeting:{id}") land on this tab, but the row only exists once the
  // Meetings panel AND the right Upcoming/Past list are showing - switch both
  // before the highlight hook's scroll fires (160ms after the claim).
  const highlightId = useRedirectHighlight('meeting')
  useEffect(() => {
    if (!highlightId) return
    setPanel('meetings')
    const m = meetings.find(x => x.id === highlightId)
    if (m) setListTab(m.status === 'ended' ? 'past' : 'upcoming')
  }, [highlightId]) // eslint-disable-line react-hooks/exhaustive-deps
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
    if (m.provider === 'inapp') {
      try {
        await startMeeting(m)
        openMeetingRoom(m.id)
        toast('Meeting is now live. Students have been notified.', 'success')
      } catch (e) {
        toast('Failed to start meeting.', 'error')
      }
      return
    }
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

  // Share a class recording with the students: flips the Drive file to
  // anyone-with-link and posts it to the class Stream (Drive links
  // auto-preview there), notifying the class.
  async function handleShareRecording(m) {
    const rec = m.recording
    if (!rec?.link) return
    const ok = await openDialog({
      title: 'Share recording with the class?',
      msg: 'This makes the video viewable to anyone with the link and posts it to the class Stream.',
      type: 'info',
      confirmLabel: 'Share',
      showCancel: true,
    })
    if (!ok) return
    try {
      if (rec.driveId) await shareDriveFile(rec.driveId)
      const dt = new Date(m.scheduledAt)
      const announcement = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        type: 'general',
        classId: m.classId,
        classIds: [m.classId],
        subject: m.subject || null,
        title: `Class recording: ${m.title || 'Online class'}`,
        message: `The recording of our online class on ${dt.toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })} is now available. Watch it here:`,
        meetingLink: null,
        moduleLink: rec.link,
        referenceVideo: null,
        topics: null,
        createdAt: Date.now(),
        active: true,
        expiresAt: null,
        comments: [],
        attachments: [],
        pinned: false,
        publishAt: null,
      }
      await saveAnnouncement(announcement)
      await pushAnnouncementNotifs(announcement)
      // Stamp the share on the meeting doc: the professor's chip flips to
      // "Shared to class" and students' past rows gain their Watch button
      // off this flag (the merged link also backfills older docs).
      await saveMeetingRecording(m, { ...m.recording, sharedAt: Date.now() })
      toast('Recording shared to the class Stream.', 'success')
    } catch (e) {
      toast('Failed to share the recording.', 'error')
    }
  }

  // View a past in-app class's Smart Recap - generating it first if this
  // device wasn't the one that ended the class.
  async function handleRecap(m) {
    if (m.recap) { setRecapView({ id: m.id, tab: 'summary' }); return }
    setRecapBusyId(m.id)
    try {
      const r = await generateMeetingRecap(m)
      if (r) setRecapView({ id: m.id, tab: 'summary' })
      else toast('No transcript was captured for this class.', 'error')
    } catch (e) {
      toast('Failed to generate the recap.', 'error')
    } finally {
      setRecapBusyId('')
    }
  }

  // The transcript needs no recap: open the same panel on its Transcript tab.
  function handleTranscript(m) {
    setRecapView({ id: m.id, tab: 'transcript' })
  }

  // Click on the "Processing in Drive" pill: check Drive right now. Runs on a
  // user gesture, so it may open the Drive consent popup where the silent
  // background poller cannot.
  const [checkingId, setCheckingId] = useState('')
  async function handleCheckRecording(m) {
    if (checkingId) return
    setCheckingId(m.id)
    try {
      const done = await checkDriveVideoProcessedNow(m.recording?.driveId)
      if (done) {
        await markMeetingRecordingReady(m)
        toast('The recording is ready to view.', 'success')
      } else {
        toast('Drive is still processing the video. Give it a few more minutes.', 'info')
      }
    } catch {
      toast('Could not check Drive. Make sure your Google Drive is connected, then try again.', 'error')
    } finally {
      setCheckingId('')
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
            {m.provider === 'inapp' ? (
              <button className="btn btn-primary btn-sm" onClick={() => openMeetingRoom(m.id)} title="Open the in-app classroom">
                <MonitorPlay size={14} style={{ marginRight: 4 }} /> Open room
              </button>
            ) : !!m.meetLink?.trim() && (
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
                        ) : (
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ flex: 1 }}
                              disabled={goingLive === linkKey(cls.id, sub) + '::app'}
                              onClick={() => handleGoLiveInApp(cls, sub)}
                              title="Run the class inside AcadFlow - no Meet link needed (up to 60 people)"
                            >
                              <MonitorPlay size={13} style={{ marginRight: 5 }} />
                              {goingLive === linkKey(cls.id, sub) + '::app' ? 'Going live…' : 'Go live in app'}
                            </button>
                            {val.trim() && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ flex: 1 }}
                                disabled={goingLive === linkKey(cls.id, sub)}
                                onClick={() => handleGoLive(cls, sub, val)}
                                title="Start the class on Google Meet - students get a Join button"
                              >
                                <Radio size={13} style={{ marginRight: 5 }} />
                                {goingLive === linkKey(cls.id, sub) ? 'Going live…' : 'Go live on Meet'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>}

      {/* Section 2 - Schedule form. Venue-first: the in-app room is a real
          choice with its features on display, and link talk (status, class
          default fallback) appears ONLY in link mode - see linkStatus. */}
      {panel === 'schedule' && <section className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div className="olc-lc-h" style={{ marginBottom: 14 }}>
          <span className="olc-lc-ic"><CalendarPlus size={17} /></span>
          <div className="olc-lc-name">
            <b>Schedule a class</b>
            <span>Students are notified the moment it is saved</span>
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
              <label className="label">Date and time</label>
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
            <label className="label">Where</label>
            <div className="olc-where">
              <button
                type="button"
                className={`olc-wcard${form.where === 'inapp' ? ' on' : ''}`}
                aria-pressed={form.where === 'inapp'}
                onClick={() => setForm(f => ({ ...f, where: 'inapp' }))}
              >
                <span className="olc-wcard-h">
                  <Video size={15} />
                  <b>In-app room</b>
                  <span className="olc-wcard-badge">Recommended</span>
                </span>
                <span className="olc-wcard-sub">Runs inside AcadFlow, students join in one tap</span>
                <span className="olc-wcard-chips">
                  <span className="olc-wchip"><Users size={11} /> Up to 60</span>
                  <span className="olc-wchip"><MonitorUp size={11} /> Present</span>
                  <span className="olc-wchip"><MessageSquare size={11} /> Chat + reactions</span>
                  <span className="olc-wchip"><CircleDot size={11} /> Record to Drive</span>
                </span>
              </button>
              <button
                type="button"
                className={`olc-wcard${form.where === 'link' ? ' on' : ''}`}
                aria-pressed={form.where === 'link'}
                onClick={() => setForm(f => ({ ...f, where: 'link' }))}
              >
                <span className="olc-wcard-h">
                  <ExternalLink size={15} />
                  <b>Google Meet link</b>
                </span>
                <span className="olc-wcard-sub">Opens this subject's saved link in a new tab</span>
                <span className="olc-wcard-sub">Uses the link saved in Classes</span>
              </button>
            </div>
          </div>
          {scheduleClass?.subjects?.length > 0 && (
            <div>
              <label className="label">Subject</label>
              <select
                className="input"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              >
                <option value="">{form.where === 'link' ? 'Use the class default link' : 'No specific subject'}</option>
                {scheduleClass.subjects.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          {form.where === 'inapp' && scheduleClass?.subjects?.length > 0 && (
            <div className="olc-subhint" style={{ marginTop: -6 }}>
              <Info size={13} /> Names the room and the class card. No link needed.
            </div>
          )}
          {linkStatus === 'ok' && (
            <div className="olc-linkstat olc-linkstat-ok" style={{ marginTop: -6 }}>
              <Check size={13} /> {schedSubjectLink ? 'Link saved for this subject.' : 'Uses the class default link.'}
            </div>
          )}
          {linkStatus === 'warn' && (
            <div className="olc-linkstat olc-linkstat-warn" style={{ marginTop: -6 }}>
              <AlertTriangle size={13} /> No link saved for this subject. The class default link will be used.
            </div>
          )}
          {linkStatus === 'none' && (
            <div className="olc-linkstat olc-linkstat-bad" style={{ marginTop: -6 }}>
              <AlertTriangle size={13} /> No link saved for this class{form.subject ? ' or subject' : ''}. Set one in Classes, or use the in-app room.
            </div>
          )}
          <div>
            <label className="label">Class title</label>
            <input
              className="input"
              placeholder="Chapter 5 review"
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
          <div className="olc-form-foot">
            <button className="btn btn-primary" type="submit" disabled={scheduling || linkStatus === 'none'}>
              <CalendarPlus size={15} style={{ marginRight: 6 }} />
              {scheduling ? 'Scheduling...' : 'Schedule class'}
            </button>
            {form.where === 'inapp' && (
              <button
                className="btn"
                type="button"
                disabled={!!goingLive || scheduling}
                title="Skip scheduling - create the room and go live right now"
                onClick={() => {
                  const cls = classes.find(c => c.id === form.classId)
                  if (!cls) { toast('Pick a class first.', 'error'); return }
                  handleGoLiveInApp(cls, form.subject || null)
                }}
              >
                <Zap size={14} style={{ marginRight: 5 }} />
                {goingLive ? 'Starting...' : 'Go live now'}
              </button>
            )}
            <span className="olc-form-note">Notification sent right away</span>
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
                {scheduledOnly.map(m => <MeetingRow key={m.id} m={m} now={now} onStart={handleStart} onCancel={handleCancel} highlight={highlightId === m.id} />)}
              </div>
        )}

        {listTab === 'past' && (
          past.length === 0
            ? <EmptyState Icon={CheckCircle} title="No past meetings" text="Ended classes will appear here." tone="muted" compact />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {past.map(m => <MeetingRow key={m.id} m={m} now={now} onRecap={handleRecap} onTranscript={handleTranscript} recapBusy={recapBusyId === m.id} onShareRecording={handleShareRecording} onCheckRecording={handleCheckRecording} onWatch={setWatchMeeting} onAttendance={setAttnMeeting} onGenTranscript={audioIds.has(m.id) ? handleGenTranscript : undefined} genBusy={genId === m.id} genText={genText} genLocked={!!genId} checking={checkingId === m.id} highlight={highlightId === m.id} />)}
              </div>
        )}
      </section>}
    </div>

    {recapMeeting && <RecapModal meeting={recapMeeting} canManage initialTab={recapView.tab} onClose={() => setRecapView(null)} />}
    {watchMeeting && <RecordingPlayerModal meeting={watchMeeting} onClose={() => setWatchMeeting(null)} />}
    {attnMeeting && <ClassAttendanceModal meeting={attnMeeting} onClose={() => setAttnMeeting(null)} />}
    </>
  )
}

function classLabel(cls) {
  return cls?.section ? `${courseShort(cls.name)} - ${cls.section}` : courseShort(cls?.name) || 'Class'
}

// One meeting as a date-chip row: calendar chip, title + meta, a countdown pill
// (amber inside 3 hours) or a green Ended chip, and Start/Cancel actions.
function MeetingRow({ m, now, onStart, onCancel, onRecap, onTranscript, recapBusy, onShareRecording, onCheckRecording, onWatch, onAttendance, onGenTranscript, genBusy, genText, genLocked, checking, highlight }) {
  const { toast } = useUI()
  const dt = new Date(m.scheduledAt)
  const ended = m.status === 'ended'
  const mo = dt.toLocaleDateString('en-PH', { month: 'short' })
  const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  const soon = !ended && m.scheduledAt - now < 3 * 3600000
  // Duration only when it is trustworthy: endedAt is stamped at End, so guard
  // against docs that ended long after (or were backfilled without) a start.
  const durMs = ended && m.endedAt ? m.endedAt - m.scheduledAt : 0
  const durMin = durMs > 0 && durMs < 12 * 3600000 ? Math.max(1, Math.round(durMs / 60000)) : null
  // Older recordings may have saved without webViewLink - the Drive id alone
  // is enough to build a working view link. A recording stuck "processing"
  // for over 30 minutes fails OPEN (Drive is long done by then; only the doc
  // flag could not be updated).
  const rec = m.recording
  const recLink = rec?.link
    || (rec?.driveId ? `https://drive.google.com/file/d/${rec.driveId}/view` : '')
  const processing = !!rec && rec.status === 'processing'
    && now - Math.max(rec.at || 0, m.endedAt || 0) < 30 * 60000
  const hasRec = ended && !!(rec || recLink)
  const mb = rec?.bytes ? Math.max(1, Math.round(rec.bytes / 1048576)) : null

  return (
    <div id={`meeting-${m.id}`} className={`card olc-row${ended ? ' past' : ''}${hasRec ? ' olc-row-rec' : ''}${highlight ? ' redirect-glow' : ''}`}>
      <div className="olc-dchip">
        <span className="olc-dchip-mo">{mo}</span>
        <span className="olc-dchip-dy">{dt.getDate()}</span>
      </div>
      <div className="olc-row-t">
        <b>{m.title}</b>
        <span>{m.className}{m.subject ? ` · ${m.subject}` : ''} · {timeStr}{durMin ? ` · ${durMin} min` : ''}{m.provider === 'inapp' ? ' · In-app room' : ''}</span>
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
      {/* Attendance from the room's join log: in-app classes only, and only
          once there is a log (or a previous save) to open against. */}
      {ended && m.provider === 'inapp' && onAttendance && (m.joinLog?.length > 0 || m.attMarkedAt) && (
        <div className="olc-row-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onAttendance(m)}
            title={m.attMarkedAt ? 'Attendance was saved from this class - open to review or edit' : 'Prefill attendance from who joined this class'}
          >
            <CalendarCheck size={14} style={{ marginRight: 4 }} />
            {m.attMarkedAt ? 'Attendance saved' : 'Mark attendance'}
          </button>
        </div>
      )}
      {/* On-device Whisper: captured audio for this class is waiting in THIS
          browser - one click transcribes it locally (no key, no server). */}
      {ended && !m.recap && onGenTranscript && (
        <div className="olc-row-actions">
          <button
            className="btn btn-ghost btn-sm"
            disabled={genLocked && !genBusy}
            onClick={() => onGenTranscript(m)}
            title="Transcribe this class on this computer - the audio never leaves it"
          >
            {genBusy
              ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 4 }} /> {genText || 'Working…'}</>
              : <><FileText size={14} style={{ marginRight: 4 }} /> Generate transcript</>}
          </button>
        </div>
      )}
      {/* Live transcription was retired; classes that captured one keep
          their saved recap + transcript. On-device Whisper (above) fills
          this same viewer for newly recorded classes. */}
      {ended && m.recap && (onRecap || onTranscript) && (
        <div className="olc-row-actions">
          {onRecap && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={recapBusy}
              onClick={() => onRecap(m)}
              title="View the class recap"
            >
              <Sparkles size={14} style={{ marginRight: 4 }} /> {recapBusy ? 'Working…' : 'Recap'}
            </button>
          )}
          {onTranscript && (
            <button className="btn btn-ghost btn-sm" onClick={() => onTranscript(m)} title="Read the full class transcript">
              <FileText size={14} style={{ marginRight: 4 }} /> Transcript
            </button>
          )}
        </div>
      )}
      {/* Recording strip: thumbnail + status + Watch / Share / copy / Drive.
          The share state chip reads recording.sharedAt (stamped on Share). */}
      {hasRec && (
        <div className="olc-recstrip">
          <span className="olc-recthumb" aria-hidden="true">
            {!!rec?.driveId && !processing && (
              <img
                src={`https://drive.google.com/thumbnail?id=${rec.driveId}&sz=w220`}
                alt=""
                loading="lazy"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            )}
            <span className="olc-recplay"><Play size={12} /></span>
          </span>
          <div className="olc-rec-t">
            <span className="olc-rec-name">
              Class recording
              {processing ? (
                <button
                  className="olc-cd olc-cd-soon olc-cd-btn"
                  disabled={checking}
                  onClick={() => onCheckRecording && onCheckRecording(m)}
                  title="Drive is processing the video - click to check right now"
                >
                  <Loader2 size={12} className="animate-spin" /> {checking ? 'Checking…' : 'Processing in Drive'}
                </button>
              ) : rec?.sharedAt ? (
                <span className="olc-cd" title="Students can watch it from their Online Classes tab">
                  <Users size={12} /> Shared to class
                </span>
              ) : (
                <span className="olc-cd olc-cd-done" title="The recording is processed and ready to view">
                  <CheckCircle size={12} /> Ready
                </span>
              )}
            </span>
            <span className="olc-rec-meta">{durMin ? `${durMin} min · ` : ''}720p{mb ? ` · ${mb} MB` : ''}</span>
            {!!rec?.sharedAt && !processing && (
              <span className="olc-rec-note">Posted to the Stream, students can watch from their tab</span>
            )}
          </div>
          <div className="olc-rec-acts">
            {onWatch && (
              <button className="btn btn-ghost btn-sm" disabled={processing || !recLink} onClick={() => onWatch(m)} title="Watch inside AcadFlow">
                <Play size={14} style={{ marginRight: 4 }} /> Watch
              </button>
            )}
            {onShareRecording && recLink && (
              <button
                className={`btn btn-sm ${rec?.sharedAt ? 'btn-ghost' : 'btn-primary'}`}
                disabled={processing}
                onClick={() => onShareRecording({ ...m, recording: { ...rec, link: recLink } })}
                title={rec?.sharedAt ? 'Share the recording with the class again' : 'Make the video viewable by link, post it to the Stream, and notify the class'}
              >
                <Share2 size={14} style={{ marginRight: 4 }} /> {rec?.sharedAt ? 'Share again' : 'Share to class'}
              </button>
            )}
            {recLink && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { navigator.clipboard?.writeText(recLink); toast('Recording link copied.', 'success') }}
                title="Copy the video link"
              >
                <Copy size={14} />
              </button>
            )}
            {recLink && (
              <a className="btn btn-ghost btn-sm" href={recLink} target="_blank" rel="noopener noreferrer" title="Open in your Drive">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
