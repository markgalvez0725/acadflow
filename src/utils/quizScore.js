// ── Quiz scoring ──────────────────────────────────────────────────────────────
// Centralized, dependency-free scoring shared by quiz taking and review:
//   • multiple_choice / true_false → exact (case-insensitive) match
//   • text types (short_answer / fill_in_the_blank / identification) → exact,
//     substring, OR fuzzy match against the model answer and any professor-defined
//     `acceptedAnswers` (alternates)
//   • optional per-question `points` (default 1) and optional partial credit
//     (half points for a near-miss) when the quiz enables it.
//
// Keeping this in one place means the student's live score and the professor's
// review always agree.

function norm(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Levenshtein edit distance (iterative, two-row).
function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

// Normalized similarity 0..1 between two strings.
export function similarity(a, b) {
  const x = norm(a), y = norm(b)
  if (!x && !y) return 1
  if (!x || !y) return 0
  if (x === y) return 1
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

// The set of acceptable keys for a question: model answer + alternates.
export function answerKeys(q) {
  const keys = [q.answer]
  if (Array.isArray(q.acceptedAnswers)) keys.push(...q.acceptedAnswers)
  return keys.map(k => String(k ?? '').trim()).filter(Boolean)
}

// Does a student's text answer match any key (exact, substring, or fuzzy)?
export function textMatches(studentAns, keys, { fuzz = 0.85 } = {}) {
  const s = norm(studentAns)
  if (!s) return false
  for (const k of keys) {
    const key = norm(k)
    if (!key) continue
    if (s === key) return true
    if (s.includes(key)) return true
    if (key.includes(s) && s.length >= 3) return true
    if (similarity(s, key) >= fuzz) return true
  }
  return false
}

// Points assigned to a question (default 1).
export function questionPoints(q) {
  return (typeof q.points === 'number' && q.points > 0) ? q.points : 1
}

// Grade a single question → { correct, awarded, points }.
export function gradeQuestion(q, studentAns, opts = {}) {
  const fuzz = opts.fuzz ?? 0.85
  const partialFuzz = opts.partialFuzz ?? 0.6
  const partialCredit = !!opts.partialCredit
  const points = questionPoints(q)
  const isObjective = q.type === 'multiple_choice' || q.type === 'true_false'
  const sa = norm(studentAns)

  if (!sa) return { correct: false, awarded: 0, points }

  if (isObjective) {
    const correct = sa === norm(q.answer)
    return { correct, awarded: correct ? points : 0, points }
  }

  const keys = answerKeys(q)
  if (textMatches(studentAns, keys, { fuzz })) return { correct: true, awarded: points, points }

  if (partialCredit) {
    const best = keys.reduce((m, k) => Math.max(m, similarity(studentAns, k)), 0)
    if (best >= partialFuzz) return { correct: false, awarded: Math.round((points / 2) * 100) / 100, points }
  }
  return { correct: false, awarded: 0, points }
}

// Grade a whole quiz → { score, total, perQuestion: [{correct, awarded, points}] }.
// `quiz` may carry a `partialCredit` flag; opts can override.
export function computeQuizScore(questions, answers, opts = {}) {
  let score = 0, total = 0
  const perQuestion = (questions || []).map((q, i) => {
    const res = gradeQuestion(q, answers?.[i], opts)
    score += res.awarded
    total += res.points
    return res
  })
  return {
    score: Math.round(score * 100) / 100,
    total: Math.round(total * 100) / 100,
    perQuestion,
  }
}
