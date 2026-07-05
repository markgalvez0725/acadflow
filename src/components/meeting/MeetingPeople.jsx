import React, { useMemo, useState } from 'react'
import { X, Search, Mic, MicOff, Hand, UserX, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { LATE_THR_OPTIONS } from '@/utils/attendance'

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

const ST_CLASS = { present: 'ok', late: 'la', absent: 'ab' }
const ST_LABEL = { present: 'Present', late: 'Late', absent: 'Not joined' }

// Meet-style People panel: the whole class roster with join times, raised
// hands sorted first, the professor's room controls (mute one, mute all,
// remove), and - professor only - LIVE attendance: Present / Late / Not
// joined counted against the ENROLLED class list, a status pill per student
// (late judged from the scheduled start + the shared threshold), students
// who joined then left, and the enrolled students who never joined. Nothing
// here writes to the Attendance tab - the end-of-class sheet does that,
// prefilled with exactly what this panel shows. A student sees only their
// OWN status, on their self row. CSS renders the panel as a side panel next
// to the stage and a bottom sheet on phones (same treatment as the chat).
//   peers       - live peers from the engine (self is rendered separately)
//   roster      - enrolled students of this class (id, name, photo)
//   joinLog     - live log entries { uid, name, joinedAt, leftAt }
//   scheduledAt - class start the Late cutoff counts from
//   lateThr     - minutes after start that count as Late (shared preference)
//   onThrChange(minutes) / onMute(peer) / onMuteAll() / onRemove(peer)
//   onLowerHand(peer) / onClose()
export default function MeetingPeople({
  open, peers, self, micOn, isAdmin, photoOf,
  roster, joinLog, scheduledAt, lateThr, onThrChange,
  onMute, onMuteAll, onRemove, onLowerHand, onClose,
}) {
  const [q, setQ] = useState('')
  const [absOpen, setAbsOpen] = useState(false)

  const joinMap = useMemo(() => new Map((joinLog || []).map(e => [e.uid, e])), [joinLog])
  const cutoff = (scheduledAt || 0) + (lateThr || 15) * 60000
  const statusOf = uid => {
    const e = joinMap.get(uid)
    if (!e) return 'absent'
    return e.joinedAt > cutoff ? 'late' : 'present'
  }
  const timeStr = at => (at ? new Date(at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '')

  const rows = useMemo(() => {
    const list = peers.slice().sort((a, b) => {
      const ha = a.hand || 0, hb = b.hand || 0
      if (!!ha !== !!hb) return ha ? -1 : 1
      if (ha && hb) return ha - hb
      if ((a.role === 'admin') !== (b.role === 'admin')) return a.role === 'admin' ? -1 : 1
      return (a.joinedAt || 0) - (b.joinedAt || 0)
    })
    const needle = q.trim().toLowerCase()
    return needle ? list.filter(p => String(p.name || '').toLowerCase().includes(needle)) : list
  }, [peers, q])

  // Professor-only attendance groups, all counted against the ENROLLED list.
  const needle = q.trim().toLowerCase()
  const matches = name => !needle || String(name || '').toLowerCase().includes(needle)
  const liveUids = useMemo(() => new Set(peers.filter(p => p.role !== 'admin' && p.uid).map(p => p.uid)), [peers])
  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0 }
    for (const s of roster || []) c[statusOf(s.id)]++
    return c
  }, [roster, joinMap, cutoff]) // eslint-disable-line react-hooks/exhaustive-deps
  const leftRows = useMemo(() => (
    isAdmin
      ? (joinLog || []).filter(e => e.leftAt && !liveUids.has(e.uid) && matches(e.name))
          .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
      : []
  ), [joinLog, liveUids, isAdmin, needle]) // eslint-disable-line react-hooks/exhaustive-deps
  const absRows = useMemo(() => (
    isAdmin
      ? (roster || []).filter(s => !joinMap.has(s.id) && matches(s.name))
      : []
  ), [roster, joinMap, isAdmin, needle]) // eslint-disable-line react-hooks/exhaustive-deps
  const rosterById = useMemo(() => new Map((roster || []).map(s => [s.id, s])), [roster])

  if (!open) return null

  const students = peers.filter(p => p.role !== 'admin')
  const unmuted = students.filter(p => p.micOn !== false).length

  // A student's own status (their self row is the only place they see one).
  const selfEntry = self?.role !== 'admin' ? joinMap.get(self?.uid) : null
  const selfStatus = selfEntry ? (selfEntry.joinedAt > cutoff ? 'late' : 'present') : null

  return (
    <aside className="mr-people" aria-label="People in this class">
      <div className="mr-people-head">
        <span>In class</span>
        <span className="mr-people-count">{peers.length + 1}</span>
        <button className="mr-people-x" onClick={onClose} aria-label="Close the people panel"><X size={16} /></button>
      </div>
      {isAdmin && students.length > 0 && (
        <button className="mr-people-muteall" onClick={onMuteAll} disabled={unmuted === 0}>
          <MicOff size={14} />
          {unmuted === 0 ? 'All students are muted' : 'Mute all students'}
        </button>
      )}
      {isAdmin && (
        <div className="mr-people-att">
          <div className="mr-people-att-chips">
            <span className="mr-att-pill ok">Present {counts.present}</span>
            <span className="mr-att-pill la">Late {counts.late}</span>
            <span className="mr-att-pill ab">Not joined {counts.absent}</span>
          </div>
          <div className="mr-people-thr">
            <Clock size={12} /> Late after
            <span className="mr-people-seg">
              {LATE_THR_OPTIONS.map(v => (
                <button key={v} type="button" className={lateThr === v ? 'on' : ''} onClick={() => onThrChange?.(v)}>{v}m</button>
              ))}
            </span>
          </div>
        </div>
      )}
      <label className="mr-people-search">
        <Search size={14} />
        <input
          type="text"
          value={q}
          placeholder="Find a student"
          onChange={e => setQ(e.target.value)}
          style={{ border: 'none', outline: 'none', background: 'transparent', appearance: 'none' }}
        />
      </label>
      <div className="mr-people-list">
        <div className="mr-people-row">
          <span className="mr-people-av" aria-hidden="true">
            {photoOf?.(self) ? <img src={photoOf(self)} alt="" /> : initials(self?.name)}
          </span>
          <div className="mr-people-body">
            <div className="mr-people-name">
              <b>{self?.name} (you)</b>
              {self?.role === 'admin' && <span className="mr-chat-prof">PROF</span>}
            </div>
            {selfEntry && (
              <div className="mr-people-sub">
                {`Joined ${timeStr(selfEntry.joinedAt)}`}
                {selfStatus === 'late' ? ` · late after ${timeStr(cutoff)}` : ''}
              </div>
            )}
          </div>
          {selfStatus && <span className={`mr-att-pill ${ST_CLASS[selfStatus]}`}>{ST_LABEL[selfStatus]}</span>}
          <span className={`mr-people-mic${micOn ? '' : ' off'}`}>{micOn ? <Mic size={14} /> : <MicOff size={14} />}</span>
        </div>
        {rows.map(p => {
          const photo = photoOf?.(p)
          const student = p.role !== 'admin'
          const st = isAdmin && student && p.uid ? statusOf(p.uid) : null
          return (
            <div key={p.peerId} className="mr-people-row">
              <span className="mr-people-av" aria-hidden="true">
                {photo ? <img src={photo} alt="" /> : initials(p.name)}
              </span>
              <div className="mr-people-body">
                <div className="mr-people-name">
                  <b>{p.name}</b>
                  {p.role === 'admin' && <span className="mr-chat-prof">PROF</span>}
                  {p.quality && <span className={`mr-qdot mr-qdot-${p.quality}`} aria-hidden="true" />}
                </div>
                <div className={`mr-people-sub${p.hand ? ' hand' : ''}`}>
                  {p.hand
                    ? <><Hand size={11} /> raised a hand</>
                    : `Joined ${timeStr((joinMap.get(p.uid) || p).joinedAt)}`}
                </div>
              </div>
              {st && <span className={`mr-att-pill ${ST_CLASS[st]}`}>{ST_LABEL[st]}</span>}
              {isAdmin && p.hand && (
                <button className="mr-people-act" onClick={() => onLowerHand?.(p)} title="Lower this hand">
                  <Hand size={14} />
                </button>
              )}
              {isAdmin && student ? (
                <>
                  <button
                    className="mr-people-act"
                    onClick={() => onMute?.(p)}
                    disabled={p.micOn === false}
                    title={p.micOn === false ? 'Already muted' : 'Mute this student'}
                  >
                    <MicOff size={14} />
                  </button>
                  <button className="mr-people-act danger" onClick={() => onRemove?.(p)} title="Remove from class">
                    <UserX size={14} />
                  </button>
                </>
              ) : (
                <span className={`mr-people-mic${p.micOn !== false ? '' : ' off'}`}>
                  {p.micOn !== false ? <Mic size={14} /> : <MicOff size={14} />}
                </span>
              )}
            </div>
          )
        })}
        {leftRows.length > 0 && (
          <>
            <div className="mr-people-gh">Left the class · {leftRows.length}</div>
            {leftRows.map(e => {
              const s = rosterById.get(e.uid)
              const st = statusOf(e.uid)
              return (
                <div key={e.uid} className="mr-people-row dim">
                  <span className="mr-people-av" aria-hidden="true">
                    {s?.photo ? <img src={s.photo} alt="" /> : initials(e.name)}
                  </span>
                  <div className="mr-people-body">
                    <div className="mr-people-name"><b>{e.name}</b></div>
                    <div className="mr-people-sub">{`Joined ${timeStr(e.joinedAt)} · left ${timeStr(e.leftAt)}`}</div>
                  </div>
                  <span className={`mr-att-pill ${ST_CLASS[st]}`}>{ST_LABEL[st]}</span>
                </div>
              )
            })}
          </>
        )}
        {absRows.length > 0 && (
          <>
            <button type="button" className="mr-people-gh mr-people-ghbtn" onClick={() => setAbsOpen(o => !o)}>
              Not yet joined · {absRows.length}
              {absOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {absOpen && absRows.map(s => (
              <div key={s.id} className="mr-people-row dim">
                <span className="mr-people-av" aria-hidden="true">
                  {s.photo ? <img src={s.photo} alt="" /> : initials(s.name)}
                </span>
                <div className="mr-people-body">
                  <div className="mr-people-name"><b>{s.name}</b></div>
                  <div className="mr-people-sub">not in class</div>
                </div>
                <span className="mr-att-pill ab">Not joined</span>
              </div>
            ))}
          </>
        )}
        {rows.length === 0 && leftRows.length === 0 && absRows.length === 0 && (
          <div className="mr-people-empty">Nobody matches that name.</div>
        )}
      </div>
      {isAdmin && (
        <div className="mr-people-note">
          Live view only. Statuses save when you press End class, on the attendance sheet, and stay editable there.
        </div>
      )}
    </aside>
  )
}
