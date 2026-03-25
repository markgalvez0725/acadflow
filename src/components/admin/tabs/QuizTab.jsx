import React, { useState, useMemo } from 'react'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY

function quizId() {
  return 'quiz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// ── AI Question Generator ────────────────────────────────────────────────────
async function generateQuestions(topic, count, types) {
  const typeList = types.join(', ')
  const prompt = `You are a teacher creating a quiz. Generate exactly ${count} quiz questions about the following topic or discussion:

"${topic}"

Question types to include (mix them): ${typeList}

Rules:
- multiple_choice: provide exactly 4 options (a, b, c, d), mark the correct answer
- true_false: answer is either "True" or "False"
- short_answer: provide a model answer (1-3 sentences)
- fill_in_the_blank: use "___" for the blank, provide the correct answer
- identification: ask to identify a term/concept, provide the correct answer

Respond ONLY with a valid JSON array. No markdown, no explanation. Example format:
[
  {
    "type": "multiple_choice",
    "question": "What is...?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": "Option A"
  },
  {
    "type": "true_false",
    "question": "Statement here.",
    "answer": "True"
  },
  {
    "type": "short_answer",
    "question": "Explain...",
    "answer": "Model answer here."
  },
  {
    "type": "fill_in_the_blank",
    "question": "The ___ is responsible for...",
    "answer": "correct word"
  },
  {
    "type": "identification",
    "question": "What term refers to...?",
    "answer": "Term Name"
  }
]`

  const body = JSON.stringify({
    model: 'llama3-8b-8192',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  })

  let res
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 5000))
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body,
    })
    if (res.status !== 429) break
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      res.status === 429
        ? 'Rate limit reached. Please wait a moment and try again.'
        : err?.error?.message || `API error ${res.status}`
    )
  }

  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No valid JSON array in OpenAI response')
  return JSON.parse(jsonMatch[0])
}

