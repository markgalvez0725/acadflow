import React, { useMemo, useState } from 'react'
import { X, Search, Mic, MicOff, Hand, UserX } from 'lucide-react'

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// Meet-style People panel: the whole class roster with join times, raised
// hands sorted first, and - for the professor - the room controls (mute one,
// mute all, remove). This is what makes host controls reach EVERY student,
// including the ones collapsed behind the "+K others" stage tile. Students
// get the same list read-only. The CSS renders it as a side panel next to
// the stage and as a bottom sheet on phones (same treatment as the chat).
//   peers    - live peers from the engine (self is rendered separately, first)
//   self     - { uid, name, role }
//   micOn    - own mic state, for the self row's badge
//   isAdmin  - shows the professor controls
//   photoOf  - (peer) -> profile photo URL or null
//   onMute(peer) / onMuteAll() / onRemove(peer) / onLowerHand(peer) / onClose()
export default function MeetingPeople({ open, peers, self, micOn, isAdmin, photoOf, onMute, onMuteAll, onRemove, onLowerHand, onClose }) {
  const [q, setQ] = useState('')

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

  if (!open) return null

  const students = peers.filter(p => p.role !== 'admin')
  const unmuted = students.filter(p => p.micOn !== false).length
  const timeStr = at => (at ? new Date(at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '')

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
          </div>
          <span className={`mr-people-mic${micOn ? '' : ' off'}`}>{micOn ? <Mic size={14} /> : <MicOff size={14} />}</span>
        </div>
        {rows.map(p => {
          const photo = photoOf?.(p)
          const student = p.role !== 'admin'
          return (
            <div key={p.peerId} className="mr-people-row">
              <span className="mr-people-av" aria-hidden="true">
                {photo ? <img src={photo} alt="" /> : initials(p.name)}
              </span>
              <div className="mr-people-body">
                <div className="mr-people-name">
                  <b>{p.name}</b>
                  {p.role === 'admin' && <span className="mr-chat-prof">PROF</span>}
                  <span className={`mr-qdot mr-qdot-${p.quality || 'good'}`} aria-hidden="true" />
                </div>
                <div className={`mr-people-sub${p.hand ? ' hand' : ''}`}>
                  {p.hand
                    ? <><Hand size={11} /> raised a hand</>
                    : `Joined ${timeStr(p.joinedAt)}`}
                </div>
              </div>
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
        {rows.length === 0 && (
          <div className="mr-people-empty">Nobody matches that name.</div>
        )}
      </div>
    </aside>
  )
}
