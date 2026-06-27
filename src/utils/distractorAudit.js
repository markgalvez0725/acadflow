// ── Distractor-quality auditor (#24) ──────────────────────────────────────────
// Flags weak multiple-choice options using the shared on-device embedding model
// - never generation, so nothing is invented. Pure analysis + advisory findings:
//   • ambiguous     - a distractor too close in meaning to the correct answer
//   • duplicate     - two options that mean the same thing (string or embedding)
//   • tooeasy       - a distractor unrelated to the question (an obvious giveaway)
//   • empty         - a blank option
//   • length        - the correct answer is much longer than every distractor
//   • position bias - the key sits in the same slot across most questions (quiz-level)
// Degrades gracefully: if the model can't load, the model-free checks (empty,
// exact duplicate, length tell, position bias) still run. Reuses the singleton
// model from embeddings.js (the same one quiz generation / Auto-key prewarm).

import { ensureExtractor, embedAll, cos } from '@/utils/embeddings'

const L = i => String.fromCharCode(65 + i)
const norm = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.?!,;:]+$/, '')

// Cosine thresholds (tuned conservatively so we under-flag rather than nag).
const T_AMBIGUOUS = 0.85  // distractor ≈ correct answer
const T_DUPLICATE = 0.90  // distractor ≈ another distractor
const T_UNRELATED = 0.15  // distractor unrelated to stem + key (likely a giveaway)

/**
 * Audit every multiple-choice question's distractors.
 * @param {Array} questions - quiz questions ({ id, type, question, options[], answer })
 * @returns {Promise<{ perQuestion: Record<string,{issues:Array,ok:boolean}>, quizNotes: string[], audited: number, modelUsed: boolean }>}
 */
export async function auditDistractors(questions) {
  const mc = (questions || [])
    .filter(q => q && q.type === 'multiple_choice' && Array.isArray(q.options) && q.options.length >= 2)

  const perQuestion = {}
  const quizNotes = []
  if (!mc.length) return { perQuestion, quizNotes, audited: 0, modelUsed: false }

  // ── Quiz-level position bias (model-free, always runs) ──────────────────────
  const slots = {}
  let withKey = 0
  mc.forEach(q => {
    const ci = q.options.findIndex(o => norm(o) === norm(q.answer))
    if (ci >= 0) { slots[ci] = (slots[ci] || 0) + 1; withKey++ }
  })
  if (withKey >= 4) {
    const top = Object.entries(slots).sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] / withKey >= 0.7) {
      quizNotes.push(`The correct answer is option ${L(Number(top[0]))} in ${top[1]} of ${withKey} questions - vary its position so it isn't predictable.`)
    }
  }

  // ── Try embeddings; degrade gracefully if the model can't load ──────────────
  let extractor = null
  try { extractor = await ensureExtractor() } catch { extractor = null }

  // One batched embed call across every question's stem + options.
  let embeds = null
  const offsets = []
  if (extractor) {
    const flat = []
    mc.forEach(q => {
      offsets.push(flat.length)
      flat.push((q.question || ' ') || ' ')
      q.options.forEach(o => flat.push((o && o.trim()) ? o : ' '))
    })
    try { embeds = await embedAll(extractor, flat) } catch { embeds = null }
  }

  // ── Per-question findings ───────────────────────────────────────────────────
  mc.forEach((q, mi) => {
    const opts = q.options
    const ci = opts.findIndex(o => norm(o) === norm(q.answer))
    const issues = []

    let stemVec = null, vecs = null
    if (embeds) {
      const base = offsets[mi]
      stemVec = embeds[base]
      vecs = opts.map((_, i) => embeds[base + 1 + i])
    }

    // Empty options.
    opts.forEach((o, i) => {
      if (!String(o).trim()) issues.push({ slot: i, type: 'empty', msg: `Option ${L(i)} is empty.` })
    })

    // Duplicates - exact (normalized) or embedding near-duplicate. Flag the later slot.
    for (let i = 0; i < opts.length; i++) {
      for (let j = i + 1; j < opts.length; j++) {
        if (!opts[i].trim() || !opts[j].trim()) continue
        const dupStr = norm(opts[i]) === norm(opts[j])
        const dupVec = vecs ? cos(vecs[i], vecs[j]) >= T_DUPLICATE : false
        if (dupStr || dupVec) issues.push({ slot: j, type: 'duplicate', msg: `Option ${L(j)} duplicates option ${L(i)}.` })
      }
    }

    // Ambiguous-with-key and too-easy distractors - needs embeddings + a known key.
    if (vecs && ci >= 0) {
      const keyVec = vecs[ci]
      opts.forEach((o, i) => {
        if (i === ci || !o.trim()) return
        const simKey = cos(vecs[i], keyVec)
        const simStem = stemVec ? cos(vecs[i], stemVec) : 0
        if (simKey >= T_AMBIGUOUS) {
          issues.push({ slot: i, type: 'ambiguous', msg: `Option ${L(i)} is very close in meaning to the correct answer - may be ambiguous or unfair.` })
        } else if (Math.max(simKey, simStem) <= T_UNRELATED) {
          issues.push({ slot: i, type: 'tooeasy', msg: `Option ${L(i)} seems unrelated to the question - students may rule it out instantly.` })
        }
      })
    }

    // Length tell - the correct answer is noticeably longer than every distractor.
    if (ci >= 0 && opts.length >= 3) {
      const keyLen = opts[ci].trim().length
      const others = opts.filter((_, i) => i !== ci).map(o => o.trim().length)
      const maxOther = Math.max(0, ...others)
      if (keyLen >= 18 && maxOther > 0 && keyLen >= maxOther * 1.6) {
        issues.push({ slot: ci, type: 'length', msg: `The correct answer is much longer than the others - length can give it away.` })
      }
    }

    // De-dupe by slot+type.
    const seen = new Set()
    const uniq = issues.filter(it => {
      const k = it.slot + ':' + it.type
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    perQuestion[q.id] = { issues: uniq, ok: uniq.length === 0 }
  })

  return { perQuestion, quizNotes, audited: mc.length, modelUsed: !!embeds }
}
