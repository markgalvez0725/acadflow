// Messenger-style read receipts: a reader's "seen" avatar belongs under the LAST
// message I sent that they have actually seen, i.e. their live read timestamp is
// at or after that bubble's time. As I send newer messages they haven't read yet,
// my older avatar stays put - it only "drops" down to a newer bubble once they
// live-read it. This module derives that placement purely from timestamps, so the
// receipt reflects what was genuinely seen (not just that an earlier chat was read).
//
// `entries` are the flattened, ts-ascending bubble entries (main messages + replies).
// `isOwn(entry)` returns true for bubbles *I* sent (the ones a receipt can sit under).

// Chronological indexes of my own, non-deleted bubbles.
function ownIndexes(entries, isOwn) {
  const out = []
  ;(entries || []).forEach((e, i) => { if (isOwn(e) && !e.deleted) out.push(i) })
  return out
}

// The single own-bubble index a reader's avatar should sit under, given their last
// live-read timestamp. Returns -1 when they have not seen even my oldest bubble.
export function anchorFor(entries, isOwn, readTs) {
  if (!readTs) return -1
  let anchor = -1
  for (const i of ownIndexes(entries, isOwn)) {
    if ((entries[i].ts || 0) <= readTs) anchor = i
    else break // own indexes are ts-ascending, so nothing later can qualify
  }
  return anchor
}

// Map<bubbleIndex, reader[]> placing each reader under the last of my bubbles they
// have seen. Readers: [{ id, name, photo, readTs }]. Readers who have seen nothing
// of mine are omitted entirely (no avatar shown).
export function anchorMap(entries, isOwn, readers) {
  const map = new Map()
  for (const r of readers || []) {
    const idx = anchorFor(entries, isOwn, r && r.readTs)
    if (idx < 0) continue
    if (!map.has(idx)) map.set(idx, [])
    map.get(idx).push(r)
  }
  return map
}