// ── Create/Edit Quiz Modal ───────────────────────────────────────────────────
function QuizFormModal({ quiz, onClose }) {
  const { classes, db, fbReady } = useData()
  const { toast } = useUI()
  const isEdit = !!quiz

  const [step, setStep] = useState(isEdit ? 'form' : 'generate')
  const [topic, setTopic] = useState('')
  const [qCount, setQCount] = useState(10)
  const [qTypes, setQTypes] = useState(['multiple_choice', 'true_false', 'short_answer', 'fill_in_the_blank', 'identification'])
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState('')

  const [title, setTitle] = useState(quiz?.title || '')
  const [classIds, setClassIds] = useState(quiz?.classIds || [])
  const [subject, setSubject] = useState(quiz?.subject || '')
  const [timeLimit, setTimeLimit] = useState(quiz?.timeLimit || 30)
  const [openAt, setOpenAt] = useState(() => {
    if (quiz?.openAt) {
      const d = new Date(quiz.openAt)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  })
  const [closeAt, setCloseAt] = useState(() => {
    if (quiz?.closeAt) {
      const d = new Date(quiz.closeAt)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const dl = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())}T${pad(dl.getHours())}:${pad(dl.getMinutes())}`
  })
  const [questions, setQuestions] = useState(quiz?.questions || [])
  const [editingQ, setEditingQ] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  // Available subjects across selected classes
  const availableSubjects = useMemo(() => {
    const subs = new Set()
    classIds.forEach(cid => {
      const cls = classes.find(c => c.id === cid)
      if (cls?.subjects) cls.subjects.forEach(s => subs.add(s))
    })
    return [...subs]
  }, [classIds, classes])

  function toggleClass(id) {
    setClassIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setSubject('')
  }

  function toggleType(t) {
    setQTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function handleGenerate() {
    setGenErr('')
    if (!topic.trim()) { setGenErr('Please enter a topic or discussion text.'); return }
    if (qTypes.length === 0) { setGenErr('Select at least one question type.'); return }
    setGenerating(true)
    try {
      const qs = await generateQuestions(topic.trim(), qCount, qTypes)
      setQuestions(qs.map((q, i) => ({ ...q, id: 'q' + i + '_' + Date.now() })))
      setTitle(topic.trim().slice(0, 60))
      setStep('form')
    } catch (e) {
      setGenErr('Generation failed: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  function updateQuestion(id, field, val) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: val } : q))
  }

  function updateOption(qId, idx, val) {
    setQuestions(prev => prev.map(q => {
      if (q.id !== qId) return q
      const opts = [...(q.options || [])]
      opts[idx] = val
      return { ...q, options: opts }
    }))
  }

  function removeQuestion(id) {
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  function addQuestion() {
    setQuestions(prev => [...prev, {
      id: 'q_' + Date.now(),
      type: 'multiple_choice',
      question: '',
      options: ['', '', '', ''],
      answer: '',
    }])
  }

  async function handleSave() {
    setErr('')
    if (!title.trim()) { setErr('Quiz title is required.'); return }
    if (!classIds.length) { setErr('Select at least one class.'); return }
    if (!subject) { setErr('Select a subject.'); return }
    if (!questions.length) { setErr('Quiz must have at least one question.'); return }
    if (timeLimit < 1) { setErr('Time limit must be at least 1 minute.'); return }
    const openTs = new Date(openAt).getTime()
    const closeTs = new Date(closeAt).getTime()
    if (isNaN(openTs) || isNaN(closeTs)) { setErr('Invalid date range.'); return }
    if (closeTs <= openTs) { setErr('Close time must be after open time.'); return }
    if (!fbReady || !db.current) { setErr('Firebase is required.'); return }

    const payload = {
      title: title.trim(),
      classIds,
      subject,
      timeLimit: parseInt(timeLimit),
      openAt: openTs,
      closeAt: closeTs,
      questions,
      totalPoints: questions.length,
      submissions: quiz?.submissions || {},
      createdAt: quiz?.createdAt || Date.now(),
      createdBy: 'admin',
    }

    setSaving(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db.current, 'quizzes', quiz.id), { ...payload })
      } else {
        const id = quizId()
        await setDoc(doc(db.current, 'quizzes', id), { id, ...payload })
      }
      toast(isEdit ? 'Quiz updated!' : 'Quiz created and shared!', 'green')
      onClose()
    } catch (e) {
      setErr('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const TYPE_LABELS = {
    multiple_choice: 'Multiple Choice',
    true_false: 'True/False',
    short_answer: 'Short Answer',
    fill_in_the_blank: 'Fill in the Blank',
    identification: 'Identification',
  }

  // ── Step 1: Generate ──────────────────────────────────────────────────────
  if (step === 'generate') {
    return (
      <Modal onClose={onClose} size="md">
        <h3 className="text-lg font-bold text-ink mb-1">✨ Generate Quiz with AI</h3>
        <p className="modal-sub">Paste your topic or discussion text and let Gemini AI generate your quiz.</p>

        <div className="field mb-3">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Topic / Discussion Text <span className="text-red-500">*</span></label>
          <textarea
            className="input w-full"
            rows={5}
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="e.g. The human digestive system breaks down food through mechanical and chemical digestion…"
            autoFocus
          />
        </div>

        <div className="input-row mb-3">
          <div className="field flex-1">
            <label className="text-xs font-semibold text-ink2 mb-1 block">Number of Questions</label>
            <input
              className="input w-full"
              type="number"
              min={1}
              max={50}
              value={qCount}
              onChange={e => setQCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div className="field mb-4">
          <label className="text-xs font-semibold text-ink2 mb-2 block">Question Types (select all that apply)</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TYPE_LABELS).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`btn btn-sm ${qTypes.includes(t) ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 12 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {genErr && <div className="err-msg mb-2">{genErr}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? '⏳ Generating…' : '✨ Generate Questions'}
          </button>
        </div>
      </Modal>
    )
  }

  // ── Step 2: Form ──────────────────────────────────────────────────────────
  return (
    <Modal onClose={onClose} size="lg">
      <h3 className="text-lg font-bold text-ink mb-1">
        {isEdit ? '✏️ Edit Quiz' : '📝 Configure & Share Quiz'}
      </h3>
      <p className="modal-sub">{questions.length} questions generated. Review, edit, then share with classes.</p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Quiz Title <span className="text-red-500">*</span></label>
        <input className="input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 3 Quiz" />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Share with Classes <span className="text-red-500">*</span></label>
        {classes.length === 0 ? (
          <p className="text-xs text-ink3">No classes available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {classes.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleClass(c.id)}
                className={`btn btn-sm ${classIds.includes(c.id) ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 12 }}
              >
                {c.name} {c.section}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Subject <span className="text-red-500">*</span></label>
        <select className="input w-full" value={subject} onChange={e => setSubject(e.target.value)}>
          <option value="">— Select Subject —</option>
          {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="input-row mb-3">
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Time Limit (minutes) <span className="text-red-500">*</span></label>
          <input
            className="input w-full"
            type="number"
            min={1}
            max={300}
            value={timeLimit}
            onChange={e => setTimeLimit(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Opens At <span className="text-red-500">*</span></label>
          <input className="input w-full" type="datetime-local" value={openAt} onChange={e => setOpenAt(e.target.value)} />
        </div>
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Closes At <span className="text-red-500">*</span></label>
          <input className="input w-full" type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)} />
        </div>
      </div>

      {/* Questions Editor */}
      <div className="field mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-ink2">{questions.length} Questions</label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add Question</button>
        </div>
        <div className="flex flex-col gap-3" style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {questions.map((q, i) => (
            <div key={q.id} style={{ background: 'var(--c-surface2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>
                  Q{i + 1} · {TYPE_LABELS[q.type] || q.type}
                </span>
                <div className="flex gap-1">
                  <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                    onClick={() => setEditingQ(editingQ === q.id ? null : q.id)}>
                    {editingQ === q.id ? 'Done' : 'Edit'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm text-red-500" style={{ fontSize: 10 }}
                    onClick={() => removeQuestion(q.id)}>✕</button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 4 }}>{q.question || <em style={{ color: 'var(--ink3)' }}>No question text</em>}</p>
              {q.type === 'multiple_choice' && q.options && (
                <div className="flex flex-wrap gap-1">
                  {q.options.map((opt, oi) => (
                    <span key={oi} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: opt === q.answer ? 'var(--green-l)' : 'var(--c-surface)',
                      color: opt === q.answer ? 'var(--c-green)' : 'var(--ink2)',
                      border: '1px solid var(--border)',
                    }}>
                      {String.fromCharCode(65 + oi)}. {opt}
                    </span>
                  ))}
                </div>
              )}
              {q.type !== 'multiple_choice' && (
                <span style={{ fontSize: 11, color: 'var(--c-green)', fontWeight: 600 }}>
                  Answer: {q.answer}
                </span>
              )}

              {/* Inline editor */}
              {editingQ === q.id && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div className="field mb-2">
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Type</label>
                    <select className="input w-full" style={{ fontSize: 12 }} value={q.type}
                      onChange={e => updateQuestion(q.id, 'type', e.target.value)}>
                      {Object.entries(TYPE_LABELS).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field mb-2">
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Question</label>
                    <textarea className="input w-full" rows={2} style={{ fontSize: 12 }} value={q.question}
                      onChange={e => updateQuestion(q.id, 'question', e.target.value)} />
                  </div>
                  {q.type === 'multiple_choice' && (
                    <div className="field mb-2">
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Options (click correct answer)</label>
                      {(q.options || ['', '', '', '']).map((opt, oi) => (
                        <div key={oi} className="flex gap-1 mb-1 items-center">
                          <span style={{ fontSize: 11, width: 16, color: 'var(--ink2)', flexShrink: 0 }}>{String.fromCharCode(65 + oi)}.</span>
                          <input className="input flex-1" style={{ fontSize: 12 }} value={opt}
                            onChange={e => updateOption(q.id, oi, e.target.value)} />
                          <button type="button" onClick={() => updateQuestion(q.id, 'answer', opt)}
                            style={{ fontSize: 10, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)',
                              background: q.answer === opt ? 'var(--green-l)' : 'var(--c-surface)',
                              color: q.answer === opt ? 'var(--c-green)' : 'var(--ink2)', cursor: 'pointer', flexShrink: 0 }}>
                            {q.answer === opt ? '✓ Correct' : 'Set Correct'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {q.type === 'true_false' && (
                    <div className="field mb-2">
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Correct Answer</label>
                      <select className="input w-full" style={{ fontSize: 12 }} value={q.answer}
                        onChange={e => updateQuestion(q.id, 'answer', e.target.value)}>
                        <option value="True">True</option>
                        <option value="False">False</option>
                      </select>
                    </div>
                  )}
                  {['short_answer', 'fill_in_the_blank', 'identification'].includes(q.type) && (
                    <div className="field mb-2">
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Model Answer / Key Answer</label>
                      <input className="input w-full" style={{ fontSize: 12 }} value={q.answer}
                        onChange={e => updateQuestion(q.id, 'answer', e.target.value)} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {err && <div className="err-msg mb-2">{err}</div>}

      <div className="modal-footer">
        {!isEdit && (
          <button className="btn btn-ghost" onClick={() => setStep('generate')}>← Regenerate</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? '💾 Save Changes' : '🚀 Share Quiz'}
        </button>
      </div>
    </Modal>
  )
}

// ── View Results Modal ───────────────────────────────────────────────────────
function ViewQuizModal({ quiz, onClose, onEdit, onDelete }) {
  const { students } = useData()
  const { toast, openDialog } = useUI()
  const { db } = useData()

  const now = Date.now()
  const isOpen = now >= quiz.openAt && now <= quiz.closeAt
  const isClosed = now > quiz.closeAt
  const isUpcoming = now < quiz.openAt

  const enrolledStudents = useMemo(() => {
    return students.filter(s => {
      const sClassIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
      return quiz.classIds?.some(id => sClassIds.includes(id)) && s.account?.registered
    })
  }, [students, quiz.classIds])

  const submissions = quiz.submissions || {}
  const attempted = Object.keys(submissions).length
  const graded = Object.values(submissions).filter(s => s.score != null).length

  const openLabel   = new Date(quiz.openAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  const closeLabel  = new Date(quiz.closeAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

  async function handleDelete() {
    const ok = await openDialog({
      title: `Delete "${quiz.title}"?`,
      msg: 'This quiz and all submissions will be permanently removed.',
      type: 'danger', confirmLabel: 'Delete Quiz', showCancel: true,
    })
    if (!ok) return
    try {
      await deleteDoc(doc(db.current, 'quizzes', quiz.id))
      onDelete()
    } catch (e) {
      toast('Delete failed: ' + e.message, 'red')
    }
  }

  return (
    <Modal onClose={onClose} size="lg">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-lg font-bold text-ink">📝 {quiz.title}</h3>
          <p className="text-xs text-ink2 mt-0.5">
            {quiz.subject} · {quiz.questions?.length || 0} questions · {quiz.timeLimit} min time limit
          </p>
          <p className="text-xs text-ink2">
            Opens: {openLabel} · Closes: {closeLabel}
          </p>
        </div>
        <button className="text-ink3 hover:text-ink text-xl leading-none" onClick={onClose}>×</button>
      </div>

      {/* Status banner */}
      {isUpcoming && (
        <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12, color: 'var(--ink2)' }}>
          🕐 Upcoming — opens {openLabel}
        </div>
      )}
      {isOpen && (
        <div style={{ background: 'var(--green-l)', color: 'var(--c-green)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          🟢 Open — closes {closeLabel}
        </div>
      )}
      {isClosed && (
        <div style={{ background: 'var(--red-l)', color: 'var(--c-red)', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          🔒 Closed — {attempted}/{enrolledStudents.length} attempted · {graded} auto-graded
        </div>
      )}

      {/* Submissions table */}
      <div className="tbl-wrap mb-3">
        <table className="tbl">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Score</th>
              <th>Percentage</th>
              <th>Time Taken</th>
            </tr>
          </thead>
          <tbody>
            {enrolledStudents.map(s => {
              const sub = submissions[s.id]
              const hasAttempt = !!sub
              const score = sub?.score
              const total = quiz.questions?.length || 1
              const pct = score != null ? ((score / total) * 100).toFixed(1) : null
              const timeTaken = sub?.timeTaken ? Math.round(sub.timeTaken / 60) + ' min' : '—'
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <br /><span style={{ fontSize: 11, color: 'var(--ink2)' }}>{s.snum || s.id}</span>
                  </td>
                  <td>
                    {hasAttempt
                      ? <Badge variant="green">✅ Submitted</Badge>
                      : <Badge variant="gray">{isClosed ? '⏰ Missed' : '⏳ Not yet'}</Badge>}
                  </td>
                  <td>
                    {score != null ? `${score}/${total}` : '—'}
                  </td>
                  <td>
                    {pct != null ? (
                      <span style={{ fontWeight: 700, color: pct >= 75 ? 'var(--c-green)' : pct >= 50 ? '#f59e0b' : 'var(--c-red)' }}>
                        {pct}%
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink2)' }}>{timeTaken}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️ Edit</button>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

// ── Main Tab ─────────────────────────────────────────────────────────────────
const PER_PAGE = 10

export default function QuizTab() {
  const { quizzes, classes } = useData()
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [viewQuiz, setViewQuiz] = useState(null)
  const [editQuiz, setEditQuiz] = useState(null)

  const sorted = useMemo(
    () => [...quizzes].sort((a, b) => b.createdAt - a.createdAt),
    [quizzes]
  )

  const slice = useMemo(
    () => sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [sorted, page]
  )

  const now = Date.now()

  function statusInfo(q) {
    if (now < q.openAt) return { label: 'Upcoming', variant: 'blue' }
    if (now > q.closeAt) return { label: 'Closed', variant: 'red' }
    return { label: 'Open', variant: 'green' }
  }

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">Quizzes</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>✨ New Quiz</button>
      </div>

      {!quizzes.length ? (
        <div className="empty">
          <div className="empty-icon" style={{ fontSize: '2rem' }}>📝</div>
          No quizzes yet. Click "New Quiz" to generate one with AI.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-3">
            {slice.map(q => {
              const { label, variant } = statusInfo(q)
              const clsNames = (q.classIds || []).map(id => {
                const c = classes.find(x => x.id === id)
                return c ? `${c.name} ${c.section}` : id
              }).join(', ')
              const attempted = Object.keys(q.submissions || {}).length
              const openLabel = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
              const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

              return (
                <div key={q.id} className="card card-pad">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <strong style={{ fontSize: 14 }}>{q.title}</strong>
                        <Badge variant={variant}>{label}</Badge>
                        <Badge variant="blue">{q.subject}</Badge>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
                        {clsNames} · {q.questions?.length || 0} questions · {q.timeLimit} min
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
                        Open: {openLabel} → Close: {closeLabel} · {attempted} submitted
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewQuiz(q)}>View</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditQuiz(q)}>Edit</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination total={sorted.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}

      {showCreate && <QuizFormModal onClose={() => setShowCreate(false)} />}
      {editQuiz && (
        <QuizFormModal
          quiz={quizzes.find(q => q.id === editQuiz.id) || editQuiz}
          onClose={() => setEditQuiz(null)}
        />
      )}
      {viewQuiz && (
        <ViewQuizModal
          quiz={quizzes.find(q => q.id === viewQuiz.id) || viewQuiz}
          onClose={() => setViewQuiz(null)}
          onEdit={() => { setEditQuiz(viewQuiz); setViewQuiz(null) }}
          onDelete={() => setViewQuiz(null)}
        />
      )}
    </div>
  )
}
