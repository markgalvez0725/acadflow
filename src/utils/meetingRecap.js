// ── Smart Recap: deterministic on-device meeting summarizer ─────────────────
// Turns the class transcript into STUDY NOTES: topic sections with headlines,
// verbatim timestamped bullets, and educational annotations (definitions,
// examples, exam signals, announcements, questions). Two engines:
//
//   buildStudyNotes - the deep one. Uses the app's multilingual sentence
//     embedding model (utils/embeddings.js, the same one Smart grading runs)
//     to find where the LECTURE CHANGES TOPIC and which sentences carry each
//     topic - and because Tagalog and English live in the same vector space,
//     a Taglish class sections and ranks just as well as an English one.
//   buildExtractive - the original keyword engine, kept verbatim as the
//     always-available fallback (no model, no network, instant).
//
// Both are EXTRACTIVE ON PURPOSE: every line a student reads was actually
// said in class, with its time - the analysis lives in the structure and the
// annotations, never in rewriting (a summarizer that invents content is
// worse than none in a school). Output HTML uses only the app's sanitize
// whitelist (h4, p, ul, li, strong, em, mark, br) and is sanitized again at
// render time.

import { ensureExtractor, embedAll, cos } from '@/utils/embeddings'

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

// Educational cue detectors (English + Filipino).
const DEFINE_RE = /\b(is called|are called|means|refers? to|is defined as|known as|is when|stands for|ibig sabihin|kahulugan|tinatawag na|tinatawag nating|ang tawag)\b/i
const EXAMPLE_RE = /\b(for example|for instance|an example of|halimbawa|kunwari|example nito|ganito yan|parang ganito)\b/i
const EXAM_RE = /\b(will (?:be|come out) (?:in|on) the (?:exam|quiz|test)|included in the (?:exam|quiz|test)|part of the (?:exam|quiz)|lalabas (?:sa|iyan sa) (?:exam|quiz|test|pagsusulit)|kasama sa (?:exam|quiz|test)|memorize|memoryahin|tandaan|take note|remember this|very important|importanteng?)\b/i

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

