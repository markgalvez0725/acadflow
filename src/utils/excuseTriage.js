// ── Excuse triage (#26) ───────────────────────────────────────────────────────
// Decision *support* for pending attendance excuse requests - never a verdict.
// Ranks and tags requests so a professor can scan the ones needing attention first,
// using the shared on-device embedding model (no generation, nothing uploaded).
// Signals:
//   • category    - nearest archetype (Medical / Family / Bereavement / Transport /
//                   School activity), else "Other"
//   • substance   - Detailed / Brief / Vague (word count + similarity to a bank of
//                   low-effort phrases like "sick" / "personal reasons")
//   • frequent    - how many requests this student has filed for this class
//   • stale       - how long the request has been pending
//   • copy        - two students' reasons near-identical (possible copy-paste)
// Reorders so attention-worthy requests (vague, frequent, possible-copy, stale)
// surface; Approve/Deny are untouched. Degrades gracefully: if the model can't
// load, word-count substance + frequency + staleness + exact-duplicate still run.

import { ensureExtractor, embedAll, cos } from '@/utils/embeddings'

const DAY = 86400000

const CATEGORIES = [
  { key: 'Medical',         seeds: ['sick', 'fever', 'doctor appointment', 'hospital', 'illness', 'flu', 'medical checkup', 'not feeling well', 'headache', 'stomach ache', 'may sakit', 'lagnat'] },
  { key: 'Family',          seeds: ['family emergency', 'family matter', 'household problem', 'parent needed help', 'sibling', 'family obligation', 'usapang pamilya'] },
  { key: 'Bereavement',     seeds: ['death in the family', 'passed away', 'funeral', 'wake', 'grandparent died', 'namatay'] },
  { key: 'Transport',       seeds: ['no ride', 'transportation problem', 'flood', 'typhoon', 'heavy rain', 'commute problem', 'flat tire', 'car broke down', 'baha', 'walang sasakyan'] },
  { key: 'School activity', seeds: ['school event', 'competition', 'training', 'seminar', 'field trip', 'representing the school', 'org activity', 'practice', 'paligsahan'] },
]
const LOW_EFFORT = ['sick', 'absent', 'personal reasons', "wasn't feeling well", 'emergency', "can't attend", 'reason', 'wala lang', 'di makakapasok']

const norm = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.?!,;:]+$/, '')
const wordCount = s => { const n = norm(s); return n ? n.split(' ').length : 0 }

function meanUnit(vecs) {
  if (!vecs.length) return null
  const out = new Array(vecs[0].length).fill(0)
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i]
  let n = 0
  for (let i = 0; i < out.length; i++) { out[i] /= vecs.length; n += out[i] * out[i] }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < out.length; i++) out[i] /= n
  return out
}

/**
 * Triage pending excuse requests.
 * @param {Array} pending - pending requests for the selected class ({ id, studentId, reason, createdAt, date })
 * @param {Array} allRequests - every excuse request (any status) - for frequency
 * @param {{ classId?: string, now?: number }} opts
 * @returns {Promise<{ byId: Record<string,object>, order: string[], modelUsed: boolean }>}
 */
export async function triageExcuses(pending, allRequests, opts = {}) {
  const reqs = pending || []
  const T = opts.now || Date.now()
  const out = { byId: {}, order: reqs.map(r => r.id), modelUsed: false }
  if (!reqs.length) return out

  // Frequency within the selected class (any status), keyed by student.
  const freq = {}
  ;(allRequests || []).forEach(r => {
    if (opts.classId && r.classId !== opts.classId) return
    freq[r.studentId] = (freq[r.studentId] || 0) + 1
  })

  // Try embeddings; degrade gracefully.
  let extractor = null
  try { extractor = await ensureExtractor() } catch { extractor = null }

  let reasonVecs = null
  const catVecs = []
  let lowEffortVec = null
  if (extractor) {
    try {
      // One batched embed: all category seeds + low-effort bank + each reason.
      const seedTexts = CATEGORIES.flatMap(c => c.seeds)
      const texts = [...seedTexts, ...LOW_EFFORT, ...reqs.map(r => norm(r.reason) || ' ')]
      const all = await embedAll(extractor, texts)
      let off = 0
      for (const c of CATEGORIES) { catVecs.push(meanUnit(all.slice(off, off + c.seeds.length))); off += c.seeds.length }
      lowEffortVec = meanUnit(all.slice(off, off + LOW_EFFORT.length)); off += LOW_EFFORT.length
      reasonVecs = all.slice(off)
      out.modelUsed = true
    } catch { reasonVecs = null; out.modelUsed = false }
  }

  // Per-request signals.
  reqs.forEach((r, i) => {
    const words = wordCount(r.reason)
    const ageDays = Math.max(0, (T - (r.createdAt || T)) / DAY)
    const freqCount = freq[r.studentId] || 1
    const frequent = freqCount >= 3

    // Category (embeddings only).
    let category = 'Other'
    if (reasonVecs && words > 0) {
      let best = -1, bestKey = 'Other'
      catVecs.forEach((cv, ci) => { if (!cv) return; const s = cos(reasonVecs[i], cv); if (s > best) { best = s; bestKey = CATEGORIES[ci].key } })
      if (best >= 0.30) category = bestKey
    }

    // Substance - word count, refined by low-effort similarity.
    let substance
    const lowSim = (reasonVecs && lowEffortVec) ? cos(reasonVecs[i], lowEffortVec) : 0
    if (words >= 8) substance = 'Detailed'
    else if (words >= 3) substance = (lowSim >= 0.72 ? 'Vague' : 'Brief')
    else substance = 'Vague'

    const stale = ageDays >= 3

    out.byId[r.id] = { id: r.id, category, substance, freqCount, frequent, stale, ageDays, copy: false, copyWith: null, score: 0 }
  })

  // Possible copy-paste - pairwise near-identical reasons (embedding or exact).
  for (let i = 0; i < reqs.length; i++) {
    for (let j = i + 1; j < reqs.length; j++) {
      if (reqs[i].studentId === reqs[j].studentId) continue
      const a = norm(reqs[i].reason), b = norm(reqs[j].reason)
      if (!a || !b || wordCount(a) < 2) continue
      const same = a === b || (reasonVecs ? cos(reasonVecs[i], reasonVecs[j]) >= 0.95 : false)
      if (same) {
        out.byId[reqs[i].id].copy = true; out.byId[reqs[i].id].copyWith = reqs[j].studentName
        out.byId[reqs[j].id].copy = true; out.byId[reqs[j].id].copyWith = reqs[i].studentName
      }
    }
  }

  // Attention score (higher = surface sooner). Tiebreak: older pending first.
  reqs.forEach(r => {
    const m = out.byId[r.id]
    let score = Math.min(m.ageDays, 14) * 0.5
    if (m.substance === 'Vague') score += 3
    else if (m.substance === 'Brief') score += 1
    if (m.frequent) score += 2.5
    if (m.copy) score += 4
    m.score = score
  })

  out.order = reqs.slice().sort((a, b) => {
    const d = out.byId[b.id].score - out.byId[a.id].score
    return d !== 0 ? d : (a.createdAt || 0) - (b.createdAt || 0)
  }).map(r => r.id)

  return out
}
