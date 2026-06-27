import React from 'react'
import { splitMentions } from '@/utils/mentions'

// Renders a message body, highlighting any "@Name" spans that match the names
// stored on the entry's `mentions` list. Plain text (pre-wrapped) when there are
// no mentions, so non-group bubbles are unaffected.
export default function MessageText({ text, mentions = [] }) {
  const names = (mentions || []).map(m => m?.name || m).filter(Boolean)
  if (!names.length) return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
  const parts = splitMentions(text, names)
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => p.mention
        ? <span key={i} className="msg-mention">{p.text}</span>
        : <React.Fragment key={i}>{p.text}</React.Fragment>)}
    </div>
  )
}
