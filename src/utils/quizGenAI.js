// ── On-device AI quiz generator ───────────────────────────────────────────
// Custom, in-browser replacement for the Gemini quiz endpoint. A neural
// sentence-embedding model (paraphrase-multilingual-MiniLM-L12-v2, ~120 MB
// quantized) runs entirely on the professor's device via Transformers.js. It is
// multilingual on purpose - the quizzes here are in Filipino/Tagalog, which an
// English-only model embeds poorly. The lesson text NEVER leaves the browser.
//
// The model is NOT used to *write* questions (which would risk hallucinating
// facts not in the lesson). It is used to UNDERSTAND the lesson - to rank which
// sentences matter, to pick multiple-choice distractors that are semantically
// near-misses (plausibly confusable, not random), and to drop near-duplicate
// questions. Every question and answer is still drawn verbatim from the lesson,
// so the output is grounded and safe to grade.
//
// generateQuizAI() returns null when the model can't load or the lesson is too
// thin - the caller then falls back to the instant rule-based drafter.

import { splitSentences, keyTerms, definitions } from '@/utils/quizGen'
import { ensureExtractor, embedAll, cos, prewarmEmbeddings } from '@/utils/embeddings'

// Warm the shared embedding model when the lesson modal opens (re-export).
export const prewarmQuizAI = prewarmEmbeddings

function meanVec(vecs) {
  if (!vecs.length) return null
  const dim = vecs[0].length
  const m = new Array(dim).fill(0)
  for (const v of vecs) for (let i = 0; i < dim; i++) m[i] += v[i]
  for (let i = 0; i < dim; i++) m[i] /= vecs.length
  return m
}

let _seq = 0
function qid() { return 'q_' + Date.now() + '_ai_' + (_seq++) }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
function reFor(term) { return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }

/**
 * Maximal-marginal-relevance ordering: rank items by relevance to the lesson
 * centroid while penalizing redundancy against already-picked items.
 * @returns indices of `vecs` in selection order.
 */
function mmrOrder(vecs, centroid, lambda = 0.72) {
  const n = vecs.length
  const rel = vecs.map(v => cos(v, centroid))
  const chosen = []
  const remaining = new Set(vecs.map((_, i) => i))
  while (remaining.size) {
    let bestI = -1, bestScore = -Infinity
    for (const i of remaining) {
      let maxSim = 0
      for (const j of chosen) { const s = cos(vecs[i], vecs[j]); if (s > maxSim) maxSim = s }
      const score = lambda * rel[i] - (1 - lambda) * maxSim
      if (score > bestScore) { bestScore = score; bestI = i }
    }
    chosen.push(bestI)
    remaining.delete(bestI)
  }
  return chosen
}

/**
 * Embedding-aware MCQ distractors: terms whose meaning is NEAR the answer -
 * related enough to be tempting, not synonyms or identical.
 */
// Distractor similarity bands by difficulty. `prefer:'high'` orders the closest
// (most confusable) terms first; `prefer:'low'` orders the most different first.
const DIST_BANDS = {
  easy:   { lo: 0.12, hi: 0.45, prefer: 'low'  }, // clearly different - easy to eliminate
  medium: { lo: 0.30, hi: 0.82, prefer: 'high' }, // the original confusable band
  hard:   { lo: 0.55, hi: 0.90, prefer: 'high' }, // near-misses - hard to tell apart
}

