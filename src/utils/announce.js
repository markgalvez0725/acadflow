// Announcement audience helpers. A post can target one class, several classes
// (classIds[]), or everyone ('all'). These normalize that so every visibility
// check reads the same way, and stay backward-compatible with old posts that
// only have a single `classId`.

import { courseShort } from '@/constants/courses'

// The student ids a `student`/`class` record belongs to.
export function classIdsOf(x) {
  if (!x) return []
  return x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
}

// Normalized target class ids for an announcement. An empty array means the post
// is a broadcast to everyone ('all' / unset). New posts carry classIds[]; old
// posts fall back to the single classId.
export function annClassIds(ann) {
  if (!ann) return []
  if (Array.isArray(ann.classIds) && ann.classIds.length) {
    return ann.classIds.includes('all') ? [] : ann.classIds.filter(Boolean)
  }
  if (ann.classId && ann.classId !== 'all') return [ann.classId]
  return []
}

// True when the post is a broadcast (reaches every class).
export function annIsBroadcast(ann) {
  return annClassIds(ann).length === 0
}

// True when the post reaches a viewer enrolled in `viewerClassIds`.
export function annReaches(ann, viewerClassIds) {
  const targets = annClassIds(ann)
  if (!targets.length) return true // broadcast
  const set = viewerClassIds instanceof Set ? viewerClassIds : new Set(viewerClassIds || [])
  return targets.some(id => set.has(id))
}

// Short "COURSE SECTION" labels for the post's target classes, as caption pills.
// Pass `scopeClassIds` to limit them to a viewer's own classes (students only see
// their pill); pass null for the professor (sees every target). Broadcast -> one
// "All classes" pill.
export function announcementClassPills(ann, classes, scopeClassIds = null) {
  if (annIsBroadcast(ann)) return ['All classes']
  let ids = annClassIds(ann)
  if (scopeClassIds) {
    const set = scopeClassIds instanceof Set ? scopeClassIds : new Set(scopeClassIds || [])
    ids = ids.filter(id => set.has(id))
  }
  return ids
    .map(id => {
      const c = (classes || []).find(x => x.id === id)
      return c ? `${courseShort(c.name)}${c.section ? ' ' + c.section : ''}` : null
    })
    .filter(Boolean)
}
