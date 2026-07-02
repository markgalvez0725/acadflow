// ── Shared form validators ─────────────────────────────────────────────────
// Central home for the cross-form validation rules (URL/email shape, date
// sanity, score clamps, duplicate detection). Pure functions, no React, no
// Firebase. Rules return either a boolean, a normalized value, or an error
// string (null = valid) so every form can surface failures through its own
// idiom (err-msg div, toast, red banner).
//
// Scope note: helpers that already have a canonical home stay there -
// validateSnum/sanitizeSnum in validate.js, the { state, msg } smart-check
// rules in settingsVerify.js, todayKey in firebase/attendanceExtras.js.

/** URL shape: trimmed value must be a real http(s) URL with no spaces. */
export const isValidUrl = v => /^https?:\/\/\S+$/i.test(String(v || '').trim())

/** Email shape (mirrors settingsVerify's EMAIL_RE for one consistent rule). */
export const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())

/**
 * Real-calendar YYYY-MM-DD check. Rejects both malformed strings and
 * impossible dates like 2026-02-30 (which Date would silently roll over).
 */
export function isRealDateStr(ds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ds || ''))) return false
  const dt = new Date(`${ds}T00:00:00`)
  return !isNaN(dt) && dt.toLocaleDateString('en-CA') === ds
}

/** Parse a datetime-local string; returns the ms timestamp only if it is a
 *  valid moment strictly in the future, else null. */
export function parseFutureTs(v) {
  const ts = new Date(v).getTime()
  return (!isNaN(ts) && ts > Date.now()) ? ts : null
}

/**
 * Clamp a score input to [0, max]. Empty stays empty (blank = not graded);
 * non-numeric text is returned unchanged so the field's own invalid-value
 * indicator can flag it instead of silently coercing.
 */
export function clampScore(v, max = 100) {
  if (v === '' || v == null) return ''
  const n = parseFloat(v)
  if (isNaN(n)) return String(v)
  return Math.min(max, Math.max(0, n))
}

/** Section comparison key: "2-A", "2A" and "2 a" are the same section.
 *  MUST stay in lockstep with sectionMatches() in utils/enrollment.js. */
export const normSectionKey = v => String(v || '').trim().toLowerCase().replace(/[\s\-_]/g, '')

/** First case-insensitive duplicate in a list of strings, or null. */
export function firstDuplicateCI(list) {
  const seen = new Set()
  for (const s of list) {
    const k = String(s).toLowerCase()
    if (seen.has(k)) return s
    seen.add(k)
  }
  return null
}

/** Subjects become per-student map keys; refuse prototype-polluting names. */
export const isSafeMapKey = v => !/^(__proto__|constructor|prototype)$/i.test(String(v).trim())

/**
 * Person-name guard. A comma corrupts the canonical "SURNAME, First M."
 * storage format, so it is rejected outright. Returns error string or null.
 */
export function personNameError(v, label = 'Name', max = 60) {
  const s = String(v || '')
  if (/,/.test(s)) return `${label} cannot contain commas.`
  if (s.length > max) return `${label} is too long (max ${max} characters).`
  return null
}

/** Case-insensitive roster ID lookup (student numbers differ only by case
 *  are the same student as far as records are concerned). */
export const rosterHasId = (students, id, excludeId = null) =>
  students.some(s => s.id !== excludeId && String(s.id || '').toUpperCase() === String(id || '').trim().toUpperCase())

/** Case-insensitive roster full-name lookup, optionally excluding one id. */
export const rosterHasName = (students, name, excludeId = null) =>
  students.some(s => s.id !== excludeId && (s.name || '').toLowerCase() === String(name || '').trim().toLowerCase())

/** Normalize any "1"/"1st"/"1st Year" input to '1st Year'..'4th Year', or null. */
export function normalizeYearLevel(v) {
  const m = String(v || '').trim().match(/^([1-4])/)
  return m ? `${m[1]}${['st', 'nd', 'rd', 'th'][m[1] - 1]} Year` : null
}

// ── Quiz question validity ──────────────────────────────────────────────────
// KEEP IN SYNC with TYPE_LABELS in admin QuizTab.jsx: these are the only
// types the student player can render and computeScore can grade.
export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'fill_in_the_blank', 'identification']

// Same normalization the grader uses (quizScore.js norm): trim, lowercase,
// collapse whitespace. The validator MUST NOT be stricter than the grader, or
// legacy quizzes that grade correctly become impossible to re-save.
const _norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Why a question can't be published/imported, or null if it is valid.
 *  `question` is stored as sanitized HTML, so tags are stripped before the
 *  emptiness check. */
export function questionError(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return 'not a question object'
  if (!QUESTION_TYPES.includes(q.type)) return `unknown type "${q.type ?? ''}"`
  const text = String(q.question || '').replace(/<[^>]*>/g, '').trim()
  if (!text) return 'missing question text'
  if (q.type === 'multiple_choice') {
    const opts = Array.isArray(q.options) ? q.options.filter(o => String(o).trim()) : []
    if (opts.length < 2) return 'needs at least 2 options'
    if (!opts.some(o => _norm(o) === _norm(q.answer))) return 'answer does not match any option'
  } else if (q.type === 'true_false') {
    if (!/^(true|false)$/i.test(String(q.answer ?? '').trim())) return 'answer must be True or False'
  } else if (!String(q.answer ?? '').trim()) {
    return 'missing answer key'
  }
  return null
}

/** Question points: any missing/zero/negative/non-numeric value grades as 1. */
export const normalizePoints = p => (Number.isFinite(Number(p)) && Number(p) > 0) ? Number(p) : 1
