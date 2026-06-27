// ── Answer-key auto-improvement (#41) ─────────────────────────────────────────
// Mines real student responses to short-answer / identification / fill-in
// questions and suggests alternates the answer key is missing - synonyms,
// paraphrases, translations, spelling variants too far for the fuzzy matcher.
// Uses the shared on-device embedding model to judge *meaning* (nothing uploaded);
// reuses quizScore's textMatches so we only look at answers that are currently
// marked WRONG. Everything is a SUGGESTION - the teacher approves before any key
// changes (and, optionally, attempts are re-graded).

import { ensureExtractor, embedAll, cos } from '@/utils/embeddings'
import { answerKeys, textMatches } from '@/utils/quizScore'

const TEXT_TYPES = ['short_answer', 'fill_in_the_blank', 'identification']
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * @param {object} quiz - the quiz doc ({ questions[], submissions{} })
 * @param {{ threshold?: number }} opts - min semantic similarity to suggest (default 0.62)
 * @returns {Promise<{ perQuestion: Array<{ qIndex:number, question:string, keys:string[],
 *           candidates: Array<{ text:string, count:number, sim:number }> }>, modelUsed:boolean }>}
 */
export async function mineAnswerKey(quiz, opts = {}) {
  const threshold = opts.threshold ?? 0.62
  const questions = quiz?.questions || []
  const submissions = quiz?.submissions || {}

  // Gather currently-wrong answers per text question, grouped + counted.
  const perQuestion = []
  questions.forEach((q, qi) => {
    if (!TEXT_TYPES.includes(q.type)) return
    const keys = answerKeys(q)
    const counts = {}
    Object.values(submissions).forEach(sub => {
      const a = Array.isArray(sub.answers) ? sub.answers[qi] : null
      if (typeof a !== 'string' || !a.trim()) return
      if (textMatches(a, keys)) return            // already credited - skip
      const k = norm(a)
      if (!counts[k]) counts[k] = { text: a.trim(), count: 0 }
      counts[k].count++
    })
    const candidates = Object.values(counts)
    if (candidates.length) perQuestion.push({ qIndex: qi, question: q.question, keys, candidates })
  })

  if (!perQuestion.length) return { perQuestion: [], modelUsed: false }

  // Semantic ranking needs the model; without it we can't claim "near-match", so
  // we surface nothing (the fuzzy matcher already handled spelling-level variants).
  let extractor = null
  try { extractor = await ensureExtractor() } catch { extractor = null }
  if (!extractor) return { perQuestion: [], modelUsed: false }

  for (const p of perQuestion) {
    const texts = [...p.keys, ...p.candidates.map(c => c.text)]
    let vecs
    try { vecs = await embedAll(extractor, texts) } catch { p.candidates = []; continue }
    const keyVecs = vecs.slice(0, p.keys.length)
    const candVecs = vecs.slice(p.keys.length)
    p.candidates = p.candidates
      .map((c, i) => {
        let best = 0
        keyVecs.forEach(kv => { const s = cos(candVecs[i], kv); if (s > best) best = s })
        return { ...c, sim: best }
      })
      .filter(c => c.sim >= threshold)
      .sort((a, b) => (b.sim - a.sim) || (b.count - a.count))
  }

  return { perQuestion: perQuestion.filter(p => p.candidates.length), modelUsed: true }
}
