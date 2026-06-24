// ── On-device AI quiz generator ───────────────────────────────────────────
// Custom, in-browser replacement for the Gemini quiz endpoint. A small neural
// sentence-embedding model (all-MiniLM-L6-v2, ~23 MB quantized) runs entirely
// on the teacher's device via Transformers.js. The lesson text NEVER leaves
// the browser.
//
// The model is NOT used to *write* questions (which would risk hallucinating
// facts not in the lesson). It is used to UNDERSTAND the lesson — to rank which
// sentences matter, to pick multiple-choice distractors that are semantically
// near-misses (plausibly confusable, not random), and to drop near-duplicate
// questions. Every question and answer is still drawn verbatim from the lesson,
// so the output is grounded and safe to grade.
//
// generateQuizAI() returns null when the model can't load or the lesson is too
// thin — the caller then falls back to the instant rule-based drafter.

import { splitSentences, keyTerms, definitions } from '@/utils/quizGen'

// Pinned v2 build: `quantized: true` is the default, giving the ~23 MB int8
// model rather than the ~90 MB fp32 one. Weights are fetched from the Hugging
// Face hub (the app sets no CSP, so cross-origin model loads are allowed).
const TRANSFORMERS_URL = 'https://esm.sh/@xenova/transformers@2.17.2'
const MODEL = 'Xenova/all-MiniLM-L6-v2'

let _libPromise, _extractorPromise

/** Dynamically import Transformers.js from the CDN (kept out of the Vite bundle). */
function loadLib() {
  if (!_libPromise) {
    _libPromise = import(/* @vite-ignore */ TRANSFORMERS_URL)
      .then(mod => {
        // Fetch weights from the hub, cache in the browser, no local model dir.
        if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true }
        return mod
      })
      .catch(err => { _libPromise = null; throw err })
  }
  return _libPromise
}

/** Load the feature-extraction (embedding) pipeline once. */
function ensureExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline } = await loadLib()
      return pipeline('feature-extraction', MODEL)
    })().catch(err => { _extractorPromise = null; throw err })
  }
  return _extractorPromise
}

/**
 * Warm the model up ahead of time (download + compile) so the first real
 * generation isn't a cold wait. Call when the lesson modal opens. Errors
 * swallowed; safe to call repeatedly.
 */
export function prewarmQuizAI() {
  if (typeof window === 'undefined') return
  ensureExtractor().then(ex => ex('warm up', { pooling: 'mean', normalize: true })).catch(() => {})
}

/** Embed an array of strings → array of unit vectors (number[][]). Batched. */
async function embedAll(extractor, texts) {
  const vecs = []
  const BATCH = 32
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    const out = await extractor(chunk, { pooling: 'mean', normalize: true })
    const list = out.tolist() // [chunk.length, dim]
    for (const v of list) vecs.push(v)
    // Yield so a long lesson doesn't freeze the UI mid-embed.
    await new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
  }
  return vecs
}

/** Cosine similarity of two unit vectors (just a dot product). */
function cos(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

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
 * Embedding-aware MCQ distractors: terms whose meaning is NEAR the answer —
 * related enough to be tempting, not synonyms or identical.
 */
function smartDistractors(answer, terms, termVec, answerVec, n = 3) {
  if (!answerVec) return []
  const scored = []
  for (const t of terms) {
    if (t.toLowerCase() === answer.toLowerCase()) continue
    const v = termVec.get(t)
    if (!v) continue
    if (Math.abs(t.length - answer.length) > 40) continue
    const s = cos(v, answerVec)
    if (s > 0.92) continue            // basically a synonym — skip
    scored.push({ t, s })
  }
  // Prefer the "confusable" band (0.30–0.82), then fall back to next-best.
  const band = scored.filter(x => x.s >= 0.30 && x.s <= 0.82).sort((a, b) => b.s - a.s)
  const rest = scored.filter(x => x.s < 0.30 || x.s > 0.82).sort((a, b) => b.s - a.s)
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

/**
 * Generate grounded quiz questions from lesson text using on-device embeddings.
 * @param {string} text
 * @param {{count?:number, types?:string[]}} opts
 * @returns {Promise<Array<object>|null>} questions, or null to fall back.
 */
export async function generateQuizAI(text, { count = 10, types = ['multiple_choice', 'true_false', 'fill_in_the_blank', 'identification'] } = {}) {
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
        const distractors = smartDistractors(hit.term, terms, termVec, termVec.get(hit.term), 3)
        if (distractors.length === 3) {
          used.add(hit.s)
          const stem = hit.s.replace(reFor(hit.term), '______')
          item = { id: qid(), type: 'multiple_choice', question: `Fill in the blank: ${stem}`, options: shuffle([hit.term, ...distractors]), answer: hit.term, explanation: `From the lesson: "${hit.s}"` }
        }
      }
      if (!item && defIdx < defs.length) {
        const d = defs[defIdx]
        const distractors = smartDistractors(d.term, terms, termVec, termVec.get(d.term), 3)
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
        // Swap the key term with its NEAREST other term → a plausible falsehood.
        let swap = null
        if (present && termVec.get(present)) {
          const av = termVec.get(present)
          let best = null, bestS = -Infinity
          for (const t of terms) {
            if (t.toLowerCase() === present.toLowerCase()) continue
            const v = termVec.get(t); if (!v) continue
            const s = cos(v, av)
            if (s > bestS && s < 0.92) { bestS = s; best = t }
          }
          swap = best
        }
        if (present && swap && Math.random() < 0.5) {
          item = { id: qid(), type: 'true_false', question: r.s.replace(reFor(present), swap), answer: 'False', explanation: `False — the lesson refers to "${present}", not "${swap}".` }
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

  return out.length ? out.slice(0, count) : null
}
