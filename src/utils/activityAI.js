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

// ── Group case-study grading ──────────────────────────────────────────────

function meanVec(vecs) {
  if (!vecs.length) return null
  const dim = vecs[0].length
  const m = new Array(dim).fill(0)
  for (const v of vecs) for (let i = 0; i < dim; i++) m[i] += v[i]
  for (let i = 0; i < dim; i++) m[i] /= vecs.length
  return m
}

// similarity → coverage fraction (criterion names are terse; calibrate bounded).
function coverageFrac(sim) { return Math.max(0, Math.min(1, (sim - 0.15) / (0.5 - 0.15))) }

/**
 * Auto-grade every group's case-study submission at once, on-device.
 * @param {object} p
 * @param {Array<{id:string,name:string,text:string}>} p.groups
 * @returns {Promise<Array<{groupId,name,score,feedback,relevance,copies:string[],
 *   criteria:Array<{name,met,points}>}>|null>} null if the model can't load.
 */
export async function aiGradeGroups({ title, subject, casePrompt, rubric, maxScore, groups }) {
  const valid = (groups || []).filter(g => String(g.text || '').trim())
  if (!valid.length) return null

  let extractor
  try { extractor = await ensureExtractor() } catch { return null }

  const max = maxScore || (rubric?.length ? rubric.reduce((s, c) => s + (c.points || 0), 0) : 100)
  const ctx = [title, subject].filter(Boolean).join(' ')
  const crits = (rubric && rubric.length)
    ? rubric.map(c => ({ name: c.name, points: c.points || 0 }))
    : [{ name: title || 'Overall quality', points: max }]

  let critVecs
  try { critVecs = await embedAll(extractor, crits.map(c => `${c.name}. ${ctx}`.trim())) } catch { return null }

  let caseVec = null
  if (casePrompt && casePrompt.trim()) {
    try { const [v] = await embedAll(extractor, [casePrompt.trim().slice(0, 1200)]); caseVec = v } catch { /* relevance optional */ }
  }

  const out = []
  for (const g of valid) {
    let sents = splitSentences(g.text)
    if (!sents.length) sents = [g.text.slice(0, 600)]
    let subVecs
    try { subVecs = await embedAll(extractor, sents.slice(0, 120)) } catch { continue }

    const results = crits.map((c, i) => {
      let best = 0
      for (const sv of subVecs) { const s = cos(sv, critVecs[i]); if (s > best) best = s }
      const frac = coverageFrac(best)
      return { name: c.name, points: Math.round(c.points * frac), max: c.points, frac, met: frac >= 0.5 }
    })
    const score = Math.max(0, Math.min(max, Math.round(results.reduce((s, r) => s + r.points, 0))))

    let relevance = null
    if (caseVec) {
      let best = 0
      for (const sv of subVecs) { const s = cos(sv, caseVec); if (s > best) best = s }
      relevance = coverageFrac(best)
    }

    const strong = results.filter(r => r.frac >= 0.66).map(r => r.name)
    const weak = results.filter(r => r.frac < 0.4).map(r => r.name)
    let fb = ''
    if (strong.length) fb += `Addresses ${strong.join(', ')} well. `
    if (weak.length) fb += `Under-covers ${weak.join(', ')}. `
    if (relevance != null && relevance < 0.4) fb += 'May drift from the case prompt. '
    fb += 'On-device coverage estimate — review before saving.'

    out.push({ groupId: g.id, name: g.name, score, feedback: fb.trim(), relevance, copies: [], criteria: results.map(r => ({ name: r.name, met: r.met, points: r.points })), _centroid: meanVec(subVecs) })
  }

  // Cross-group copy check on submission centroids.
  const COPY = 0.92
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue
      if (out[i]._centroid && out[j]._centroid && cos(out[i]._centroid, out[j]._centroid) >= COPY) out[i].copies.push(out[j].name)
    }
  }
  out.forEach(o => { delete o._centroid })
  return out
}

/**
 * Form balanced groups from a roster. When prior submission text is available
 * per student, embeddings spread similar students across different groups
 * (diversity); otherwise it falls back to a balanced shuffle.
 * @param {Array<{id,name}>} students
 * @param {number} size desired members per group
 * @param {Object<string,string>} [pastText] studentId → concatenated prior work
 * @returns {Promise<Array<{id,name,memberIds:string[]}>>}
 */
export async function autoFormGroups(students, size, pastText = {}) {
  const roster = (students || []).filter(s => s && s.id)
  const n = roster.length
  const groupCount = Math.max(1, Math.ceil(n / Math.max(2, size || 3)))
  const groups = Array.from({ length: groupCount }, (_, i) => ({ id: 'g_' + Date.now() + '_' + i, name: `Group ${i + 1}`, memberIds: [] }))

  // Order students: by diversity if we have text + a model, else shuffled.
  let ordered = roster
  const withText = roster.filter(s => String(pastText[s.id] || '').trim().length > 20)
  if (withText.length >= Math.min(4, n)) {
    try {
      const extractor = await ensureExtractor()
      const vecs = await embedAll(extractor, roster.map(s => String(pastText[s.id] || s.name).slice(0, 600)))
      const centroid = meanVec(vecs)
      // Sort by similarity to the class centroid; snake-drafting this order
      // spreads typical and atypical work evenly across groups.
      ordered = roster
        .map((s, i) => ({ s, sim: centroid ? cos(vecs[i], centroid) : 0 }))
        .sort((a, b) => b.sim - a.sim)
        .map(x => x.s)
    } catch { ordered = [...roster].sort(() => Math.random() - 0.5) }
  } else {
    ordered = [...roster].sort(() => Math.random() - 0.5)
  }

  // Snake draft for balanced sizes.
  let gi = 0, dir = 1
  for (const s of ordered) {
    groups[gi].memberIds.push(s.id)
    gi += dir
    if (gi === groupCount) { gi = groupCount - 1; dir = -1 } else if (gi < 0) { gi = 0; dir = 1 }
  }
  return groups
}
