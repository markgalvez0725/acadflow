// Parse a notification's `link` into a concrete redirect target.
//
// Specific-record links use the form "<prefix>:<id>" (e.g. "act:abc123"); the
// tab names below are the same for professor and student, so one parser serves
// both. A bare tab-name link (e.g. "grades", "messages") returns null here and
// is handled by each tab's own role-specific routing.
const PREFIX_TARGET = {
  act:     { tab: 'activities',    type: 'activity' },
  quiz:    { tab: 'quizzes',       type: 'quiz' },
  meeting: { tab: 'onlineClasses', type: 'meeting' },
  ann:     { tab: 'stream',        type: 'announcement' },
  msg:     { tab: 'messages',      type: 'message' },
}

export function parseRecordTarget(n) {
  const m = String(n?.link || '').match(/^([a-zA-Z]+):(.+)$/)
  if (!m) return null
  const spec = PREFIX_TARGET[m[1].toLowerCase()]
  return spec ? { ...spec, id: m[2] } : null
}

// Record types that currently have a destination consumer (a `${type}-${id}`
// anchor + useRedirectHighlight). Targets not listed still route to the correct
// tab; the glow is wired in per module, phase by phase.
export const HIGHLIGHT_READY = new Set(['activity'])
