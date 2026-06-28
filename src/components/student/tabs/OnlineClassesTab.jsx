import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import {
  Video, Radio, ExternalLink, Clock, ChevronDown, ChevronUp,
  ShieldCheck, ArrowRight, Unlink, CheckCircle2,
} from 'lucide-react'
import { activeClassIds } from '@/utils/active'
import { courseShort } from '@/constants/courses'
import EmptyState from '@/components/ds/EmptyState'

const IMMINENT_MS = 15 * 60 * 1000 // a class "starting soon" - show one-tap join

// Re-render on an interval so countdowns stay live while the tab is open.
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef(null)
  useEffect(() => {
    ref.current = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(ref.current)
  }, [intervalMs])
  return now
}

function untilLabel(ms) {
  if (ms <= 0) return 'now'
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d > 0) return `in ${d}d ${h % 24}h`
  if (h > 0) return `in ${h}h ${m % 60}m`
  if (m > 0) return `in ${m}m`
  return `in ${Math.max(1, Math.ceil(ms / 1000))}s`
}

function meetingClassLabel(meeting, classNameById) {
  const base = meeting.className || classNameById[meeting.classId] || 'Class'
  return meeting.subject ? `${base} · ${meeting.subject}` : base
}

export default function OnlineClassesTab({ student }) {
  const { meetings, classes, semester } = useData()
  const now = useNow(30000)

  const studentClassIds = useMemo(
    () => activeClassIds(student, classes, semester),
    [student, classes, semester]
  )

  const myMeetings = useMemo(() =>
    meetings.filter(m => studentClassIds.includes(m.classId)),
    [meetings, studentClassIds]
  )

  const liveMeetings = useMemo(() =>
    myMeetings.filter(m => m.status === 'live'),
    [myMeetings]
  )

  const upcoming = useMemo(() =>
    myMeetings.filter(m => m.status === 'scheduled').sort((a, b) => a.scheduledAt - b.scheduledAt),
    [myMeetings]
  )

  const past = useMemo(() =>
    myMeetings.filter(m => m.status === 'ended').sort((a, b) => b.scheduledAt - a.scheduledAt),
    [myMeetings]
  )

  const [pastOpen, setPastOpen] = useState(false)

  const classNameById = useMemo(() => {
    const map = {}
    classes.forEach(c => { map[c.id] = c.section ? `${courseShort(c.name)} - ${c.section}` : courseShort(c.name) })
    return map
  }, [classes])

  // Deterministic "Session Watch" - live now, next up, missing link. Recomputed
  // from the same meetings the list renders. no network calls.
  const watch = useMemo(() => {
    const f = []
    const noLink = upcoming.filter(m => !m.meetLink)
    if (liveMeetings.length)
      f.push({ tone: 'bad', Icon: Radio, lead: `${liveMeetings.length} live now`, text: ` - ${liveMeetings[0].title}, join in one tap.` })
    if (upcoming.length) {
      const n = upcoming[0]
      f.push({ tone: 'info', Icon: ArrowRight, lead: 'Next', text: ` - ${n.title}, ${untilLabel(n.scheduledAt - now)}.` })
    }
    if (noLink.length)
      f.push({ tone: 'warn', Icon: Unlink, lead: 'No link yet', text: ` - ${noLink[0].title}${noLink.length > 1 ? ` +${noLink.length - 1}` : ''}.` })
    if (!f.length)
      f.push({ tone: 'good', Icon: CheckCircle2, lead: 'All quiet', text: ' - no live or upcoming classes right now.' })
    const lead = liveMeetings.length
      ? `${liveMeetings.length} class${liveMeetings.length > 1 ? 'es are' : ' is'} live${upcoming.length ? ` · ${upcoming.length} upcoming` : ''}.`
      : upcoming.length ? `Next class ${untilLabel(upcoming[0].scheduledAt - now)}.`
      : 'No online classes scheduled.'
    return { findings: f.slice(0, 4), lead }
  }, [liveMeetings, upcoming, now])

  if (!student) return null

  if (!myMeetings.length) {
    return (
      <EmptyState
        Icon={Video}
        title="No online classes yet"
        text="Your professor's scheduled and live sessions will appear here."
      />
    )
  }

  const heroLive = liveMeetings[0]
  const heroNext = !heroLive ? upcoming[0] : null
  const heroNextMs = heroNext ? heroNext.scheduledAt - now : 0
  const heroNextSoon = heroNext && heroNextMs <= IMMINENT_MS

  return (
    <div className="pb-4">
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Online classes</div>

      {/* Up next / Live hero + Session Watch */}
      <div className="oc-top">
        {heroLive ? (
          <div className="sact-card" style={{ padding: 16, borderColor: '#ef4444', background: 'rgba(239,68,68,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <span className="oc-dot oc-pulse" style={{ background: '#ef4444' }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', letterSpacing: '0.08em' }}>LIVE NOW</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{heroLive.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', margin: '3px 0 12px' }}>{meetingClassLabel(heroLive, classNameById)}</div>
            {heroLive.meetLink ? (
              <a href={heroLive.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ background: '#ef4444', borderColor: '#ef4444' }}>
                <ExternalLink size={14} style={{ marginRight: 6 }} /> Join meeting
              </a>
            ) : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Link not set yet</span>}
          </div>
        ) : heroNext ? (
          <div className="sact-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Up next</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{heroNext.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', margin: '3px 0 6px' }}>{meetingClassLabel(heroNext, classNameById)}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: heroNextSoon ? 'var(--accent)' : 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12 }}>
              <Clock size={14} /> starts {untilLabel(heroNextMs)}
            </div>
            {heroNext.meetLink ? (
              <a href={heroNext.meetLink} target="_blank" rel="noopener noreferrer" className={`btn btn-sm ${heroNextSoon ? 'btn-primary' : 'btn-ghost'}`}>
                <ExternalLink size={14} style={{ marginRight: 6 }} /> Join
              </a>
            ) : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Link not set yet</span>}
          </div>
        ) : (
          <div className="sact-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Video size={24} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>No classes scheduled</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Your professor's online sessions will appear here.</div>
            </div>
          </div>
        )}

        <div className="sact-card sact-watch">
          <div className="sact-watch-h">
            <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Session Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          <div className="sact-watch-lead">{watch.lead}</div>
          {watch.findings.map((fd, i) => (
            <div key={i} className={`sact-find sact-find-${fd.tone}`}>
              <fd.Icon size={16} />
              <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Live now */}
      {liveMeetings.length > 0 && (
        <>
          <div className="oc-sec-h first"><span className="oc-dot oc-pulse" style={{ background: '#ef4444' }} /> Live now · {liveMeetings.length}</div>
          <div className="sact-card" style={{ borderColor: '#ef4444' }}>
            {liveMeetings.map(m => (
              <div key={m.id} className="oc-row">
                <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <Radio size={13} className="animate-pulse" /> LIVE
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{meetingClassLabel(m, classNameById)}</div>
                </div>
                {m.meetLink ? (
                  <a href={m.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ background: '#ef4444', borderColor: '#ef4444', flexShrink: 0 }}>
                    <ExternalLink size={13} style={{ marginRight: 5 }} /> Join
                  </a>
                ) : <span style={{ fontSize: 12, color: 'var(--ink3)', flexShrink: 0 }}>Link not set</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Upcoming */}
      <div className={`oc-sec-h ${liveMeetings.length ? '' : 'first'}`}><Video size={13} /> Upcoming · {upcoming.length}</div>
      {upcoming.length === 0 ? (
        <EmptyState Icon={Video} title="No upcoming online classes scheduled." compact />
      ) : (
        <div className="sact-card">
          {upcoming.map(m => {
            const dt = new Date(m.scheduledAt)
            const dateStr = dt.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
            const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
            const ms = m.scheduledAt - now
            const soon = ms <= IMMINENT_MS
            return (
              <div key={m.id} className="oc-row">
                <span className="oc-dot" style={{ background: soon ? 'var(--accent)' : '#888780' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: soon ? 'var(--accent)' : 'var(--ink3)', fontWeight: soon ? 600 : 400 }}>
                    {meetingClassLabel(m, classNameById)} · {dateStr} {timeStr} · starts {untilLabel(ms)}
                  </div>
                  {m.description && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>{m.description}</div>}
                </div>
                {m.meetLink ? (
                  <a href={m.meetLink} target="_blank" rel="noopener noreferrer" className={`btn btn-sm ${soon ? 'btn-primary' : 'btn-ghost'}`} style={{ flexShrink: 0 }}>
                    <ExternalLink size={13} style={{ marginRight: 5 }} /> Join
                  </a>
                ) : <span style={{ fontSize: 11.5, color: 'var(--ink3)', flexShrink: 0 }}>Link soon</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Past sessions */}
      <div className="oc-sec-h"><Clock size={13} /> History</div>
      <button className="oc-hist-btn" onClick={() => setPastOpen(o => !o)}>
        {pastOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Past sessions ({past.length})
      </button>
      {pastOpen && past.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {past.map(m => {
            const dt = new Date(m.endedAt || m.scheduledAt)
            const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
            return (
              <div key={m.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{m.title}</span>
                <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>{meetingClassLabel(m, classNameById)}</span>
                <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>· {dateStr}</span>
              </div>
            )
          })}
        </div>
      )}
      {pastOpen && past.length === 0 && (
        <div style={{ marginTop: 10 }}>
          <EmptyState Icon={Clock} title="No past sessions yet." compact />
        </div>
      )}
    </div>
  )
}
