import React, { useState } from 'react'
import { Users, Check, ChevronDown, ChevronUp } from 'lucide-react'

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function Av({ s, size = 22 }) {
  return (
    <div className="gm-av" style={{ width: size, height: size, fontSize: Math.round(size / 2.4) }}>
      {s.photo ? <img src={s.photo} alt="" /> : initials(s.name)}
    </div>
  )
}

function seenLabel(ts) {
  if (!ts) return 'Seen'
  try {
    return 'Seen ' + new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch (e) { return 'Seen' }
}

// Group-chat member list + Messenger-style read receipts.
// `members` = student docs, `readerIds` = ids who've read, `readAt` = { id: ts }.
export default function GroupMembers({ members = [], readerIds = [], readAt = {} }) {
  const [open, setOpen] = useState(false)
  if (!members.length) return null

  const readerSet = new Set(readerIds)
  const readers = members.filter(s => readerSet.has(s.id))

  return (
    <div className="gm">
      <div className="gm-bar">
        <button className="gm-members-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Users size={13} /> {members.length} member{members.length !== 1 ? 's' : ''}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {readers.length > 0 && (
          <div className="gm-seen" title={`Seen by ${readers.length} of ${members.length}`}>
            <span className="gm-seen-label">Seen by</span>
            <div className="gm-avatars">
              {readers.slice(0, 6).map(s => <Av key={s.id} s={s} size={20} />)}
              {readers.length > 6 && <span className="gm-more">+{readers.length - 6}</span>}
            </div>
          </div>
        )}
      </div>

      {open && (
        <div className="gm-list">
          {members.map(s => {
            const seen = readerSet.has(s.id)
            return (
              <div className="gm-row" key={s.id}>
                <Av s={s} size={26} />
                <span className="gm-name">{s.name}</span>
                <span className={`gm-status${seen ? ' seen' : ''}`} title={seen ? seenLabel(readAt[s.id]) : 'Not seen yet'}>
                  {seen ? <><Check size={12} /> Seen</> : 'Not seen'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