function smartDistractors(answer, terms, termVec, answerVec, n = 3, difficulty = 'medium') {
  if (!answerVec) return []
  const scored = []
  for (const t of terms) {
    if (t.toLowerCase() === answer.toLowerCase()) continue
    const v = termVec.get(t)
    if (!v) continue
    if (Math.abs(t.length - answer.length) > 40) continue
    const s = cos(v, answerVec)
    if (s > 0.92) continue            // basically a synonym - skip
    scored.push({ t, s })
  }
  const cfg = DIST_BANDS[difficulty] || DIST_BANDS.medium
  const dir = (a, b) => (cfg.prefer === 'low' ? a.s - b.s : b.s - a.s)
  const band = scored.filter(x => x.s >= cfg.lo && x.s <= cfg.hi).sort(dir)
  const rest = scored.filter(x => x.s < cfg.lo || x.s > cfg.hi).sort(dir)
  const out = []
  const seen = new Set([answer.toLowerCase()])
  for (const { t } of [...band, ...rest]) {
    if (out.length >= n) break
    if (seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

// ── Accepted-answer (Auto-key) helpers ────────────────────────────────────

/** Deterministic split of a model answer into alternates (",", "/", "|", ";", "or"). */
export function splitAnswerAlternates(answer) {
  return String(answer || '').split(/\s*(?:[,/|;]|\bor\b)\s*/i).map(s => s.trim()).filter(Boolean)
}

/** Merge alternates: dedupe (case-insensitive) and drop the model answer itself
 *  (the grader already accepts the answer). */
function mergeAlternates(list, answer) {
  const seen = new Set([String(answer || '').trim().toLowerCase()])
  const out = []
  for (const x of list) {
    const t = String(x || '').trim()
    const k = t.toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k); out.push(t)
  }
  return out
}

/**
 * Grounded synonym mining for accepted answers. Returns candidate terms whose
 * embedding is very close to the answer's - but CONSERVATIVE on purpose: a high
 * floor + small cap, because embeddings can't fully separate a synonym from a
 * sibling/opposite. The professor reviews every key, so we err toward precision.
 */
function mineSynonyms(answer, answerVec, candEntries, { min = 0.84, cap = 2 } = {}) {
  if (!answerVec) return []
  const al = String(answer).toLowerCase()
  const scored = []
  for (const { term, vec } of candEntries) {
    if (!vec) continue
    const tl = term.toLowerCase()
    if (tl === al) continue
    if (Math.abs(term.length - answer.length) > 30) continue
    const s = cos(vec, answerVec)
    if (s >= min && s < 0.999) scored.push({ term, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const out = [], seen = new Set([al])
  for (const { term } of scored) {
    if (out.length >= cap) break
    const tl = term.toLowerCase()
    if (seen.has(tl)) continue
    seen.add(tl); out.push(term)
  }
  return out
}

const TEXT_TYPES = new Set(['short_answer', 'fill_in_the_blank', 'identification'])

/**
 * Smart Auto-key: fill `acceptedAnswers` for text questions using the on-device
 * model. Mines grounded synonyms from the quiz's own content (+ optional lesson
 * text) and merges them with the deterministic separator split. Questions that
 * already have acceptedAnswers are left untouched.
 * @returns {Promise<{questions:Array, touched:number, aiUsed:boolean}|null>}
 *   null when the model can't load - caller should fall back to split-only.
 */
export async function smartAutoKey(questions, { contextText = '' } = {}) {
  const list = questions || []
  const targets = list.filter(q => TEXT_TYPES.has(q.type) && !(Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length))
  if (!targets.length) return { questions: list, touched: 0, aiUsed: false }

  // Candidate pool: the quiz's own answers/options/stems, plus any lesson text.
  let pool = []
  for (const q of list) {
    if (q.answer) pool.push(String(q.answer))
    if (Array.isArray(q.options)) pool.push(...q.options.map(String))
  }
  pool.push(...keyTerms(list.map(q => q.question || '').join('. ')).slice(0, 150))
  if (contextText && contextText.trim().length > 40) pool.push(...keyTerms(contextText).slice(0, 150))
  pool = [...new Set(pool.map(s => String(s).trim()).filter(s => s && s.length <= 40))].slice(0, 220)

  let extractor
  try { extractor = await ensureExtractor() } catch { return null }

  const answers = targets.map(q => String(q.answer || '').trim())
  let poolVecs, ansVecs
  try {
    poolVecs = await embedAll(extractor, pool)
    ansVecs = await embedAll(extractor, answers)
  } catch { return null }

  const candEntries = pool.map((t, i) => ({ term: t, vec: poolVecs[i] }))
  const ansVec = new Map()
  answers.forEach((a, i) => ansVec.set(a.toLowerCase(), ansVecs[i]))

  let touched = 0
  const out = list.map(q => {
    if (!TEXT_TYPES.has(q.type)) return q
    if (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length) return q
    const ans = String(q.answer || '').trim()
    if (!ans) return q
    const base = splitAnswerAlternates(ans)
    const av = ansVec.get(ans.toLowerCase())
    const syns = av ? mineSynonyms(ans, av, candEntries) : []
    const merged = mergeAlternates([...base, ...syns], ans)
    if (!merged.length) return q
    touched++
    return { ...q, acceptedAnswers: merged }
  })
  return { questions: out, touched, aiUsed: true }
}

/**
 * Generate grounded quiz questions from lesson text using on-device embeddings.
 * @param {string} text
 * @param {{count?:number, types?:string[], difficulty?:'easy'|'medium'|'hard'}} opts
 * @returns {Promise<Array<object>|null>} questions, or null to fall back.
 */
export async function generateQuizAI(text, { count = 10, types = ['multiple_choice', 'true_false', 'fill_in_the_blank', 'identification'], difficulty = 'medium' } = {}) {
  if (typeof window === 'undefined') return null
  const order = types.length ? types : ['multiple_choice']

  // ── Extraction (shared heuristics) ────────────────────────────────────────
  const sentences = splitSentences(text).slice(0, 200)
  if (sentences.length < 4) return null
  const terms = keyTerms(text).slice(0, 60)
  if (terms.length < 4) return null
  const defs = definitions(sentences)

  // ── Embed (the AI step) ───────────────────────────────────────────────────
  let extractor
  try { extractor = await ensureExtractor() } catch { return null }
  let sentVecs, termVecs
  try {
    sentVecs = await embedAll(extractor, sentences)
    termVecs = await embedAll(extractor, terms)
  } catch { return null }

  const termVec = new Map()
  terms.forEach((t, i) => termVec.set(t, termVecs[i]))
  const centroid = meanVec(sentVecs)
  if (!centroid) return null

  // Salient, diverse sentence order.
  const sentOrder = mmrOrder(sentVecs, centroid)
  const ranked = sentOrder.map(i => ({ s: sentences[i], v: sentVecs[i] }))

  // ── Build items ───────────────────────────────────────────────────────────
  const out = []
  const used = new Set()              // sentences already consumed
  const stemVecs = []                 // for dedup
  let defIdx = 0
  let ti = 0

  const firstTermIn = (s) => terms.find(t => reFor(t).test(s))
  const tooSimilar = (v) => v && stemVecs.some(p => cos(p, v) > 0.86)

  // Pull the next salient unused sentence that contains a key term.
  function nextSentenceWithTerm() {
    for (const r of ranked) {
      if (used.has(r.s)) continue
      const term = firstTermIn(r.s)
      if (term && r.s.length < 230) return { ...r, term }
    }
    return null
  }
  function nextSentence() {
    for (const r of ranked) if (!used.has(r.s)) return r
    return null
  }

  let guard = 0
  while (out.length < count && guard < count * 8) {
    guard++
    const type = order[ti % order.length]; ti++
    let item = null

    if (type === 'identification' && defIdx < defs.length) {
      const d = defs[defIdx++]
      item = { id: qid(), type: 'identification', question: `What term is being described: "${cap(d.def)}"?`, answer: d.term, explanation: `The lesson defines ${d.term} as: ${d.def}.` }
    } else if (type === 'multiple_choice') {
      const hit = nextSentenceWithTerm()
      if (hit) {
        const distractors = smartDistractors(hit.term, terms, termVec, termVec.get(hit.term), 3, difficulty)
        if (distractors.length === 3) {
          used.add(hit.s)
          const stem = hit.s.replace(reFor(hit.term), '______')
          item = { id: qid(), type: 'multiple_choice', question: `Fill in the blank: ${stem}`, options: shuffle([hit.term, ...distractors]), answer: hit.term, explanation: `From the lesson: "${hit.s}"` }
        }
      }
      if (!item && defIdx < defs.length) {
        const d = defs[defIdx]
        const distractors = smartDistractors(d.term, terms, termVec, termVec.get(d.term), 3, difficulty)
        if (distractors.length === 3) {
          defIdx++
          item = { id: qid(), type: 'multiple_choice', question: `Which term means: "${cap(d.def)}"?`, options: shuffle([d.term, ...distractors]), answer: d.term, explanation: `The lesson describes ${d.term} as: ${d.def}.` }
        }
      }
    } else if (type === 'fill_in_the_blank') {
      const hit = nextSentenceWithTerm()
      if (hit) {
        used.add(hit.s)
        item = { id: qid(), type: 'fill_in_the_blank', question: hit.s.replace(reFor(hit.term), '___'), answer: hit.term, explanation: `From the lesson: "${hit.s}"` }
      }
    } else if (type === 'true_false') {
      const r = nextSentence()
      if (r) {
        used.add(r.s)
        const present = firstTermIn(r.s)
        // Swap the key term with another term to make a false statement. Harder
        // quizzes swap in the NEAREST term (a subtle falsehood); easy ones swap a
        // clearly-unrelated term so the error is obvious.
        let swap = null
        if (present && termVec.get(present)) {
          const av = termVec.get(present)
          const wantClose = difficulty !== 'easy'
          let best = null, bestS = wantClose ? -Infinity : Infinity
          for (const t of terms) {
            if (t.toLowerCase() === present.toLowerCase()) continue
            const v = termVec.get(t); if (!v) continue
            const s = cos(v, av)
            if (s >= 0.92) continue
            if (wantClose ? s > bestS : (s < bestS && s > 0.08)) { bestS = s; best = t }
          }
          swap = best
        }
        if (present && swap && Math.random() < 0.5) {
          item = { id: qid(), type: 'true_false', question: r.s.replace(reFor(present), swap), answer: 'False', explanation: `False - the lesson refers to "${present}", not "${swap}".` }
        } else {
          item = { id: qid(), type: 'true_false', question: r.s, answer: 'True', explanation: 'This statement is taken directly from the lesson.' }
        }
      }
    } else if (type === 'short_answer') {
      const r = nextSentence()
      if (r) {
        used.add(r.s)
        item = { id: qid(), type: 'short_answer', question: `In your own words, explain: "${cap(r.s.split(' ').slice(0, 12).join(' '))}…"`, answer: r.s, explanation: `Model answer from the lesson: "${r.s}"` }
      }
    }

    // Fallback within the AI path: a fill-in-the-blank from the next salient sentence.
    if (!item) {
      const hit = nextSentenceWithTerm()
      if (hit) {
        used.add(hit.s)
        item = { id: qid(), type: 'fill_in_the_blank', question: hit.s.replace(reFor(hit.term), '___'), answer: hit.term, explanation: `From the lesson: "${hit.s}"` }
      }
    }
    if (!item) break // nothing left to build from

    // Dedup near-identical stems by embedding.
    let stemVec = null
    try {
      const e = await extractor([item.question], { pooling: 'mean', normalize: true })
      stemVec = e.tolist()[0]
    } catch { /* dedup is best-effort */ }
    if (tooSimilar(stemVec)) continue
    if (stemVec) stemVecs.push(stemVec)
    out.push(item)
  }

  // Pre-fill grounded accepted-answer synonyms for single-term text questions
  // (the lesson terms are already embedded, so this is essentially free).
  const candEntries = terms.map(t => ({ term: t, vec: termVec.get(t) }))
  for (const item of out) {
    if (item.type !== 'fill_in_the_blank' && item.type !== 'identification') continue
    const av = termVec.get(item.answer)
    const base = splitAnswerAlternates(item.answer)
    const syns = av ? mineSynonyms(item.answer, av, candEntries) : []
    const merged = mergeAlternates([...base, ...syns], item.answer)
    if (merged.length) item.acceptedAnswers = merged
  }

  return out.length ? out.slice(0, count) : null
}
