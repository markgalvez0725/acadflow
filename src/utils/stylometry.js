// ── Authorship-style analysis (#39 impersonation check) ───────────────────────
// Pure, deterministic, on-device - NO embedding model. Embeddings capture *topic*
// (what someone wrote about), which would falsely flag a student for answering a
// quiz on a new subject. Authorship is about *how* someone writes: their habitual
// mix of function words, sentence rhythm, punctuation, and lexical variety - all
// largely independent of topic. This is classic stylometry. We use it to flag
// when a quiz attempt's writing style diverges sharply from the same student's
// own past quizzes. It is a hint for the professor to look closer - never a verdict.

// Common function words (English + Tagalog). Their relative frequencies form the
// core authorship fingerprint - content-neutral, so two quizzes on different
// topics by the same writer still match closely.
const FUNCTION_WORDS = [
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'as', 'by', 'from', 'that', 'this', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i',
  'not', 'no', 'so', 'than', 'then', 'there', 'here', 'which', 'who', 'what', 'when',
  'where', 'how', 'all', 'can', 'will', 'would', 'should', 'could', 'do', 'does',
  // Tagalog function words
  'ang', 'ng', 'sa', 'na', 'ay', 'mga', 'ako', 'siya', 'sila', 'kami', 'tayo', 'ko',
  'mo', 'niya', 'namin', 'natin', 'nila', 'at', 'kung', 'dahil', 'kasi', 'para',
  'hindi', 'wala', 'may', 'meron', 'ito', 'iyan', 'iyon', 'dito', 'doon', 'pa', 'din',
  'rin', 'lang', 'naman', 'po',
]
const FW_INDEX = (() => { const m = {}; FUNCTION_WORDS.forEach((w, i) => { m[w] = i }); return m })()

const tokenize = t => (String(t || '').toLowerCase().match(/[a-zà-ÿñ']+/g) || [])
const splitSentences = t => String(t || '').split(/[.!?]+/).map(s => s.trim()).filter(Boolean)

/** Build a topic-independent style fingerprint from a block of text. */
export function styleFingerprint(text) {
  const toks = tokenize(text)
  const words = toks.length
  const fw = new Array(FUNCTION_WORDS.length).fill(0)
  let fwMass = 0
  if (words) {
    toks.forEach(t => { const i = FW_INDEX[t]; if (i != null) { fw[i]++; fwMass++ } })
    for (let i = 0; i < fw.length; i++) fw[i] /= words
  }
  const sents = splitSentences(text)
  const charCount = toks.reduce((s, w) => s + w.length, 0)
  return {
    words,
    fwMass,                                            // # of function-word tokens
    fw,                                                // relative-frequency vector
    avgSentLen: sents.length ? words / sents.length : words,
    avgWordLen: words ? charCount / words : 0,
    ttr:        words ? new Set(toks).size / words : 0, // lexical diversity
    punctRate:  words ? ((String(text || '').match(/[,;:?!\u2010-\u2015\u2212-]/g) || []).length) / words : 0,
  }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Compare a current text against a baseline text, both by the same student.
 * @returns {{ enoughData:boolean, level:'insufficient'|'consistent'|'slight'|'divergent',
 *            flag:boolean, sim:number|null, divergence:number|null, cur:object, base:object }}
 */
export function compareStyle(currentText, baselineText, opts = {}) {
  const minCur  = opts.minCurrent  ?? 20
  const minBase = opts.minBaseline ?? 40
  const minFW   = opts.minFunctionWords ?? 3
  const cur  = styleFingerprint(currentText)
  const base = styleFingerprint(baselineText)

  // Not enough writing - or too few function words - to judge style honestly.
  if (cur.words < minCur || base.words < minBase || cur.fwMass < minFW || base.fwMass < minFW) {
    return { enoughData: false, level: 'insufficient', flag: false, sim: null, divergence: null, cur, base }
  }

  const sim = cosine(cur.fw, base.fw)
  const divergence = 1 - sim
  let level = 'consistent', flag = false
  if (sim < 0.78) { level = 'divergent'; flag = true }
  else if (sim < 0.85) { level = 'slight' }
  return { enoughData: true, level, flag, sim, divergence, cur, base }
}

/** Pull a student's text-type answers from a quiz submission into one block. */
export function collectQuizText(quiz, studentId) {
  const sub = (quiz?.submissions || {})[studentId]
  if (!sub || !Array.isArray(sub.answers)) return ''
  const parts = []
  ;(quiz.questions || []).forEach((q, i) => {
    if (q && (q.type === 'short_answer' || q.type === 'fill_in_the_blank' || q.type === 'identification')) {
      const a = sub.answers[i]
      if (typeof a === 'string' && a.trim()) parts.push(a.trim())
    }
  })
  return parts.join('. ')
}
