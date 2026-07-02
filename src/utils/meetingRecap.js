// ── Smart Recap: deterministic on-device meeting summarizer ─────────────────
// Turns the silent meeting transcript into a rich-text recap: overview, key
// points, announcements/deadlines, questions raised, and participation share.
// Extractive (keeps real sentences verbatim), so every bullet stays in the
// language it was spoken in - English, Filipino, or mixed. Same on-device
// "Smart" pattern as Grade Watch / the dashboard analyzers: pure, instant,
// $0, no network. The shared Groq route (api/generate-quiz.js, transcript
// mode) upgrades this when configured; this is the always-available fallback.
//
// Output HTML uses only the app's sanitize whitelist (h4, p, ul, li, strong,
// em, mark, br) and is sanitized again at render time.

const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'it', 'its', 'this', 'that', 'these', 'those', 'there',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his', 'her', 'their',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'shall', 'may',
  'not', 'no', 'yes', 'if', 'then', 'than', 'as', 'just', 'also', 'very', 'about', 'into', 'out', 'up',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'any', 'some', 'more', 'now', 'okay', 'ok',
  'like', 'get', 'got', 'go', 'going', 'one', 'two', 'well', 'right', 'let', 'lets', "let's", 'us',
  // Filipino / Taglish fillers
  'ang', 'mga', 'na', 'ng', 'sa', 'si', 'ni', 'kay', 'ay', 'at', 'o', 'pero', 'kasi', 'para', 'may',
  'ito', 'iyan', 'iyon', 'yan', 'yun', 'dito', 'diyan', 'doon', 'ako', 'ikaw', 'ka', 'siya', 'kami',
  'tayo', 'kayo', 'sila', 'ko', 'mo', 'niya', 'namin', 'natin', 'ninyo', 'nila', 'po', 'opo', 'ho',
  'ba', 'lang', 'din', 'rin', 'pa', 'naman', 'nga', 'daw', 'raw', 'ni', 'wala', 'meron', 'hindi', 'oo',
  'kung', 'dahil', 'kaya', 'tapos', 'sige', 'yung', 'nung', 'eto', 'ganun', 'ganyan', 'talaga',
])