function fmtAt(at) {
  if (!at) return ''
  try { return new Date(at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

// Break the transcript into a scored sentence pool + shared stats (used by
// BOTH engines - single source of truth for words/speakers/announcements).
function poolOf(segments, meeting) {
  const segs = (segments || []).filter(s => s.text && s.text.trim())
  if (!segs.length) return null
  const sentences = []
  for (const seg of segs) {
    for (const s of splitSentences(seg.text)) {
      if (words(s).length < 3) continue // fragments carry no summary value
      sentences.push({ text: s, name: seg.name, role: seg.role, uid: seg.uid, at: seg.at })
    }
  }
  if (!sentences.length) return null

  const freq = new Map()
  for (const s of sentences) {
    for (const w of words(s.text)) {
      if (w.length < 3 || STOPWORDS.has(w)) continue
      freq.set(w, (freq.get(w) || 0) + 1)
    }
  }

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

  const announcements = []
  for (const s of sentences) {
    if (announcements.length >= 5) break
    if (ANNOUNCE_RE.test(s.text) && (TIME_RE.test(s.text) || /\b(quiz|exam|deadline|due|submit|ipasa|pasahan)\b/i.test(s.text))) {
      dedupePush(announcements, s, x => x.text.toLowerCase())
    }
  }
  const questions = []
  for (const s of sentences) {
    if (questions.length >= 5) break
    const t = s.text.trim()
    if (t.endsWith('?') || QUESTION_START_RE.test(t)) {
      if (words(t).length < 4) continue
      dedupePush(questions, s, x => x.text.toLowerCase())
    }
  }

  return { segs, sentences, freq, speakers, totalWords, durationMin, announcements, questions }
}

// Bold the sentence's strongest key term (first occurrence) - the "what is
// this line about" anchor a student's eye lands on.
function markTerm(text, terms) {
  for (const t of terms) {
    const i = text.toLowerCase().indexOf(t)
    if (i >= 0 && t.length >= 4) {
      return esc(text.slice(0, i)) + '<strong>' + esc(text.slice(i, i + t.length)) + '</strong>' + esc(text.slice(i + t.length))
    }
  }
  return esc(text)
}

function bulletHtml(s, terms) {
  const cue = DEFINE_RE.test(s.text) ? 'Definition'
    : EXAMPLE_RE.test(s.text) ? 'Example'
    : EXAM_RE.test(s.text) ? 'Exam signal'
    : ''
  const time = fmtAt(s.at)
  return `<li>${cue ? `<mark>${cue}</mark> ` : ''}${markTerm(trimSentence(s.text, 200), terms)}${time ? ` <em>· ${time}</em>` : ''}</li>`
}

function footerHtml(pool) {
  let html = ''
  if (pool.announcements.length) {
    html += `<h4>Heads up - announcements and deadlines</h4><ul>${pool.announcements.map(s => `<li><mark>To do</mark> ${esc(trimSentence(s.text))}${fmtAt(s.at) ? ` <em>· ${fmtAt(s.at)}</em>` : ''}</li>`).join('')}</ul>`
  }
  if (pool.questions.length) {
    html += `<h4>Questions raised</h4><ul>${pool.questions.map(s => `<li><strong>${esc(s.name)}:</strong> ${esc(trimSentence(s.text))}</li>`).join('')}</ul>`
  }
  const topSpeakers = pool.speakers.slice(0, 6).map(sp => `${esc(sp.name)} ${sp.pct}%`).join(' · ')
  html += `<h4>Participation</h4><p>${topSpeakers}${pool.speakers.length > 6 ? ` · +${pool.speakers.length - 6} more` : ''}</p>`
  return html
}

// ── Study Notes: embedding-powered topic sections + annotations ────────────
// Returns null when the embedding model is unavailable (caller falls back).
async function buildStudyNotes(pool) {
  const extractor = await ensureExtractor()
  if (!extractor) return null

  // Embedding units: sentences, merged pairwise until the count is sane for
  // an on-device pass (a 2-hour class stays a few seconds of embedding work).
  let units = pool.sentences.map(s => ({ ...s }))
  while (units.length > 440) {
    const merged = []
    for (let i = 0; i < units.length; i += 2) {
      const a = units[i], b = units[i + 1]
      merged.push(b && b.name === a.name
        ? { ...a, text: `${a.text} ${b.text}` }
        : a)
      if (b && b.name !== a.name) merged.push(b)
    }
    if (merged.length >= units.length) break
    units = merged
  }

  const vecs = await embedAll(extractor, units.map(u => u.text))
  if (!vecs || vecs.length !== units.length) return null
  const dim = vecs[0].length

  function meanVec(from, to) {
    const m = new Array(dim).fill(0)
    for (let i = from; i < to; i++) for (let d = 0; d < dim; d++) m[d] += vecs[i][d]
    let norm = 0
    for (let d = 0; d < dim; d++) norm += m[d] * m[d]
    norm = Math.sqrt(norm) || 1
    for (let d = 0; d < dim; d++) m[d] /= norm
    return m
  }

  // Topic boundaries: where the meaning of the conversation shifts - the
  // cohesion between the window before and after each point dips.
  const K = 5
  const MIN_SECTION = 6
  let bounds = []
  if (units.length >= MIN_SECTION * 2 + 2) {
    const dips = []
    for (let i = K; i <= units.length - K; i++) {
      dips.push({ i, sim: cos(meanVec(i - K, i), meanVec(i, i + K)) })
    }
    const avg = dips.reduce((a, d) => a + d.sim, 0) / dips.length
    const sd = Math.sqrt(dips.reduce((a, d) => a + (d.sim - avg) ** 2, 0) / dips.length) || 0.01
    const valleys = dips
      .filter((d, x) => d.sim < avg - 0.6 * sd
        && (x === 0 || d.sim <= dips[x - 1].sim)
        && (x === dips.length - 1 || d.sim <= dips[x + 1].sim))
      .sort((a, b) => a.sim - b.sim)
    for (const v of valleys) {
      if (bounds.length >= 7) break
      if (bounds.every(b => Math.abs(b - v.i) >= MIN_SECTION) && v.i >= MIN_SECTION && units.length - v.i >= MIN_SECTION) {
        bounds.push(v.i)
      }
    }
    bounds.sort((a, b) => a - b)
  }
  const starts = [0, ...bounds]
  const ends = [...bounds, units.length]

  // Global key terms (frequency over the whole class).
  const keyTerms = [...pool.freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0])

  let html = '<p><em>Study notes built on this device from the class transcript. Every line below was said in class, with its time.</em></p>'
  if (keyTerms.length) html += `<h4>Key terms</h4><p>${keyTerms.map(t => `<mark>${esc(t)}</mark>`).join(' ')}</p>`

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s], to = ends[s]
    const centroid = meanVec(from, to)
    // Section-local key terms name the headline.
    const localFreq = new Map()
    for (let i = from; i < to; i++) {
      for (const w of words(units[i].text)) {
        if (w.length < 4 || STOPWORDS.has(w)) continue
        localFreq.set(w, (localFreq.get(w) || 0) + 1)
      }
    }
    const localTerms = [...localFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0])

    const scored = []
    for (let i = from; i < to; i++) {
      const u = units[i]
      const wc = words(u.text).length
      let score = cos(vecs[i], centroid)
      if (u.role === 'admin') score *= 1.2 // the professor steers the lesson
      if (wc < 5) score *= 0.7
      scored.push({ ...u, i, score, annotated: DEFINE_RE.test(u.text) || EXAMPLE_RE.test(u.text) || EXAM_RE.test(u.text) })
    }
    // Bullets: the annotated lines (definitions/examples/exam signals) plus
    // the most central ones, back in spoken order.
    const picks = []
    for (const u of scored.filter(x => x.annotated).slice(0, 3)) dedupePush(picks, u, x => x.i)
    for (const u of [...scored].sort((a, b) => b.score - a.score)) {
      if (picks.length >= 5) break
      dedupePush(picks, u, x => x.i)
    }
    picks.sort((a, b) => a.i - b.i)

    const headTerms = localTerms.length ? localTerms.slice(0, 3).join(' · ') : trimSentence(picks[0]?.text || 'Discussion', 48)
    const headline = starts.length > 1 ? `Part ${s + 1} · ${headTerms}` : headTerms.charAt(0).toUpperCase() + headTerms.slice(1)
    const range = `${fmtAt(units[from].at)}${units[to - 1].at !== units[from].at ? ` - ${fmtAt(units[to - 1].at)}` : ''}`
    html += `<h4>${esc(headline)}</h4>`
    if (range.trim()) html += `<p><em>${esc(range)}</em></p>`
    html += `<ul>${picks.map(u => bulletHtml(u, [...localTerms, ...keyTerms])).join('')}</ul>`
  }

  html += footerHtml(pool)
  return html
}

