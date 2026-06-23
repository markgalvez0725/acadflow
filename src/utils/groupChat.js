// ── Group-chat naming + course tags (shared by teacher inbox + student views) ──
// A group chat is an admin announcement targeting all / a class / a subject.
// Both sides resolve the SAME display name so a teacher rename (or the auto
// name) shows identically to students.

const COURSE_SHORTS = ['BSEMC', 'BSIS', 'BSCS', 'BSIT']

// Map a course (full name or code) to its short code: BSEMC / BSIS / BSCS / BSIT.
export function courseShort(course) {
  const raw = String(course || '').trim()
  if (!raw) return ''
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, '')
  for (const code of COURSE_SHORTS) if (compact.includes(code)) return code
  const c = raw.toLowerCase()
  if (c.includes('entertainment') || c.includes('multimedia')) return 'BSEMC'
  if (c.includes('information system')) return 'BSIS'
  if (c.includes('computer science')) return 'BSCS'
  if (c.includes('information technology')) return 'BSIT'
  return raw
}

// "BSEMC 2A" — course short + year digit + section, for a class.
export function classTag(cls) {
  if (!cls) return ''
  const cs = courseShort(cls.course || cls.name)
  const yr = (String(cls.year || '').match(/\d+/) || [''])[0]
  const sec = cls.section || ''
  return `${cs} ${yr}${sec}`.trim()
}

// "BSEMC 2A" for a student — course + year + their (primary) class section.
export function studentTag(student, classes = []) {
  if (!student) return ''
  const cs = courseShort(student.course)
  const yr = (String(student.year || '').match(/\d+/) || [''])[0]
  const cid = student.classId || (student.classIds && student.classIds[0])
  const sec = (classes.find(c => c.id === cid) || {}).section || ''
  const tag = `${cs} ${yr}${sec}`.trim()
  return tag || student.id || ''
}

export function isGroupMessage(m) {
  return m?.from === 'admin' && m?.type === 'announcement'
}

// The student members of a group chat (everyone it's delivered to).
export function groupMembers(m, students = []) {
  if (!m || !isGroupMessage(m)) return []
  if (m.to === 'all') return students
  if (typeof m.to === 'string' && m.to.startsWith('class:')) {
    const cid = m.to.slice(6)
    return students.filter(s => s.classId === cid || s.classIds?.includes(cid))
  }
  if (typeof m.to === 'string' && m.to.startsWith('subject:')) {
    const ids = Array.isArray(m.classIds) ? m.classIds : []
    return students.filter(s => ids.some(id => s.classId === id || s.classIds?.includes(id)))
  }
  return []
}

// Auto name = subject · class section(s)  (e.g. "EMCP 108 · BSEMC 2A"),
// or the class section for a plain class broadcast.
export function autoGroupName(m, classes = []) {
  if (!m) return 'Group chat'
  if (m.to === 'all') return 'All Students'
  if (typeof m.to === 'string' && m.to.startsWith('class:')) {
    const c = classes.find(x => x.id === m.to.slice(6))
    if (!c) return 'Class group'
    const tag = classTag(c)
    const subs = (c.subjects || []).filter(Boolean).join(', ')
    if (subs && tag) return `${subs} · ${tag}`
    return subs || tag || 'Class group'
  }
  if (typeof m.to === 'string' && m.to.startsWith('subject:')) {
    const sub = m.targetSubject || m.to.slice(8)
    const tags = [...new Set((m.classIds || []).map(id => classTag(classes.find(c => c.id === id))).filter(Boolean))]
    return tags.length ? `${sub} · ${tags.join(', ')}` : sub
  }
  return 'Group chat'
}

// The displayed group name: a teacher override if set, else the auto name.
export function groupName(m, classes = []) {
  return (m.groupName && m.groupName.trim()) ? m.groupName.trim() : autoGroupName(m, classes)
}
