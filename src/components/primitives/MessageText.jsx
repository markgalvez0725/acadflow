import React from 'react'
import MentionText from '@/components/primitives/MentionText'

// Renders a message-bubble body, highlighting any "@Name" spans that match the
// names on the entry's `mentions` list. Pre-wrapped block; the `.msg-mention`
// chip styles against both received and sent (filled) bubbles.
export default function MessageText({ text, mentions = [] }) {
  const names = (mentions || []).map(m => m?.name || m).filter(Boolean)
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      <MentionText text={text} names={names} className="msg-mention" />
    </div>
  )
}
