import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { Video, Radio, ExternalLink, Clock, ChevronDown, ChevronUp } from 'lucide-react'

export default function OnlineClassesTab({ student }) {
  const { meetings } = useData()

  const studentClassIds = useMemo(() =>
    student
      ? (student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : []))
      : [],
    [student]
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
    myMeetings.filter(m => m.status === 'scheduled')
      .sort((a, b) => a.scheduledAt - b.scheduledAt),
    [myMeetings]
  )

  const past = useMemo(() =>
    myMeetings.filter(m => m.status === 'ended')
      .sort((a, b) => b.scheduledAt - a.scheduledAt),
    [myMeetings]
  )

  const [pastOpen, setPastOpen] = useState(false)

  if (!student) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Live Now Banners */}
      {liveMeetings.map(m => (
        <div key={m.id} style={{
          background: 'linear-gradient(135deg, #ef444422, #ef444408)',
          border: '1.5px solid #ef4444',
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Radio size={22} className="animate-pulse" style={{ color: '#ef4444' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', letterSpacing: '0.08em' }}>LIVE</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{m.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{m.className}</div>
          </div>
          {m.meetLink ? (
            <a
              href={m.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              style={{ flexShrink: 0 }}
            >
              <ExternalLink size={14} style={{ marginRight: 6 }} /> Join Meeting
            </a>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--ink3)', flexShrink: 0 }}>Link not set</span>
          )}
        </div>
      ))}

      {/* Upcoming Meetings */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={17} /> Upcoming Classes
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Video size={36} /></div>
            No upcoming online classes scheduled.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcoming.map(m => {
              const dt = new Date(m.scheduledAt)
              const dateStr = dt.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
              return (
                <div key={m.id} className="card" style={{ padding: '12px 16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{m.className}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {dateStr} at {timeStr}
                  </div>
                  {m.description && (
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      {m.description}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Past Sessions */}
      {past.length > 0 && (
        <section>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink2)', fontWeight: 600, fontSize: 14 }}
            onClick={() => setPastOpen(o => !o)}
          >
            {pastOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Past Sessions ({past.length})
          </button>
          {pastOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {past.map(m => {
                const dt = new Date(m.endedAt || m.scheduledAt)
                const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <div key={m.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>{m.className}</span>
                    <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>· {dateStr}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
