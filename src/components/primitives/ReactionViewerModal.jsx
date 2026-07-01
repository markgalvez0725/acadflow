import React, { useMemo, useState } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import EmojiIcon from '@/components/primitives/EmojiIcon'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { SmilePlus } from 'lucide-react'
import { reactionEntries } from '@/utils/reactions'

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// Resolve a reaction reader id to a display person. Reader ids are student ids
// or 'admin' (the professor), so we look up the live roster and fall back to the
// professor profile for 'admin'.
function resolvePerson(id, students, admin) {
  if (id === 'admin') return { id, name: (admin?.name || '').trim() || 'Professor', photo: admin?.photo || null, isProf: true }
  const s = (students || []).find(x => x.id === id)
  return { id, name: s?.name || 'Unknown', photo: s?.photo || null, student: s || null }
}

// Who-reacted viewer: avatar + name (+ verified badge) + the emoji each person
// used, with a per-emoji filter and "You" highlighted. Opened by a long-press /
// right-click on a message's reaction pills. `onToggle(emoji)` (optional) lets you
// remove your own reaction here; the sheet is drag-to-dismiss on mobile.
export default function ReactionViewerModal({ reactions, students, admin, myId, onToggle, onClose }) {
  const entries = reactionEntries(reactions)
  const [tab, setTab] = useState('all')

  const rows = useMemo(() => {
    const out = []
    entries.forEach(([emoji, ids]) => (ids || []).forEach(id => out.push({ emoji, person: resolvePerson(id, students, admin) })))
    return out
  }, [entries, students, admin])

  const total = rows.length
  const shown = tab === 'all' ? rows : rows.filter(r => r.emoji === tab)

  return (
    <Modal onClose={onClose} size="sm" sheetOnMobile draggable
      header={<ModalHeader flush icon={<SmilePlus size={18} />} title="Reactions" subtitle={`${total} ${total === 1 ? 'person' : 'people'}`} />}
    >
      {entries.length > 1 && (
        <div className="rv-tabs">
          <button type="button" className={`rv-tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
            All <span className="rv-tab-n">{total}</span>
          </button>
          {entries.map(([emoji, ids]) => (
            <button type="button" key={emoji} className={`rv-tab${tab === emoji ? ' on' : ''}`} onClick={() => setTab(emoji)}>
              <EmojiIcon emoji={emoji} size={15} /> <span className="rv-tab-n">{ids.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="gm-list rv-list">
        {shown.map(({ emoji, person }) => {
          const isMe = person.id === myId
          return (
            <div className={`gm-row${isMe ? ' rv-me-row' : ''}`} key={person.id + '_' + emoji}>
              <div className="gm-av" style={{ width: 32, height: 32, fontSize: 13 }}>
                {person.photo ? <img src={person.photo} alt="" /> : initials(person.name)}
              </div>
              <span className="gm-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {isMe ? 'You' : person.name}
                {!isMe && person.student && <VerifiedBadge student={person.student} size={13} />}
                {person.isProf && <span className="rv-prof">professor</span>}
              </span>
              {isMe && onToggle && (
                <button type="button" className="rv-remove" onClick={() => { onToggle(emoji); onClose?.() }}>Remove</button>
              )}
              <EmojiIcon emoji={emoji} size={20} />
            </div>
          )
        })}
        {!shown.length && <div className="text-xs text-ink3" style={{ padding: '8px 6px' }}>No reactions.</div>}
      </div>
    </Modal>
  )
}
