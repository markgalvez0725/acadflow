import React from 'react'
import { splitMentions } from '@/utils/mentions'

// Renders inline text, wrapping any "@Name" span that matches one of `names` in
// a highlight chip (className). No wrapper element - the caller supplies it - so
// this works inside a message bubble, a comment line, or anywhere else. Plain
// text when there are no names to match.
export default function MentionText({ text, names = [], className = 'mention-hl' }) {
  const valid = (names || []).filter(Boolean)
  if (!valid.length) return <>{text}</>
  return (
    <>
      {splitMentions(text, valid).map((p, i) => p.mention
        ? <span key={i} className={className}>{p.text}</span>
        : <React.Fragment key={i}>{p.text}</React.Fragment>)}
    </>
  )
}
