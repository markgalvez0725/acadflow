// ── Emoji reactions (Telegram-style) ────────────────────────────────────────
// One curated, hardcoded reaction set shared by the student and professor message
// threads. Reactions are stored per message entry as a map of emoji -> reader ids
// (a student id, or 'admin' for the professor), e.g. { "👍": ["s_1","admin"] }.
//
// Emojis render as Apple emoji IMAGES (not the OS font) so the look is identical
// on Android/Windows/ChromeOS, where the native font would otherwise show
// Google/Microsoft glyphs. Only this fixed set is imaged - see appleEmojiUrl.

// Six one-tap reactions shown in the quick bar.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// The full grid revealed by the "more" (+) button - a superset of the quick set.
export const MORE_REACTIONS = [
  '👍', '❤️', '🔥', '🎉', '👏', '💯',
  '😂', '😮', '😢', '🙏', '✅', '👌',
  '🤔', '👀', '🙌', '⭐', '😍', '😅',
]

// Apple emoji image set (emoji-datasource-apple), pinned. Files are named by the
// emoji's unified codepoint(s). Keep this map in sync with MORE_REACTIONS.
const APPLE_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/'
const CODEPOINTS = {
  '👍': '1f44d', '❤️': '2764-fe0f', '😂': '1f602', '😮': '1f62e', '😢': '1f622',
  '🙏': '1f64f', '🔥': '1f525', '🎉': '1f389', '👏': '1f44f', '💯': '1f4af',
  '✅': '2705', '👌': '1f44c', '🤔': '1f914', '👀': '1f440', '🙌': '1f64c',
  '⭐': '2b50', '😍': '1f60d', '😅': '1f605',
}

// Apple-emoji image URL for a reaction char, or null if it is not in the set
// (callers fall back to rendering the raw unicode char).
export function appleEmojiUrl(emoji) {
  const code = CODEPOINTS[emoji]
  return code ? APPLE_BASE + code + '.png' : null
}

// Pure toggle of one reader's reaction, returning a NEW reactions map. Adds the
// reader to reactions[emoji] if absent, removes them if present, and drops the
// emoji key entirely once its last reactor leaves (so empty keys never linger).
// Used for the optimistic UI update; the transactional write mirrors this exactly.
export function toggleReaction(reactions, emoji, actorId) {
  const map = (reactions && typeof reactions === 'object') ? { ...reactions } : {}
  const cur = Array.isArray(map[emoji]) ? map[emoji] : []
  if (cur.includes(actorId)) {
    const next = cur.filter(id => id !== actorId)
    if (next.length) map[emoji] = next
    else delete map[emoji]
  } else {
    map[emoji] = [...cur, actorId]
  }
  return map
}

// Ordered, non-empty [emoji, ids] pairs for rendering pills. Follows the curated
// MORE_REACTIONS order so the chips never reshuffle as counts change, with any
// unknown/custom emoji appended after.
export function reactionEntries(reactions) {
  const map = (reactions && typeof reactions === 'object') ? reactions : {}
  const present = Object.keys(map).filter(e => Array.isArray(map[e]) && map[e].length)
  const ordered = [
    ...MORE_REACTIONS.filter(e => present.includes(e)),
    ...present.filter(e => !MORE_REACTIONS.includes(e)),
  ]
  return ordered.map(e => [e, map[e]])
}
