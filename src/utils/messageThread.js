// Shared, side-effect-free helpers for the message threads on BOTH sides.
// Extracted verbatim from the admin + student MessagesTab, which computed these
// identically - behavior-preserving, so neither view changes. Role-specific
// logic (read-state, notify routing, thread building, list grouping) is
// deliberately NOT here: those differ per role and must stay in each tab.

// Consecutive bubbles by the same sender within this window form one visual
// group (avatar/tail only on the last; tighter spacing within the group).
export const MSG_GROUP_GAP = 5 * 60 * 1000 // 5 min → start a new visual group

// Grouping + day-separator flags for entry `i` in a ts-sorted entries list.
// Returns booleans the bubble row uses for spacing, the sender name/avatar, the
// bubble tail, and the day separator. Same computation both tabs had inline.
export function groupFlags(entries, i, gap = MSG_GROUP_GAP) {
  const entry = entries[i]
  const prev = entries[i - 1]
  const next = entries[i + 1]
  const sameAsPrev = !!(prev && prev.from === entry.from && (entry.ts - prev.ts) < gap)
  const sameAsNext = !!(next && next.from === entry.from && (next.ts - entry.ts) < gap)
  return {
    sameAsPrev,
    sameAsNext,
    firstOfGroup: !sameAsPrev,
    lastOfGroup: !sameAsNext,
    showDay: !prev || new Date(prev.ts).toDateString() !== new Date(entry.ts).toDateString(),
  }
}

// Conversation-list preview text: a secure message shows the lock label, else the
// body truncated to `max` chars with an ellipsis. Callers add any role-specific
// prefix (e.g. "You: " or a subject) around this.
export function previewText(body, { secure = false, max = 60 } = {}) {
  if (secure) return '🔒 Private message'
  const b = body || ''
  return b.slice(0, max) + (b.length > max ? '…' : '')
}
