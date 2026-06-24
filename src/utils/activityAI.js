// ── Activity AI helpers (fully on-device — no Gemini, no server) ───────────
// Used by the New Activity form (instructions, rubric) and the grading assist.
// Everything runs in-browser:
//   • instructions  → smart type-aware template (text generation can't be done
//                     safely on-device, and a template never hallucinates)
//   • rubric        → the shared embedding model picks the best-fit rubric
//                     archetype by MEANING (semantic match, multilingual)
//   • grading       → embeddings estimate how well a submission covers each
//                     rubric criterion → a draft score + feedback the teacher
//                     reviews. An honest coverage estimate, not an authority.

import { ensureExtractor, embedAll, cos, prewarmEmbeddings } from '@/utils/embeddings'
import { splitSentences } from '@/utils/quizGen'

// Warm the shared embedding model when the activity modal opens (re-export).
export const prewarmActivityAI = prewarmEmbeddings

// ── On-device rubric templates by activity type ───────────────────────────
const RUBRIC_TEMPLATES = [
  { keys: ['essay', 'paper', 'writing', 'reaction', 'reflection'], rubric: [
    { name: 'Content & Ideas', points: 40 }, { name: 'Organization', points: 25 },
    { name: 'Grammar & Mechanics', points: 20 }, { name: 'Citations', points: 15 } ] },
  { keys: ['report', 'lab', 'experiment'], rubric: [
    { name: 'Procedure', points: 25 }, { name: 'Data & Results', points: 30 },
    { name: 'Analysis', points: 30 }, { name: 'Presentation', points: 15 } ] },
  { keys: ['code', 'program', 'programming', 'app', 'game', 'software', 'script'], rubric: [
    { name: 'Functionality', points: 35 }, { name: 'Code Quality', points: 25 },
    { name: 'Requirements Met', points: 25 }, { name: 'Documentation', points: 15 } ] },
  { keys: ['presentation', 'demo', 'pitch', 'report back'], rubric: [
    { name: 'Content', points: 35 }, { name: 'Delivery', points: 25 },
    { name: 'Visual Aids', points: 20 }, { name: 'Q&A', points: 20 } ] },
  { keys: ['design', 'poster', 'artwork', 'illustration', 'layout'], rubric: [
    { name: 'Concept & Creativity', points: 35 }, { name: 'Execution', points: 30 },
    { name: 'Use of Tools', points: 20 }, { name: 'Adherence to Brief', points: 15 } ] },
  { keys: ['project', 'capstone', 'output', 'activity'], rubric: [
    { name: 'Completeness', points: 35 }, { name: 'Quality', points: 25 },
    { name: 'Creativity', points: 20 }, { name: 'Documentation', points: 20 } ] },
]

function withIds(rubric) {
  return rubric.map((c, i) => ({ id: 'c' + Date.now() + '_' + i + Math.random().toString(36).slice(2, 4), name: c.name, points: c.points }))
}

export function deviceRubric(title = '', subject = '') {
  const hay = (title + ' ' + subject).toLowerCase()
  const match = RUBRIC_TEMPLATES.find(t => t.keys.some(k => hay.includes(k)))
  return withIds((match || RUBRIC_TEMPLATES[RUBRIC_TEMPLATES.length - 1]).rubric)
}

export function deviceInstructions(title = '', subject = '') {
  const t = title.trim() || 'this activity'
  const s = subject ? ` for ${subject}` : ''
  return [
    `Complete "${t}"${s} and submit your work before the deadline.`,
    `Submit a shareable link (Google Drive, Docs, or similar) and make sure your teacher has view access.`,
    `Follow the grading rubric, keep your work original, and cite any sources you use.`,
  ].join(' ')
}

// ── Instructions (smart template, on-device) ──────────────────────────────
export async function aiInstructions(title, subject) {
  return deviceInstructions(title, subject)
}

// ── Rubric (semantic archetype match, on-device) ──────────────────────────
export async function aiRubric(title, subject, instructions) {
  const ctx = [title, subject, instructions].filter(Boolean).join('. ').trim()
  if (!ctx) return deviceRubric(title, subject)
  try {
    const extractor = await ensureExtractor()
    const [ctxVec] = await embedAll(extractor, [ctx])
    const tVecs = await embedAll(extractor, RUBRIC_TEMPLATES.map(t => t.keys.join(', ')))
    let best = RUBRIC_TEMPLATES.length - 1, bestS = -Infinity
    tVecs.forEach((v, i) => { const sim = cos(v, ctxVec); if (sim > bestS) { bestS = sim; best = i } })
    return withIds(RUBRIC_TEMPLATES[best].rubric)
  } catch {
    return deviceRubric(title, subject) // model unavailable → keyword template
  }
}

// ── Grading coverage estimate (on-device) ─────────────────────────────────
/**
 * Estimate how well a pasted submission covers each rubric criterion using
 * embeddings, and turn that into a DRAFT score + feedback for the teacher to
 * review. This is a coverage heuristic, not authoritative essay grading.
 * @returns {Promise<{score:number, feedback:string, criteria:Array<{name,met,points}>}|null>}
 *   null when the model can't load (caller should tell the teacher).
 */
export async function aiGrade({ title, subject, instructions, rubric, maxScore, submissionText }) {
  const text = String(submissionText || '').trim()
  if (!text) return null
  const max = maxScore || (rubric?.length ? rubric.reduce((s, c) => s + (c.points || 0), 0) : 100)

  let extractor
  try { extractor = await ensureExtractor() } catch { return null }

  let sents = splitSentences(text)
  if (!sents.length) sents = [text.slice(0, 600)]
  let subVecs
  try { subVecs = await embedAll(extractor, sents.slice(0, 120)) } catch { return null }

  const crits = (rubric && rubric.length)
    ? rubric.map(c => ({ name: c.name, points: c.points || 0 }))
    : [{ name: title || 'Overall quality', points: max }]

  // Expand each terse criterion name with activity context for a better match.
  const ctx = [title, subject].filter(Boolean).join(' ')
  let critVecs
  try { critVecs = await embedAll(extractor, crits.map(c => `${c.name}. ${ctx}`.trim())) } catch { return null }

  const results = crits.map((c, i) => {
    let best = 0
    for (const sv of subVecs) { const sim = cos(sv, critVecs[i]); if (sim > best) best = sim }
    // Criterion names are short, so real coverage tops out ~0.5; calibrate
    // generously but bounded.
    const frac = Math.max(0, Math.min(1, (best - 0.15) / (0.5 - 0.15)))
    return { name: c.name, points: Math.round(c.points * frac), max: c.points, frac, met: frac >= 0.5 }
  })

  const score = Math.max(0, Math.min(max, Math.round(results.reduce((s, r) => s + r.points, 0))))

  const strong = results.filter(r => r.frac >= 0.66).map(r => r.name)
  const weak = results.filter(r => r.frac < 0.4).map(r => r.name)
  let fb = ''
  if (strong.length) fb += `Appears to address ${strong.join(', ')} well. `
  if (weak.length) fb += `Seems to under-cover ${weak.join(', ')}. `
  fb += 'This is an on-device coverage estimate — read the work and adjust before saving.'

  return {
    score,
    feedback: fb.trim(),
    criteria: results.map(r => ({ name: r.name, met: r.met, points: r.points })),
    aiUsed: true,
  }
}
