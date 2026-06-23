// ── Live Quiz (Kahoot-style) — pure game logic ──────────────────────────────
// Shared by the host (admin) and player (student) UIs so scoring, correctness,
// and the leaderboard agree everywhere. No Firestore here — writes live in
// src/firebase/liveQuiz.js; this is the derived/computed half.

// Live mode only supports tappable question types (multiple choice + true/false).
export function playableQuestions(questions = []) {
  return (questions || []).filter(q =>
    q && (
      q.type === 'true_false' ||
      (q.type === 'multiple_choice' && Array.isArray(q.options) && q.options.length >= 2)
    )
  )
}

// The tappable options for a question.
export function optionsFor(q) {
  if (!q) return []
  if (q.type === 'true_false') return ['True', 'False']
  return Array.isArray(q.options) ? q.options : []
}

// Correctness — mirrors the quiz auto-grader for MC/TF (exact match).
export function isCorrect(q, ans) {
  const a = String(ans ?? '').trim().toLowerCase()
  const c = String(q?.answer ?? '').trim().toLowerCase()
  return !!a && a === c
}

// Points: correct answers earn a base + a speed bonus (faster = more), so the
// leaderboard rewards both accuracy and quickness — like the game it mimics.
export function pointsFor(correct, elapsedMs, perQuestionSeconds) {
  if (!correct) return 0
  const window = Math.max(1, perQuestionSeconds) * 1000
  const frac = Math.max(0, 1 - (elapsedMs || 0) / window)
  return Math.round(500 + 500 * frac)
}

// Leaderboard from a session's players map: total points + correct count, desc.
export function leaderboard(session) {
  const players = session?.players || {}
  return Object.entries(players)
    .map(([pid, p]) => {
      const answers = p?.answers || {}
      const vals = Object.values(answers)
      return {
        pid,
        name: p?.name || pid,
        score: vals.reduce((s, a) => s + (a?.points || 0), 0),
        correct: vals.filter(a => a?.correct).length,
      }
    })
    .sort((a, b) => b.score - a.score || b.correct - a.correct)
}

// How many players have answered the current question.
export function answeredCount(session) {
  const players = session?.players || {}
  const idx = session?.currentIndex
  if (idx == null || idx < 0) return 0
  return Object.values(players).filter(p => p?.answers && p.answers[idx] != null).length
}

// Per-option tallies for the current question (for the reveal bar chart).
export function optionTallies(session, q) {
  const opts = optionsFor(q)
  const counts = opts.map(() => 0)
  const players = session?.players || {}
  const idx = session?.currentIndex
  if (idx == null || idx < 0) return counts
  for (const p of Object.values(players)) {
    const a = p?.answers?.[idx]
    if (!a) continue
    const oi = opts.findIndex(o => String(o).toLowerCase() === String(a.choice).toLowerCase())
    if (oi >= 0) counts[oi] += 1
  }
  return counts
}