// ── The original keyword engine (fallback - no model, no network) ──────────
function buildExtractive(pool) {
  const { sentences, freq } = pool
  const keyTerms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0])
  const scored = sentences.map((s, idx) => {
    const ws = words(s.text)
    let score = 0
    for (const w of ws) score += (STOPWORDS.has(w) ? 0 : (freq.get(w) || 0))
    score = score / Math.sqrt(Math.max(4, ws.length))
    if (s.role === 'admin') score *= 1.5
    return { ...s, idx, score }
  })
  const profPool = scored.filter(s => s.role === 'admin')
  const overviewPool = profPool.length >= 3 ? profPool : scored
  const overview = [...overviewPool].sort((a, b) => b.score - a.score).slice(0, 3)
    .sort((a, b) => a.idx - b.idx)
  const overviewIdx = new Set(overview.map(s => s.idx))
  const keyPoints = [...scored].sort((a, b) => b.score - a.score)
    .filter(s => !overviewIdx.has(s.idx))
    .slice(0, 5)
    .sort((a, b) => a.idx - b.idx)

  const li = s => `<li>${esc(trimSentence(s.text))}</li>`
  let html = ''
  html += `<h4>Overview</h4><ul>${overview.map(li).join('')}</ul>`
  if (keyPoints.length) html += `<h4>Key points</h4><ul>${keyPoints.map(li).join('')}</ul>`
  if (keyTerms.length) html += `<h4>Key terms</h4><p>${keyTerms.map(esc).join(' · ')}</p>`
  html += footerHtml(pool)
  return html
}

// segments: [{ at, uid, name, role, text, lang }] ordered by time.
// meeting:  the onlineMeetings doc (title/className/subject/scheduledAt/endedAt).
// Async: the study-notes engine loads the shared embedding model on first
// use; when it cannot (old device, blocked CDN), the keyword engine answers.
export async function buildRecap(segments, meeting = {}) {
  const pool = poolOf(segments, meeting)
  if (!pool) return null
  let html = null
  let engine = 'study-notes'
  try { html = await buildStudyNotes(pool) } catch { html = null }
  if (!html) { html = buildExtractive(pool); engine = 'device' }
  return {
    html,
    engine,
    lines: pool.segs.length,
    words: pool.totalWords,
    speakers: pool.speakers.length,
    durationMin: pool.durationMin,
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
