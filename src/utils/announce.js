// Announcement audience helpers. A post can target one class, several classes
// (classIds[]), or everyone ('all'). These normalize that so every visibility
// check reads the same way, and stay backward-compatible with old posts that
// only have a single `classId`.

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
