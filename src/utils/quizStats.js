// ── Quiz item analysis ─────────────────────────────────────────────────────
// Aggregates per-question performance from stored submissions so a teacher can
// see which items were hardest and which wrong answers were most common.
// Correctness rules MUST mirror computeScore() in student/tabs/QuizTab.jsx -
// answers are a position-indexed array of strings.

// Is a single student answer correct for this question? (Same logic as the
// student grader: exact match for MC/TF, substring tolerance otherwise.)
export function isAnswerCorrect(q, rawAns) {
  const studentAns = (rawAns || '').trim().toLowerCase()
  const correctAns = (q?.answer || '').trim().toLowerCase()
  if (!studentAns || !correctAns) return false
  if (q.type === 'multiple_choice' || q.type === 'true_false') {
    return studentAns === correctAns
  }
  if (studentAns.includes(correctAns)) return true
  if (correctAns.includes(studentAns) && studentAns.length >= 3) return true
  return false
}

// Returns { responseCount, items: [...] } for a quiz. Each item carries the
// question, type, how many answered, how many correct, correct %, and (for
// multiple choice) the distribution of chosen options with a flagged top wrong.
export function quizItemAnalysis(quiz) {
  const questions = quiz?.questions || []
  const subs = Object.values(quiz?.submissions || {}).filter(s => Array.isArray(s?.answers))
  const responseCount = subs.length

  const items = questions.map((q, i) => {
    let answered = 0
    let correct = 0
    const optionCounts = {} // raw answer string → count

    for (const s of subs) {
      const ans = s.answers[i]
      const has = ans != null && String(ans).trim() !== ''
      if (has) {
        answered += 1
        const key = String(ans)
        optionCounts[key] = (optionCounts[key] || 0) + 1
      }
      if (isAnswerCorrect(q, ans)) correct += 1
    }

    // For MC, line option counts up against the defined options.
    let options = null
    if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
      options = q.options.map(opt => ({
        text: opt,
        count: optionCounts[opt] || 0,
        isCorrect: (opt || '').trim().toLowerCase() === (q.answer || '').trim().toLowerCase(),
      }))
    }

    // Most-chosen wrong answer (across any type).
    let topWrong = null
    for (const [text, count] of Object.entries(optionCounts)) {
      if (isAnswerCorrect(q, text)) continue
      if (!topWrong || count > topWrong.count) topWrong = { text, count }
    }

    return {
      index: i,
      question: q.question || `Question ${i + 1}`,
      type: q.type,
      answer: q.answer,
      answered,
      correct,
      correctPct: responseCount ? Math.round((correct / responseCount) * 100) : 0,
      options,
      topWrong,
    }
  })

  return { responseCount, items }
}
