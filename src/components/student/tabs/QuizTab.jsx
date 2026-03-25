import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Badge from '@/components/primitives/Badge'
import Modal from '@/components/primitives/Modal'

// ── Score computation ─────────────────────────────────────────────────────────
function computeScore(questions, answers) {
  let score = 0
  questions.forEach((q, i) => {
    const studentAns = (answers[i] || '').trim().toLowerCase()
    const correctAns = (q.answer || '').trim().toLowerCase()
    if (!studentAns) return
    if (q.type === 'multiple_choice' || q.type === 'true_false') {
      if (studentAns === correctAns) score++
    } else {
      // short_answer, fill_in_the_blank, identification — partial match
      if (correctAns && studentAns.includes(correctAns)) score++
      else if (correctAns && correctAns.includes(studentAns) && studentAns.length >= 3) score++
    }
  })
  return score
}

// ── Countdown ─────────────────────────────────────────────────────────────────
function useCountdown(seconds) {
  const [remaining, setRemaining] = useState(seconds)
  const expiredRef = useRef(false)

  useEffect(() => {
    if (remaining <= 0) { expiredRef.current = true; return }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining])

  const formatted = useMemo(() => {
    const m = Math.floor(remaining / 60)
    const s = remaining % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [remaining])

  return { remaining, formatted, expired: remaining <= 0 }
}

// ── Quiz Taking Modal ─────────────────────────────────────────────────────────
function QuizTakingModal({ quiz, student, onClose, onSubmitted }) {
  const { db, fbReady, students, saveStudents } = useData()
  const { toast } = useUI()

  const totalSecs = quiz.timeLimit * 60
  const startRef = useRef(Date.now())
  const [answers, setAnswers] = useState(() => Array(quiz.questions.length).fill(''))
  const [currentQ, setCurrentQ] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [finalScore, setFinalScore] = useState(null)

  const { remaining, formatted, expired } = useCountdown(totalSecs)

  // Auto-submit when time expires
  const handleSubmit = useCallback(async (isAuto = false) => {
    if (submitting || submitted) return
    setSubmitting(true)

    const timeTaken = Math.round((Date.now() - startRef.current) / 1000)
    const score = computeScore(quiz.questions, answers)
    const total = quiz.questions.length
    const pct = total > 0 ? Math.round((score / total) * 100 * 100) / 100 : 0

    try {
      if (!fbReady || !db.current) throw new Error('Firebase not ready')

      // 1. Write submission to quiz doc
      const subPath = `submissions.${student.id}`
      await updateDoc(doc(db.current, 'quizzes', quiz.id), {
        [`${subPath}.score`]: score,
        [`${subPath}.timeTaken`]: timeTaken,
        [`${subPath}.answers`]: answers,
        [`${subPath}.submittedAt`]: Date.now(),
      })

      // 2. Write quiz score to student gradeComponents
      const subject = quiz.subject
      const gradeComponents = student.gradeComponents || {}
      const subjectGC = gradeComponents[subject] || {}
      const existingQuizzes = subjectGC.quizzes || []

      // Upsert: replace if quiz already scored, else append
      const existingIdx = existingQuizzes.findIndex(q => q.quizId === quiz.id)
      const quizEntry = { quizId: quiz.id, title: quiz.title, score, total, pct, submittedAt: Date.now() }
      let updatedQuizzes
      if (existingIdx >= 0) {
        updatedQuizzes = existingQuizzes.map((q, i) => i === existingIdx ? quizEntry : q)
      } else {
        updatedQuizzes = [...existingQuizzes, quizEntry]
      }

      const updatedGC = {
        ...gradeComponents,
        [subject]: { ...subjectGC, quizzes: updatedQuizzes },
      }

      // Update student doc in Firestore
      await updateDoc(doc(db.current, 'students', student.id), {
        gradeComponents: updatedGC,
      })

      setFinalScore({ score, total, pct })
      setSubmitted(true)
      toast(isAuto ? `⏰ Time's up! Score: ${score}/${total}` : `✅ Submitted! Score: ${score}/${total}`, 'success')
      onSubmitted({ score, total, pct })
    } catch (e) {
      toast('Submission failed: ' + e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, submitted, answers, quiz, student, db, fbReady])

  // Trigger auto-submit when time expires
  useEffect(() => {
    if (expired && !submitted && !submitting) {
      handleSubmit(true)
    }
  }, [expired])

  const q = quiz.questions[currentQ]
  const total = quiz.questions.length

  // Submitted result screen
  if (submitted && finalScore) {
    const { score, total, pct } = finalScore
    const passed = pct >= 75
    return (
      <Modal onClose={onClose} size="md">
        <div className="text-center py-4">
          <div style={{ fontSize: 56, marginBottom: 8 }}>{passed ? '🎉' : '📝'}</div>
          <h3 className="text-xl font-bold text-ink mb-1">Quiz Submitted!</h3>
          <p className="text-ink2 text-sm mb-6">{quiz.title}</p>
          <div style={{
            background: passed ? 'var(--green-l)' : 'var(--red-l)',
            color: passed ? 'var(--c-green)' : 'var(--c-red)',
            borderRadius: 12, padding: '20px 32px', marginBottom: 20, display: 'inline-block',
          }}>
            <div style={{ fontSize: 36, fontWeight: 800 }}>{score}/{total}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{pct}%</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{passed ? 'Passed ✓' : 'Below passing'}</div>
          </div>
          <p className="text-xs text-ink3 mb-6">Your score has been saved to your grades automatically.</p>
          <button className="btn btn-primary w-full" onClick={onClose}>Close</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={null} size="lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-ink">{quiz.title}</h3>
          <p className="text-xs text-ink2">{quiz.subject} · {total} questions</p>
        </div>
        <div style={{
          fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: remaining <= 60 ? 'var(--c-red)' : remaining <= 300 ? '#f59e0b' : 'var(--c-green)',
          background: 'var(--c-surface2)', borderRadius: 8, padding: '6px 14px',
        }}>
          ⏱ {formatted}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: 'var(--c-primary)',
          width: `${((currentQ + 1) / total) * 100}%`, transition: 'width 0.3s',
        }} />
      </div>

      {/* Question navigator */}
      <div className="flex flex-wrap gap-1 mb-4">
        {quiz.questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentQ(i)}
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1.5px solid',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              borderColor: i === currentQ ? 'var(--c-primary)' : answers[i] ? 'var(--c-green)' : 'var(--border)',
              background: i === currentQ ? 'var(--c-primary)' : answers[i] ? 'var(--green-l)' : 'var(--c-surface)',
              color: i === currentQ ? '#fff' : answers[i] ? 'var(--c-green)' : 'var(--ink2)',
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current question */}
      <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: '16px 18px', marginBottom: 20, minHeight: 180 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', marginBottom: 8 }}>
          Question {currentQ + 1} of {total} · {q.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.5 }}>
          {q.question}
        </p>

        {/* Multiple choice */}
        {q.type === 'multiple_choice' && q.options && (
          <div className="flex flex-col gap-2">
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                onClick={() => {
                  const next = [...answers]
                  next[currentQ] = opt
                  setAnswers(next)
                }}
                style={{
                  textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                  border: `2px solid ${answers[currentQ] === opt ? 'var(--c-primary)' : 'var(--border)'}`,
                  background: answers[currentQ] === opt ? 'color-mix(in srgb, var(--c-primary) 10%, transparent)' : 'var(--c-surface)',
                  color: 'var(--ink)', fontSize: 13, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: answers[currentQ] === opt ? 'var(--c-primary)' : 'var(--border)',
                  color: answers[currentQ] === opt ? '#fff' : 'var(--ink2)',
                }}>
                  {String.fromCharCode(65 + oi)}
                </span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
        )}

        {/* True/False */}
        {q.type === 'true_false' && (
          <div className="flex gap-3">
            {['True', 'False'].map(opt => (
              <button
                key={opt}
                onClick={() => {
                  const next = [...answers]
                  next[currentQ] = opt
                  setAnswers(next)
                }}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${answers[currentQ] === opt ? (opt === 'True' ? '#22c55e' : '#ef4444') : 'var(--border)'}`,
                  background: answers[currentQ] === opt ? (opt === 'True' ? 'var(--green-l)' : 'var(--red-l)') : 'var(--c-surface)',
                  color: answers[currentQ] === opt ? (opt === 'True' ? 'var(--c-green)' : 'var(--c-red)') : 'var(--ink2)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {opt === 'True' ? '✓ True' : '✗ False'}
              </button>
            ))}
          </div>
        )}

        {/* Text answer types */}
        {['short_answer', 'fill_in_the_blank', 'identification'].includes(q.type) && (
          <textarea
            className="input w-full"
            rows={q.type === 'short_answer' ? 3 : 2}
            placeholder={
              q.type === 'fill_in_the_blank' ? 'Type the missing word or phrase…'
              : q.type === 'identification' ? 'Identify the term or concept…'
              : 'Write your answer here…'
            }
            value={answers[currentQ]}
            onChange={e => {
              const next = [...answers]
              next[currentQ] = e.target.value
              setAnswers(next)
            }}
            style={{ marginTop: 4, fontSize: 13 }}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
          disabled={currentQ === 0}
        >
          ← Prev
        </button>

        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>
          {answers.filter(Boolean).length}/{total} answered
        </span>

        {currentQ < total - 1 ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setCurrentQ(q => Math.min(total - 1, q + 1))}
          >
            Next →
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : '✅ Submit Quiz'}
          </button>
        )}
      </div>
    </Modal>
  )
}

// ── Review Modal (post-submission) ────────────────────────────────────────────
function QuizReviewModal({ quiz, submission, onClose }) {
  return (
    <Modal onClose={onClose} size="lg">
      <h3 className="text-base font-bold text-ink mb-1">📋 {quiz.title} — Review</h3>
      <p className="text-xs text-ink2 mb-4">
        Score: <strong>{submission.score}/{quiz.questions.length}</strong> · {((submission.score / quiz.questions.length) * 100).toFixed(1)}%
      </p>
      <div className="flex flex-col gap-3" style={{ maxHeight: 400, overflowY: 'auto' }}>
        {quiz.questions.map((q, i) => {
          const studentAns = (submission.answers?.[i] || '').toString()
          const correct = (q.answer || '').trim().toLowerCase()
          const given = studentAns.trim().toLowerCase()
          let isCorrect = false
          if (q.type === 'multiple_choice' || q.type === 'true_false') {
            isCorrect = given === correct
          } else {
            isCorrect = correct && (given.includes(correct) || (correct.includes(given) && given.length >= 3))
          }

          return (
            <div key={i} style={{
              background: 'var(--c-surface2)', borderRadius: 8, padding: '12px 14px',
              borderLeft: `4px solid ${isCorrect ? '#22c55e' : '#ef4444'}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', marginBottom: 4 }}>
                Q{i + 1} · {q.type.replace(/_/g, ' ')} · {isCorrect ? '✅ Correct' : '❌ Wrong'}
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 6 }}>{q.question}</p>
              <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
                Your answer: <span style={{ fontWeight: 600, color: isCorrect ? 'var(--c-green)' : 'var(--c-red)' }}>
                  {studentAns || '—'}
                </span>
              </div>
              {!isCorrect && (
                <div style={{ fontSize: 12, color: 'var(--c-green)', marginTop: 2 }}>
                  Correct answer: <strong>{q.answer}</strong>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="modal-footer mt-4">
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

// ── Main Student Quiz Tab ─────────────────────────────────────────────────────
export default function StudentQuizTab({ student, viewClassId }) {
  const { quizzes } = useData()
  const [takingQuiz, setTakingQuiz] = useState(null)
  const [reviewQuiz, setReviewQuiz] = useState(null)

  const now = Date.now()

  // Classes the student belongs to
  const studentClassIds = useMemo(() => {
    return student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
  }, [student])

  // Filter quizzes assigned to this student's classes
  const myQuizzes = useMemo(() => {
    return quizzes
      .filter(q => q.classIds?.some(id => studentClassIds.includes(id)))
      .sort((a, b) => {
        // Open first, then upcoming, then closed
        const statusOrder = q => {
          if (now >= q.openAt && now <= q.closeAt) return 0
          if (now < q.openAt) return 1
          return 2
        }
        const diff = statusOrder(a) - statusOrder(b)
        if (diff !== 0) return diff
        return b.openAt - a.openAt
      })
  }, [quizzes, studentClassIds, now])

  function getStatus(q) {
    const sub = q.submissions?.[student.id]
    if (sub) return { label: 'Completed', variant: 'green', done: true, score: sub.score, total: q.questions?.length || 0 }
    if (now < q.openAt) return { label: 'Upcoming', variant: 'blue', done: false }
    if (now > q.closeAt) return { label: 'Missed', variant: 'red', done: false }
    return { label: 'Open', variant: 'green', done: false, canTake: true }
  }

  function handleSubmitted(quizId, result) {
    // After submission the quiz list will refresh via Firestore listener
  }

  if (!myQuizzes.length) {
    return (
      <div className="empty">
        <div className="empty-icon" style={{ fontSize: '2rem' }}>📝</div>
        <p>No quizzes assigned yet.</p>
        <p className="text-xs text-ink3 mt-1">Your teacher will share quizzes here.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">My Quizzes</div>
        <span className="text-xs text-ink2">{myQuizzes.filter(q => !q.submissions?.[student.id] && now >= q.openAt && now <= q.closeAt).length} open</span>
      </div>

      <div className="flex flex-col gap-3">
        {myQuizzes.map(q => {
          const status = getStatus(q)
          const openLabel = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          const sub = q.submissions?.[student.id]

          return (
            <div key={q.id} className="card card-pad">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <strong style={{ fontSize: 14 }}>{q.title}</strong>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Badge variant="blue">{q.subject}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 2 }}>
                    {q.questions?.length || 0} questions · {q.timeLimit} min time limit
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                    Open: {openLabel} · Close: {closeLabel}
                  </div>
                  {status.done && sub && (
                    <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: status.score / status.total >= 0.75 ? 'var(--c-green)' : 'var(--c-red)' }}>
                      Score: {sub.score}/{q.questions?.length || 0} ({((sub.score / (q.questions?.length || 1)) * 100).toFixed(1)}%)
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5 flex-col flex-shrink-0" style={{ alignItems: 'flex-end' }}>
                  {status.canTake && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setTakingQuiz(q)}
                    >
                      Take Quiz →
                    </button>
                  )}
                  {status.done && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setReviewQuiz(q)}
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {takingQuiz && (
        <QuizTakingModal
          quiz={takingQuiz}
          student={student}
          onClose={() => setTakingQuiz(null)}
          onSubmitted={(result) => handleSubmitted(takingQuiz.id, result)}
        />
      )}
      {reviewQuiz && (
        <QuizReviewModal
          quiz={reviewQuiz}
          submission={reviewQuiz.submissions?.[student.id]}
          onClose={() => setReviewQuiz(null)}
        />
      )}
    </div>
  )
}
