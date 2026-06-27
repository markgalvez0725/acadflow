// @mention helpers for announcement comments. Mentions are stored as plain
// text (`@Display Name`) inside the comment - no markup - and resolved back to
// recipient ids at send time so we can notify them. Names may contain spaces,
// so resolution matches the full `@Name` substring rather than tokenizing.

// Find the active "@…" query immediately before the caret, or null.
// The query starts at an '@' that begins the text or follows whitespace.
export function findMentionQuery(text, caret) {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at === -1) return null
  const before = at === 0 ? '' : upto[at - 1]
  if (before && !/\s/.test(before)) return null
  const query = upto.slice(at + 1)
  if (query.includes('\n') || query.length > 40) return null
  return { start: at, query }
}

// Replace the active "@query" with "@Name " and return { text, caret }.
export function applyMention(text, caret, name) {
  const q = findMentionQuery(text, caret)
  if (!q) return { text, caret }
  const insert = `@${name} `
  const next = text.slice(0, q.start) + insert + text.slice(caret)
  return { text: next, caret: q.start + insert.length }
}

// Return the ids of candidates whose `@Name` appears in the text.
// candidates: [{ id, name }]
export function resolveMentions(text, candidates) {
  const hay = (text || '').toLowerCase()
  const ids = []
  for (const c of candidates || []) {
    if (!c?.name) continue
    if (hay.includes('@' + c.name.toLowerCase())) ids.push(c.id)
  }
  return [...new Set(ids)]
}

// Filter candidates for the dropdown by the current query (case-insensitive).
// The list is already scoped to the post's audience (everyone for an "all" post,
// otherwise just the class's enrolled students), so the cap is generous - the
// whole class shows on a bare "@", and the scrollable dropdown + type-to-filter
// reach anyone in a large "all" post.
export function matchCandidates(query, candidates, limit = 50) {
  const q = (query || '').toLowerCase().trim()
  const list = candidates || []
  if (!q) return list.slice(0, limit)
  return list.filter(c => c.name?.toLowerCase().includes(q)).slice(0, limit)
}
