import React from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { Check, Users } from 'lucide-react'

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function seenLabel(ts) {
  if (!ts) return 'Seen'
  try {
    return 'Seen ' + new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch (e) { return 'Seen' }
}

function Av({ s, size = 28 }) {
  return (
    <div className="gm-av" style={{ width: size, height: size, fontSize: Math.round(size / 2.4) }}>
      {s.photo ? <img src={s.photo} alt="" /> : initials(s.name)}
    </div>
  )
}

// Group-chat member list + Messenger-style read receipts, in a modal opened from
// the thread header's "See chat members" kebab action (replaces the old inline
// bottom bar). `members` = student docs, `readerIds` = ids who've read,
// `readAt` = { id: ts }.
export default function ChatMembersModal({ members = [], readerIds = [], readAt = {}, onClose }) {
  const readerSet = new Set(readerIds)
  const seenCount = members.filter(s => readerSet.has(s.id)).length

  return (
    <Modal onClose={onClose} size="sm" sheetOnMobile
      header={<ModalHeader flush icon={<Users size={18} />} title="Chat members" subtitle={`${members.length} member${members.length !== 1 ? 's' : ''} · seen by ${seenCount}`} />}
    >
      <div className="gm-list" style={{ maxHeight: '60vh' }}>
        {members.map(s => {
          const seen = readerSet.has(s.id)
          return (
            <div className="gm-row" key={s.id}>
              <Av s={s} size={28} />
              <span className="gm-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.name}<VerifiedBadge student={s} size={13} /></span>
              <span className={`gm-status${seen ? ' seen' : ''}`} title={seen ? seenLabel(readAt[s.id]) : 'Not seen yet'}>
                {seen ? <><Check size={12} /> Seen</> : 'Not seen'}
              </span>
            </div>
          )
        })}
        {!members.length && <div className="text-xs text-ink3" style={{ padding: '8px 6px' }}>No members yet.</div>}
      </div>
    </Modal>
  )
}