// Announcement / deadline cues (English + Filipino) - sentences containing
// these plus the date/time cues below are surfaced as "Announcements".
const ANNOUNCE_RE = /\b(quiz|exam|test|midterm|finals?|deadline|due|submit|submission|pass(?:ed|ing)?|activity|assignment|project|report(?:ing)?|presentation|grade[sd]?|attendance|requirement|pasahan|takdang[- ]?aralin|proyekto|pagsusulit|ipasa|isumite|huwag kalimutan|remind(?:er)?|announce(?:ment)?|schedule[d]?|moved|postponed|cancell?ed|extension)\b/i
const TIME_RE = /\b(today|tomorrow|tonight|bukas|mamaya|next (?:week|month|meeting|class)|this (?:week|friday|monday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miyerkules|huwebes|biyernes|sabado|linggo|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\s*(?:am|pm)|\d{1,2}[:/]\d{2})\b/i
const QUESTION_START_RE = /^(what|why|how|when|where|who|which|can|could|do|does|did|is|are|will|would|should|ano|bakit|paano|kailan|saan|sino|alin|pwede|puwede|maaari|magkano|ilan|totoo)\b/i

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// No lookbehind (older Safari throws at parse time) - match runs ending in
// sentence punctuation instead.
function splitSentences(text) {
  return (String(text).match(/[^.?!\n]+[.?!]*/g) || [])
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function words(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean)
}

function trimSentence(s, max = 220) {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

function dedupePush(arr, item, key) {
  if (!arr.some(x => key(x) === key(item))) arr.push(item)
}

// segments: [{ at, uid, name, role, text, lang }] ordered by time.
// meeting:  the onlineMeetings doc (title/className/subject/scheduledAt/endedAt).
export function buildRecap(segments, meeting = {}) {
  const segs = (segments || []).filter(s => s.text && s.text.trim())
  if (!segs.length) return null

  // Sentence pool with speaker attribution.
  const sentences = []
  for (const seg of segs) {
    for (const s of splitSentences(seg.text)) {
      if (words(s).length < 3) continue // fragments carry no summary value
      sentences.push({ text: s, name: seg.name, role: seg.role, uid: seg.uid, at: seg.at })
    }
  }
  if (!sentences.length) return null

  // Keyword frequencies over the whole class.
  const freq = new Map()
  for (const s of sentences) {
    for (const w of words(s.text)) {
      if (w.length < 3 || STOPWORDS.has(w)) continue
      freq.set(w, (freq.get(w) || 0) + 1)
    }
  }
  const keyTerms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0])

  // Score each sentence by keyword density; the professor's sentences carry
  // more summary weight (they steer the lesson).
  const scored = sentences.map((s, idx) => {
    const ws = words(s.text)
    let score = 0
    for (const w of ws) score += (STOPWORDS.has(w) ? 0 : (freq.get(w) || 0))
    score = score / Math.sqrt(Math.max(4, ws.length))
    if (s.role === 'admin') score *= 1.5
    return { ...s, idx, score }
  })

  // Overview: the 3 strongest professor sentences (or anyone's, if the
  // professor never spoke), back in chronological order.
  const profPool = scored.filter(s => s.role === 'admin')
  const overviewPool = profPool.length >= 3 ? profPool : scored
  const overview = [...overviewPool].sort((a, b) => b.score - a.score).slice(0, 3)
    .sort((a, b) => a.idx - b.idx)

  // Key points: next strongest sentences overall, skipping overview picks.
  const overviewIdx = new Set(overview.map(s => s.idx))
  const keyPoints = [...scored].sort((a, b) => b.score - a.score)
    .filter(s => !overviewIdx.has(s.idx))
    .slice(0, 5)
    .sort((a, b) => a.idx - b.idx)

  // Announcements and deadlines.
  const announcements = []
  for (const s of sentences) {
    if (announcements.length >= 5) break
    if (ANNOUNCE_RE.test(s.text) && (TIME_RE.test(s.text) || /\b(quiz|exam|deadline|due|submit|ipasa|pasahan)\b/i.test(s.text))) {
      dedupePush(announcements, s, x => x.text.toLowerCase())
    }
  }

  // Questions raised (with who asked).
  const questions = []
  for (const s of sentences) {
    if (questions.length >= 5) break
    const t = s.text.trim()
    if (t.endsWith('?') || QUESTION_START_RE.test(t)) {
      if (words(t).length < 4) continue
      dedupePush(questions, s, x => x.text.toLowerCase())
    }
  }

  // Participation share by spoken words.
  const bySpeaker = new Map()
  let totalWords = 0
  for (const seg of segs) {
    const n = words(seg.text).length
    totalWords += n
    const cur = bySpeaker.get(seg.name) || { name: seg.name, role: seg.role, words: 0 }
    cur.words += n
    bySpeaker.set(seg.name, cur)
  }
  const speakers = [...bySpeaker.values()].sort((a, b) => b.words - a.words)
    .map(sp => ({ ...sp, pct: Math.max(1, Math.round((sp.words / Math.max(1, totalWords)) * 100)) }))

  const durMs = meeting.endedAt && meeting.scheduledAt ? meeting.endedAt - meeting.scheduledAt : 0
  const durationMin = durMs > 0 && durMs < 12 * 3600000 ? Math.max(1, Math.round(durMs / 60000)) : null

  // ── Rich text (sanitize-whitelist tags only) ──
  const li = s => `<li>${esc(trimSentence(s.text))}</li>`
  let html = ''
  html += `<h4>Overview</h4><ul>${overview.map(li).join('')}</ul>`
  if (keyPoints.length) html += `<h4>Key points</h4><ul>${keyPoints.map(li).join('')}</ul>`
  if (announcements.length) html += `<h4>Announcements and deadlines</h4><ul>${announcements.map(s => `<li><mark>${esc(trimSentence(s.text))}</mark></li>`).join('')}</ul>`
  if (questions.length) html += `<h4>Questions raised</h4><ul>${questions.map(s => `<li><strong>${esc(s.name)}:</strong> ${esc(trimSentence(s.text))}</li>`).join('')}</ul>`
  if (keyTerms.length) html += `<h4>Key terms</h4><p>${keyTerms.map(esc).join(' · ')}</p>`
  const topSpeakers = speakers.slice(0, 6).map(sp => `${esc(sp.name)} ${sp.pct}%`).join(' · ')
  html += `<h4>Participation</h4><p>${topSpeakers}${speakers.length > 6 ? ` · +${speakers.length - 6} more` : ''}</p>`

  return {
    html,
    engine: 'device',
    lines: segs.length,
    words: totalWords,
    speakers: speakers.length,
    durationMin,
  }
}

// Compact transcript for the server summarizer (and the transcript viewer):
// "[hh:mm] Name: text" lines, capped so the request stays reasonable.
export function transcriptToText(segments, maxChars = 24000) {
  const lines = (segments || []).map(s => {
    const t = new Date(s.at || 0)
    const hh = String(t.getHours()).padStart(2, '0')
    const mm = String(t.getMinutes()).padStart(2, '0')
    return `[${hh}:${mm}] ${s.name}: ${s.text}`
  })
  let text = lines.join('\n')
  if (text.length > maxChars) text = text.slice(text.length - maxChars) // keep the latest discussion
  return text
}
