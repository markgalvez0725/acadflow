import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  PartyPopper, FileText, Timer, Check, X, CheckCircle2, ClipboardList, XCircle, ShieldAlert,
  Lightbulb, ShieldCheck, Clock, RefreshCw, Trophy, CalendarClock, Pencil, Maximize2,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import StandingRing from '@/components/primitives/StandingRing'
import EmptyState from '@/components/ds/EmptyState'
import { activeClassIds } from '@/utils/active'
import { subjectColor } from '@/utils/subjectColor'
import { computeQuizScore } from '@/utils/quizScore'

const HOUR = 3600000

// Short "closes in …" label for the Quiz Watch validator.
function closeIn(ms) {
  if (ms <= 0) return 'now'
  const h = Math.floor(ms / HOUR)
  if (h >= 24) return `in ${Math.floor(h / 24)}d`
  if (h >= 1) return `in ${h}h`
  return `in ${Math.max(1, Math.floor(ms / 60000))}m`
}

// Best-effort OS fullscreen helpers (focus mode). Feature-detected; on platforms
// without the Fullscreen API (e.g. iOS Safari) the in-app focus panel still
// covers the viewport, so the quiz stays distraction-free either way.
function enterFullscreen() {
  const el = document.documentElement
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  try { fn && fn.call(el) } catch (e) { /* unsupported / blocked */ }
}
function exitFullscreen() {
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) return
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  try { fn && fn.call(document) } catch (e) { /* ignore */ }
}


// Fisher-Yates shuffle of [0..n-1] - the display order of questions.
function shuffleIndices(n) {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Countdown ─────────────────────────────────────────────────────────────────
// Wall-clock based: time remaining is derived from a fixed deadline timestamp,
// not a per-second decrement. This keeps the timer accurate even when the tab
// is backgrounded or the phone is asleep (where setTimeout/Interval is paused)
// - on return it recomputes from the real clock and resyncs immediately.
function useCountdown(deadlineMs) {
  const calc = () => Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000))
  const [remaining, setRemaining] = useState(calc)

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [deadlineMs])

  const formatted = useMemo(() => {
    const m = Math.floor(remaining / 60)
    const s = remaining % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [remaining])

  return { remaining, formatted, expired: remaining <= 0 }
}

