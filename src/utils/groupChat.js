// ── Group-chat naming (shared by teacher inbox + student views) ───────────
// A group chat is an admin announcement targeting all / a class / a subject.
// Both sides resolve the SAME display name so a teacher rename (or the auto
// name from subject · course year) shows identically to students.

export function isGroupMessage(m) {
  return m?.from === 'admin' && m?.type === 'announcement'
}

// Auto name from the subject + course/year (or class + section).
export function autoGroupName(m, classes = []) {
  if (!m) return 'Group chat'
  if (m.to === 'all') return 'All Students'
  if (typeof m.to === 'string' && m.to.startsWith('class:')) {
    const c = classes.find(x => x.id === m.to.slice(6))
    return c ? `${c.name}${c.section ? ' ' + c.section : ''}` : 'Class group'
  }
  if (typeof m.to === 'string' && m.to.startsWith('subject:')) {
    const sub = m.targetSubject || m.to.slice(8)
    const c = classes.find(x => (m.classIds || []).includes(x.id))
    const cy = c ? [c.course, c.year].filter(Boolean).join(' ') : ''
    return cy ? `${sub} · ${cy}` : sub
  }
  return 'Group chat'
}

// The displayed group name: a teacher override if set, else the auto name.
export function groupName(m, classes = []) {
  return (m.groupName && m.groupName.trim()) ? m.groupName.trim() : autoGroupName(m, classes)
}