// ── Quiz Taking Modal ─────────────────────────────────────────────────────────
function QuizTakingModal({ quiz, student, onClose, onSubmitted }) {
  const { db, fbReady, students, saveStudents, submitQuizResult } = useData()
  const { toast } = useUI()

  const totalSecs = quiz.timeLimit * 60

  // Autosave drafts: persist answers + the original start time to localStorage
  // so a closed/refreshed quiz can be resumed with the same time budget.
  const draftKey = `quizdraft:${quiz.id}:${student.id}`
  const draft = useMemo(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const d = JSON.parse(raw)
        if (Array.isArray(d.answers) && typeof d.startedAt === 'number') return d
      }
    } catch (e) { /* ignore corrupt draft */ }
    return null
  }, [draftKey])

  const startRef = useRef(draft?.startedAt || Date.now())
  const [answers, setAnswers] = useState(() => {
    const base = Array(quiz.questions.length).fill('')
    if (draft?.answers) draft.answers.forEach((a, i) => { if (i < base.length) base[i] = a || '' })
    return base
  })
  const [currentQ, setCurrentQ] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [finalScore, setFinalScore] = useState(null)

  // Focus mode: lock body scroll while taking, and leave OS fullscreen on close.
  // (Fullscreen is requested from the "Take quiz" click in the parent so the
  // user-gesture requirement is satisfied.) `isFs` drives a re-enter button if
  // the student presses Esc out of fullscreen mid-quiz.
  const [isFs, setIsFs] = useState(() => !!(document.fullscreenElement || document.webkitFullscreenElement))
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onFs = () => setIsFs(!!(document.fullscreenElement || document.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
      exitFullscreen()
    }
  }, [])

  // Anti-cheat: questions are shown in a shuffled order, and leaving the quiz
  // (switching tabs / apps) clears answers and reshuffles - see the effect below.
  const [order, setOrder] = useState(() => shuffleIndices(quiz.questions.length))
  const [leftCount, setLeftCount] = useState(0)
  const leftCountRef = useRef(0)     // synchronous mirror of leftCount
  const inFlightRef = useRef(false)  // suppress reset during submit/after submit

  // Sequential navigation: students must answer the current question before
  // moving forward; they can freely go back. `maxReached` is the furthest
  // question (display index) they've unlocked. Initialise from any restored
  // answers so a resumed draft stays navigable.
  const [maxReached, setMaxReached] = useState(() => {
    let m = 0
    order.forEach((origIdx, displayIdx) => {
      const a = answers[origIdx]
      if (a != null && String(a).trim() !== '') m = Math.max(m, displayIdx)
    })
    return m
  })

  // Fixed deadline anchored to the original start, so time keeps elapsing even
  // if the student backgrounds the app or turns the phone off.
  const deadline = startRef.current + totalSecs * 1000
  const { remaining, formatted, expired } = useCountdown(deadline)

  // Persist the draft on every change until the quiz is submitted.
  useEffect(() => {
    if (submitted) return
    try { localStorage.setItem(draftKey, JSON.stringify({ answers, startedAt: startRef.current })) } catch (e) { /* ignore */ }
  }, [answers, submitted, draftKey])

  // One-time notice when an in-progress draft is restored.
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (draft && !notifiedRef.current) { notifiedRef.current = true; toast('Resumed your in-progress quiz.', 'info') }
  }, [draft])

  // One-time heads-up about the leave-resets-progress rule.
  const ruleNotedRef = useRef(false)
  useEffect(() => {
    if (!ruleNotedRef.current) {
      ruleNotedRef.current = true
      toast('Stay on this screen - your first slip is a warning, then leaving resets your answers and reshuffles the questions.', 'warn')
    }
  }, [toast])

  // ── Anti-cheat: leaving the quiz warns once, then resets + reshuffles ──────
  // Switching browser tabs, minimizing, or switching apps (phone) is detected.
  // The FIRST time is a free warning (so an accidental switch isn't punished);
  // the second time on clears all answers and re-randomizes the question order
  // from the same pool. The timer keeps running from the original start.
  useEffect(() => {
    if (submitted) return
    // `away` dedupes a single switch (which fires BOTH visibilitychange and
    // blur) into one event; it clears when the student returns.
    let away = false
    let blurTimer = null
    const registerLeave = () => {
      if (away || submitted || inFlightRef.current) return
      away = true
      const n = leftCountRef.current + 1
      leftCountRef.current = n
      setLeftCount(n)
      if (n === 1) {
        // First slip - warn only, no penalty.
        toast('Heads up - if you leave the quiz again, your answers reset and the questions reshuffle.', 'warn', 5000)
        return
      }
      setAnswers(Array(quiz.questions.length).fill(''))
      setOrder(shuffleIndices(quiz.questions.length))
      setCurrentQ(0)
      setMaxReached(0)
      try { localStorage.removeItem(draftKey) } catch (e) { /* ignore */ }
      toast('You left the quiz - answers cleared and questions reshuffled.', 'error', 5000)
    }
    const back = () => { away = false }
    // visibilitychange: the reliable signal for tab switch, minimize, and mobile
    // / PWA app-switch (document becomes hidden).
    const onVisibility = () => { if (document.hidden) registerLeave(); else back() }
    // blur: covers desktop alt-tab to another app where the tab stays "visible";
    // confirm focus is really gone to avoid transient blurs.
    const onBlur = () => { blurTimer = setTimeout(() => { if (!document.hasFocus()) registerLeave() }, 350) }
    const onFocus = () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null } back() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', registerLeave) // PWA / app fully backgrounded
    return () => {
      if (blurTimer) clearTimeout(blurTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', registerLeave)
    }
  }, [submitted, quiz.questions.length, draftKey, toast])

  // Auto-submit when time expires
  const handleSubmit = useCallback(async (isAuto = false) => {
    if (submitting || submitted) return
    inFlightRef.current = true // don't let a blur during submit wipe answers
    setSubmitting(true)

    const timeTaken = Math.round((Date.now() - startRef.current) / 1000)
    const { score, total } = computeQuizScore(quiz.questions, answers, { partialCredit: !!quiz.partialCredit })
    const pct = total > 0 ? Math.round((score / total) * 100 * 100) / 100 : 0

    try {
      if (!fbReady || !db.current) throw new Error('Firebase not ready')

      // Submit through the data layer: it writes the authoritative submission to
      // the quiz doc (with anti-cheat signals timeTaken/leftCount) AND caches the
      // student's own per-quiz result on their student doc. The cache lives in
      // `quizResults` (NOT gradeComponents - students may not write grade fields),
      // and that students-doc write is echo-suppressed inside the helper.
      const subject = quiz.subject
      const quizResults = student.quizResults || {}
      const existing = quizResults[subject] || []
      const existingIdx = existing.findIndex(q => q.quizId === quiz.id)
      const quizEntry = { quizId: quiz.id, title: quiz.title, score, total, pct, submittedAt: Date.now() }
      const updatedList = existingIdx >= 0
        ? existing.map((q, i) => i === existingIdx ? quizEntry : q)
        : [...existing, quizEntry]

      await submitQuizResult({
        quizId: quiz.id,
        studentId: student.id,
        submission: { score, total, timeTaken, leftCount: leftCountRef.current, answers, submittedAt: Date.now() },
        quizResults: { ...quizResults, [subject]: updatedList },
      })

      try { localStorage.removeItem(draftKey) } catch (e) { /* ignore */ }
      exitFullscreen() // leave focus mode; show the result card normally
      setFinalScore({ score, total, pct })
      setSubmitted(true)
      toast(isAuto ? `Time's up! Score: ${score}/${total}` : `Submitted! Score: ${score}/${total}`, 'success')
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

  const qi = order[currentQ] ?? currentQ // original index of the shown question
  const q = quiz.questions[qi]
  const total = quiz.questions.length
  const currentAnswered = answers[qi] != null && String(answers[qi]).trim() !== ''

  // Submitted result screen
  if (submitted && finalScore) {
    const { score, total, pct } = finalScore
    const passed = pct >= 75
    return (
      <Modal onClose={onClose} size="md">
        <div className="text-center py-4">
          <div style={{ fontSize: 56, marginBottom: 8 }}>{passed ? <PartyPopper size={48} /> : <FileText size={48} />}</div>
          <h3 className="text-xl font-bold text-ink mb-1">Quiz Submitted!</h3>
          <p className="text-ink2 text-sm mb-6">{quiz.title}</p>
          <div style={{
            background: passed ? 'var(--green-l)' : 'var(--red-l)',
            color: passed ? 'var(--green)' : 'var(--red)',
            borderRadius: 12, padding: '20px 32px', marginBottom: 20, display: 'inline-block',
          }}>
            <div style={{ fontSize: 36, fontWeight: 800 }}>{score}/{total}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{pct}%</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{passed ? <>Passed <Check size={14} /></> : 'Below passing'}</div>
          </div>
          <p className="text-xs text-ink3 mb-6">Your score has been saved to your grades automatically.</p>
          <button className="btn btn-primary w-full" onClick={onClose}>Close</button>
        </div>
      </Modal>
    )
  }

  return (
    <div className="quiz-focus-overlay" role="dialog" aria-modal="true" aria-label={`Taking quiz: ${quiz.title}`}>
      <div className="quiz-focus-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-ink">{quiz.title}</h3>
          <p className="text-xs text-ink2">{quiz.subject} · {total} questions · Focus mode</p>
        </div>
        <div className="flex items-center gap-2">
          {!isFs && (
            <button
              type="button"
              className="quiz-focus-fsbtn"
              onClick={enterFullscreen}
              title="Enter fullscreen for distraction-free focus"
            >
              <Maximize2 size={14} /> Fullscreen
            </button>
          )}
          <div style={{
            fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: remaining <= 60 ? 'var(--red)' : remaining <= 300 ? '#f59e0b' : 'var(--green)',
            background: 'var(--surface2)', borderRadius: 8, padding: '6px 14px',
          }}>
            <Timer size={18} /> {formatted}
          </div>
        </div>
      </div>

      {/* Anti-cheat notice - neutral → amber warning (1st) → red (reset) */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
        padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.45,
        background: leftCount >= 2 ? 'var(--red-l)' : leftCount === 1 ? 'color-mix(in srgb, #f59e0b 14%, transparent)' : 'var(--surface2)',
        color: leftCount >= 2 ? 'var(--red)' : leftCount === 1 ? '#f59e0b' : 'var(--ink2)',
        border: `1px solid ${leftCount >= 2 ? 'color-mix(in srgb, var(--red) 40%, transparent)' : leftCount === 1 ? 'color-mix(in srgb, #f59e0b 45%, transparent)' : 'var(--border)'}`,
      }}>
        <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          {leftCount >= 2
            ? <>You’ve left {leftCount} times - your answers were cleared and the questions reshuffled. Stay on this screen until you submit.</>
            : leftCount === 1
              ? <><strong>Warning:</strong> you left the quiz. If you leave again, your answers reset and the questions reshuffle.</>
              : <>Stay on this screen until you submit. Your first slip is just a warning - after that, leaving clears your answers and reshuffles the questions.</>}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: 'var(--accent)',
          width: `${((currentQ + 1) / total) * 100}%`, transition: 'width 0.3s',
        }} />
      </div>

      {/* Question navigator */}
      <div className="flex flex-wrap gap-1 mb-4">
        {quiz.questions.map((_, i) => {
          const answered = answers[order[i] ?? i]
          const locked = i > maxReached // can't jump ahead of where you've reached
          return (
          <button
            key={i}
            onClick={() => { if (!locked) setCurrentQ(i) }}
            disabled={locked}
            title={locked ? 'Answer the current question first' : `Question ${i + 1}`}
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1.5px solid',
              fontSize: 11, fontWeight: 700, cursor: locked ? 'not-allowed' : 'pointer',
              opacity: locked ? 0.4 : 1,
              borderColor: i === currentQ ? 'var(--accent)' : answered ? 'var(--green)' : 'var(--border)',
              background: i === currentQ ? 'var(--accent)' : answered ? 'var(--green-l)' : 'var(--surface)',
              color: i === currentQ ? '#fff' : answered ? 'var(--green)' : 'var(--ink2)',
            }}
          >
            {i + 1}
          </button>
          )
        })}
      </div>

      {/* Current question */}
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '16px 18px', marginBottom: 20, minHeight: 180 }}>
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
                  next[qi] = opt
                  setAnswers(next)
                }}
                style={{
                  textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                  border: `2px solid ${answers[qi] === opt ? 'var(--accent)' : 'var(--border)'}`,
                  background: answers[qi] === opt ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface)',
                  color: 'var(--ink)', fontSize: 13, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: answers[qi] === opt ? 'var(--accent)' : 'var(--border)',
                  color: answers[qi] === opt ? '#fff' : 'var(--ink2)',
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
                  next[qi] = opt
                  setAnswers(next)
                }}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${answers[qi] === opt ? (opt === 'True' ? '#22c55e' : '#ef4444') : 'var(--border)'}`,
                  background: answers[qi] === opt ? (opt === 'True' ? 'var(--green-l)' : 'var(--red-l)') : 'var(--surface)',
                  color: answers[qi] === opt ? (opt === 'True' ? 'var(--green)' : 'var(--red)') : 'var(--ink2)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {opt === 'True' ? <><Check size={16} /> True</> : <><X size={16} /> False</>}
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
            value={answers[qi]}
            onChange={e => {
              const next = [...answers]
              next[qi] = e.target.value
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
          onClick={() => setCurrentQ(prev => Math.max(0, prev - 1))}
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
            disabled={!currentAnswered}
            title={!currentAnswered ? 'Answer this question to continue' : 'Next question'}
            onClick={() => {
              if (!currentAnswered) return
              const nx = Math.min(total - 1, currentQ + 1)
              setCurrentQ(nx)
              setMaxReached(m => Math.max(m, nx))
            }}
          >
            Next →
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : <><CheckCircle2 size={16} /> Submit Quiz</>}
          </button>
        )}
      </div>
      </div>
    </div>
  )
}

// ── Review Modal (post-submission) ────────────────────────────────────────────
function ReviewRow({ q, index, isCorrect, partial, studentAns }) {
  // Explanations are authored once when the quiz is generated (see the quiz
  // generator / Gemini endpoint) and stored on the question - so reviewing
  // never triggers a per-student network request.
  const exp = q.explanation ? String(q.explanation) : ''

  return (
    <div style={{
      background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', marginBottom: 4 }}>
        Q{index + 1} · {q.type.replace(/_/g, ' ')} · {isCorrect
          ? <><CheckCircle2 size={14} /> Correct</>
          : partial
            ? <span style={{ color: '#f59e0b' }}><CheckCircle2 size={14} /> Partial credit</span>
            : <><XCircle size={14} /> Wrong</>}
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 6 }}>{q.question}</p>
      <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
        Your answer: <span style={{ fontWeight: 600, color: isCorrect ? 'var(--green)' : 'var(--red)' }}>
          {studentAns || '-'}
        </span>
      </div>
      {!isCorrect && (
        <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
          Correct answer: <strong>{q.answer}</strong>
        </div>
      )}
      {exp && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Lightbulb size={12} /> Explanation
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.55 }}>{exp}</div>
        </div>
      )}
    </div>
  )
}

function QuizReviewModal({ quiz, submission, onClose }) {
  const graded = computeQuizScore(quiz.questions, submission.answers || [], { partialCredit: !!quiz.partialCredit })
  const total = submission.total ?? graded.total
  const score = submission.score ?? graded.score
  return (
    <Modal onClose={onClose} size="lg">
      <h3 className="text-base font-bold text-ink mb-1"><ClipboardList size={18} /> {quiz.title} - Review</h3>
      <p className="text-xs text-ink2 mb-4">
        Score: <strong>{score}/{total}</strong> · {total > 0 ? ((score / total) * 100).toFixed(1) : '0'}%
      </p>
      <div className="flex flex-col gap-3" style={{ maxHeight: 400, overflowY: 'auto' }}>
        {quiz.questions.map((q, i) => {
          const studentAns = (submission.answers?.[i] || '').toString()
          const res = graded.perQuestion[i] || { correct: false, awarded: 0, points: 1 }
          return (
            <ReviewRow key={i} q={q} index={i} isCorrect={res.correct} partial={res.awarded > 0 && !res.correct} studentAns={studentAns} />
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
  const { quizzes, fbReady, classes, semester } = useData()
  const [takingQuiz, setTakingQuiz] = useState(null)
  const [reviewQuiz, setReviewQuiz] = useState(null)

  const now = Date.now()

  // Classes the student belongs to (current, non-archived only)
  const studentClassIds = useMemo(
    () => activeClassIds(student, classes, semester),
    [student, classes, semester]
  )

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

  const [filter, setFilter] = useState('all')

  // Per-quiz standing - computed once, reused by the ring, Quiz Watch, the pill
  // counts, and each card, so nothing on screen can disagree.
  const decorated = useMemo(() => myQuizzes.map(q => {
    const sub = q.submissions?.[student.id]
    const totalPts = (q.totalPoints ?? q.questions?.length) || 0
    let group = 'open', scorePct = null, scoreText = null
    if (sub) {
      group = 'completed'
      const t = sub.total ?? totalPts
      scorePct = t > 0 ? Math.round((sub.score / t) * 100) : 0
      scoreText = `${sub.score}/${t}`
    } else if (now < q.openAt) group = 'upcoming'
    else if (now > q.closeAt) group = 'missed'
    const closesSoon = group === 'open' && (q.closeAt - now <= 24 * HOUR)
    return { q, sub, group, scorePct, scoreText, totalPts, closesSoon }
  }), [myQuizzes, student.id, now])

  const counts = useMemo(() => {
    const c = { all: decorated.length, open: 0, upcoming: 0, completed: 0, missed: 0 }
    decorated.forEach(d => { c[d.group]++ })
    return c
  }, [decorated])

  const ring = useMemo(() => {
    const done = decorated.filter(d => d.group === 'completed')
    const rate = done.length ? Math.round(done.reduce((s, d) => s + d.scorePct, 0) / done.length) : 0
    const color = !done.length ? 'var(--ink3)' : rate >= 75 ? 'var(--green)' : rate >= 50 ? 'var(--gold-var)' : 'var(--red)'
    return { rate, color, taken: done.length }
  }, [decorated])

  // Deterministic "Quiz Watch" findings - closing-soon, missed, review-worthy,
  // strongest subject. No network calls; recomputed from `decorated`.
  const watch = useMemo(() => {
    const f = []
    const open      = decorated.filter(d => d.group === 'open')
    const soon      = open.filter(d => d.closesSoon).sort((a, b) => a.q.closeAt - b.q.closeAt)
    const missed    = decorated.filter(d => d.group === 'missed')
    const completed = decorated.filter(d => d.group === 'completed')
    const upcoming  = decorated.filter(d => d.group === 'upcoming').sort((a, b) => a.q.openAt - b.q.openAt)
    if (soon.length) { const d = soon[0]; f.push({ tone: 'bad', Icon: Clock, lead: `Closes ${closeIn(d.q.closeAt - now)}`, text: ` - ${d.q.title} (${d.q.subject}), not taken yet.` }) }
    else if (open.length) f.push({ tone: 'info', Icon: Pencil, lead: `${open.length} open now`, text: ' - ready when you are.' })
    if (missed.length) f.push({ tone: 'bad', Icon: XCircle, lead: `${missed.length} missed`, text: ' - closed without an attempt.' })
    const lows = completed.filter(d => d.scorePct != null && d.scorePct < 75).sort((a, b) => a.scorePct - b.scorePct)
    if (lows.length) { const d = lows[0]; f.push({ tone: 'warn', Icon: RefreshCw, lead: 'Worth a review', text: ` - ${d.q.title} (${d.q.subject}) at ${d.scorePct}%.` }) }
    if (completed.length) {
      const bySub = {}
      completed.forEach(d => { const sj = d.q.subject || 'General'; (bySub[sj] ||= []).push(d.scorePct) })
      let best = null
      Object.entries(bySub).forEach(([sj, arr]) => { const avg = Math.round(arr.reduce((x, y) => x + y, 0) / arr.length); if (!best || avg > best.avg) best = { sj, avg } })
      if (best && !lows.length) f.push({ tone: best.avg >= 75 ? 'good' : 'warn', Icon: Trophy, lead: best.avg >= 75 ? 'Strongest' : `Avg ${ring.rate}%`, text: best.avg >= 75 ? ` - ${best.sj}, averaging ${best.avg}%.` : ` across ${completed.length} quiz${completed.length > 1 ? 'zes' : ''}.` })
    }
    if (upcoming.length && upcoming[0].q.openAt - now <= 48 * HOUR) f.push({ tone: 'info', Icon: CalendarClock, lead: 'Opens soon', text: ` - ${upcoming[0].q.title}.` })
    if (!f.length) f.push({ tone: 'good', Icon: CheckCircle2, lead: 'All clear', text: ' - nothing pending right now.' })
    const lead = soon.length ? `${soon.length} quiz${soon.length > 1 ? 'zes' : ''} closing soon - don't miss them.`
      : open.length ? `${open.length} quiz${open.length > 1 ? 'zes' : ''} open now.`
      : completed.length ? `You're averaging ${ring.rate}% across ${completed.length}.`
      : 'No quizzes pending right now.'
    return { findings: f.slice(0, 4), lead }
  }, [decorated, ring, now])

  const visible = useMemo(() => (
    filter === 'all' ? decorated : decorated.filter(d => d.group === filter)
  ), [decorated, filter])

  // Entering OS fullscreen must happen inside the click gesture.
  function startQuiz(q) { enterFullscreen(); setTakingQuiz(q) }
  function handleSubmitted() { /* list refreshes via Firestore listener */ }

  // Wait for the first Firestore snapshot before deciding the list is empty -
  // otherwise students briefly see "No quizzes assigned yet" during load.
  if (!fbReady) return <SkeletonRows />

  if (!myQuizzes.length) {
    return (
      <EmptyState
        Icon={FileText}
        title="No quizzes assigned yet."
        text="Your professor will share quizzes here."
      />
    )
  }

  const PILLS = [
    { key: 'all',       label: 'All' },
    { key: 'open',      label: 'Open' },
    { key: 'upcoming',  label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
    { key: 'missed',    label: 'Missed' },
  ]

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">My quizzes</div>
        <span className="text-xs text-ink2">{counts.open} open now</span>
      </div>

      {/* Performance ring + Quiz Watch */}
      <div className="sact-top">
        <div className="sact-card sact-ring-card">
          <StandingRing rate={ring.rate} color={ring.color} label="avg score" valueSize={19} labelSize={8.5} valueY={39} labelY={54} />
          <div className="sact-ring-meta">
            <strong>{ring.taken} quiz{ring.taken !== 1 ? 'zes' : ''} taken</strong><br />
            {counts.open} open · {counts.upcoming} upcoming<br />
            {counts.missed ? `${counts.missed} missed` : 'none missed'}
          </div>
        </div>

        <div className="sact-card sact-watch">
          <div className="sact-watch-h">
            <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Quiz Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          <div className="sact-watch-lead">{watch.lead}</div>
          {watch.findings.map((fd, i) => (
            <div key={i} className={`sact-find sact-find-${fd.tone}`}>
              <fd.Icon size={16} />
              <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="sact-pills">
        {PILLS.map(p => (
          <button key={p.key} className={`sact-pill ${filter === p.key ? 'on' : ''}`} onClick={() => setFilter(p.key)}>
            {p.label} {counts[p.key]}
          </button>
        ))}
      </div>

      {!visible.length ? (
        <EmptyState
          Icon={FileText}
          title={`No quizzes under “${PILLS.find(p => p.key === filter)?.label}”.`}
          tone="muted"
        />
      ) : (
      <div className="sact-grid">
        {visible.map(({ q, sub, group, scorePct, scoreText }) => {
          const openLabel  = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          const passed = scorePct != null && scorePct >= 75
          let badge
          if (group === 'completed') badge = <span className="badge" style={{ background: passed ? 'var(--green-l)' : 'var(--red-l)', color: passed ? 'var(--green)' : 'var(--red)' }}>{scoreText} · {scorePct}%</span>
          else if (group === 'open') badge = <span className="badge badge-green">Open</span>
          else if (group === 'upcoming') badge = <span className="badge" style={{ background: 'var(--accent-l)', color: 'var(--accent)' }}>Upcoming</span>
          else badge = <span className="badge badge-red">Missed</span>

          return (
            <div key={q.id} className="sact-card" style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{q.title}</span>
                {badge}
              </div>
              <div style={{ display: 'flex', gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
                <span className="badge" style={{ background: subjectColor(q.subject).soft, color: subjectColor(q.subject).color }}>{q.subject}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink3)' }}>
                  {q.questions?.length || 0} Q · {q.timeLimit} min
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginBottom: 10 }}>
                {group === 'upcoming'
                  ? `Opens ${openLabel}`
                  : group === 'completed'
                    ? (sub?.submittedAt ? `Taken ${new Date(sub.submittedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}` : 'Completed')
                    : `Closes ${closeLabel}`}
              </div>
              <div style={{ marginTop: 'auto' }}>
                {group === 'open' && (
                  <button className="btn btn-primary btn-sm" onClick={() => startQuiz(q)}>Take quiz →</button>
                )}
                {group === 'completed' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setReviewQuiz(q)}>Review answers</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      )}

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
