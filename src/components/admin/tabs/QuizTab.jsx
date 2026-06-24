import React, { useState, useMemo } from 'react'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import { Clock, AlertCircle, Upload, Download, Check, CheckCircle, ClipboardList, Pencil, Save, Rocket, FileText, X, Lock, Circle, Archive, ArchiveRestore, Sparkles, Wand2, FileUp } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { extractTextFromFile } from '@/utils/lessonExtract'
import { generateDraftQuestions } from '@/utils/quizGen'
import { quizItemAnalysis } from '@/utils/quizStats'
import { classTag } from '@/utils/groupChat'
import { aiRequest } from '@/utils/aiGateway'


function quizId() {
  return 'quiz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

const TYPE_LABELS = {
  multiple_choice: 'Multiple Choice',
  true_false: 'True/False',
  short_answer: 'Short Answer',
  fill_in_the_blank: 'Fill in the Blank',
  identification: 'Identification',
}

function buildTemplate(topic, count, types, generalPrompt, lesson) {
  const extraContext = generalPrompt?.trim()
    ? `\nAdditional instructions from the teacher: ${generalPrompt.trim()}\n`
    : ''

  const allRules = {
    multiple_choice: '- multiple_choice: provide exactly 4 options, mark the correct answer',
    true_false: '- true_false: answer is either "True" or "False"',
    short_answer: '- short_answer: provide a model answer (1-3 sentences)',
    fill_in_the_blank: '- fill_in_the_blank: use "___" for the blank, provide the correct answer',
    identification: '- identification: ask to identify a term/concept, provide the correct answer',
  }
  const allExamples = {
    multiple_choice: '  {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"answer":"A","explanation":"why A is correct"}',
    true_false: '  {"type":"true_false","question":"...","answer":"True","explanation":"why"}',
    short_answer: '  {"type":"short_answer","question":"...","answer":"...","explanation":"why"}',
    fill_in_the_blank: '  {"type":"fill_in_the_blank","question":"The ___ is ...","answer":"word","explanation":"why"}',
    identification: '  {"type":"identification","question":"What term refers to...?","answer":"Term","explanation":"why"}',
  }
  const typeLabel = types.length === 1 ? `ONLY ${types[0]}` : `these types only (${types.join(', ')})`
  const rules = types.map(t => allRules[t]).join('\n')
  const examples = types.map(t => allExamples[t]).join(',\n')

  const hasLesson = !!(lesson && lesson.trim())
  const source = hasLesson
    ? `Base every question STRICTLY on the lesson material in the "lesson" field below; do not invent facts or use outside knowledge.${topic?.trim() ? ` Focus on: ${topic.trim()}.` : ''}`
    : `Generate questions about this topic: ${topic?.trim() || '(none provided)'}.`

  const instructions = `INSTRUCTIONS FOR AI:
Generate exactly ${count} quiz questions.
${source}
Use ${typeLabel}. Do NOT generate any other question type.
${extraContext}
Rules:
${rules}
- Every question MUST include an "explanation" field: 1–2 sentences stating why the answer is correct (shown to students when they review their results).

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no commentary.
Use this exact format:
[
${examples}
]`

  return {
    _instructions: instructions,
    ...(topic?.trim() && { topic: topic.trim() }),
    ...(hasLesson && { lesson: lesson.slice(0, 18000) }),
    question_count: count,
    question_types: types,
    ...(generalPrompt?.trim() && { general_prompt: generalPrompt.trim() }),
    expected_output_format: 'JSON array',
  }
}

const AI_PROMPT_TEXT = `I have a quiz template JSON file. Please read the _instructions field inside it carefully and generate the quiz questions exactly as described.

Each question object must include an "explanation" field (1–2 sentences on why the answer is correct).
Respond ONLY with a valid JSON array — no markdown, no commentary, no code block. Just the raw JSON array starting with [ and ending with ].`

// ── Export Template Modal ─────────────────────────────────────────────────────
function ExportTemplateModal({ onClose, onSwitchToImport }) {
  const { toast } = useUI()
  const [topic, setTopic] = useState('')
  const [qCount, setQCount] = useState(10)
  const [qTypes, setQTypes] = useState(['multiple_choice'])
  const [generalPrompt, setGeneralPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [fileName, setFileName] = useState('')
  const [lessonText, setLessonText] = useState('')
  const [extracting, setExtracting] = useState(false)

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name); setExtracting(true); setLessonText('')
    try {
      const t = await extractTextFromFile(file)
      if (!t || t.trim().length < 80) toast('Could not read enough text from that file. Try a text-based PDF/Word/PowerPoint.', 'warn', 6000)
      setLessonText(t || '')
    } catch (e) {
      toast(e.message || 'Could not read that file.', 'error', 6000); setFileName('')
    } finally { setExtracting(false) }
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(AI_PROMPT_TEXT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function toggleType(t) {
    setQTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  function handleExport() {
    if ((!topic.trim() && !lessonText.trim()) || !qTypes.length) return
    const template = buildTemplate(topic.trim(), qCount, qTypes, generalPrompt, lessonText)
    const json = JSON.stringify(template, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const base = (topic.trim() || fileName.replace(/\.[^.]+$/, '') || 'lesson').slice(0, 30).replace(/\s+/g, '-')
    a.download = `quiz-template-${base}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Template exported! Send it to your AI platform.', 'green')
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1"><Upload size={18} className="inline-block mr-1 align-text-bottom" />Export Quiz Template</h3>
      <p className="modal-sub">
        Upload a lesson file (or type a topic), export the template JSON, send it to any AI chat (Perplexity, ChatGPT, Claude…), then import the AI's response back here.
      </p>

      {/* Lesson file — questions are drawn from its content (read on your device) */}
      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Lesson file <span className="font-normal text-ink3">(questions are drawn from it)</span></label>
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          <FileUp size={14} className="inline-block mr-1" />{fileName ? 'Change file' : 'Choose file (PDF / Word / PowerPoint)'}
          <input type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </label>
        {extracting && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>Reading {fileName}…</div>}
        {!extracting && fileName && lessonText && (
          <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>
            <Check size={12} className="inline-block mr-1" />{fileName} · {lessonText.trim().split(/\s+/).length.toLocaleString()} words read
          </div>
        )}
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Topic / focus <span className="font-normal text-ink3">{lessonText.trim() ? '(optional — narrows the lesson)' : '(required if no file)'}</span></label>
        <textarea
          className="input w-full"
          rows={3}
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder={lessonText.trim()
            ? 'Optional — e.g. focus on Chapter 3, or skip to cover the whole file'
            : 'e.g. The human digestive system breaks down food through mechanical and chemical digestion…'}
        />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Number of Questions</label>
        <input
          className="input w-full" type="number" min={1} max={50} value={qCount}
          onChange={e => setQCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
        />
      </div>

      <div className="field mb-4">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Question Types</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TYPE_LABELS).map(([t, label]) => (
            <button key={t} type="button" onClick={() => toggleType(t)}
              className={`btn btn-sm ${qTypes.includes(t) ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field mb-4">
        <label className="text-xs font-semibold text-ink2 mb-1 block">
          Additional Prompt for AI <span className="font-normal text-ink3">(optional)</span>
        </label>
        <textarea
          className="input w-full"
          rows={3}
          value={generalPrompt}
          onChange={e => setGeneralPrompt(e.target.value)}
          placeholder="e.g. Focus on higher-order thinking questions. Avoid trivial facts. Use simple language suitable for Grade 8."
        />
      </div>

      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--ink2)' }}>
        <strong style={{ color: 'var(--ink)' }}>How it works:</strong>
        <ol style={{ margin: '6px 0 0 16px', lineHeight: 1.8 }}>
          <li>Click <strong>Export Template</strong> to download a <code>.json</code> file</li>
          <li>Go to ChatGPT, Gemini, Claude, or any AI platform</li>
          <li>Copy the prompt below, paste it, then attach or paste the <code>.json</code> file contents</li>
          <li>Copy the AI's JSON output, then click <strong>Import AI Response</strong></li>
        </ol>
      </div>

      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prompt to paste into AI</span>
          <button
            type="button"
            onClick={handleCopyPrompt}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: copied ? 'var(--accent)' : 'var(--surface)', color: copied ? '#fff' : 'var(--ink)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}
          >
            {copied ? <><Check size={11} className="inline-block mr-1" />Copied!</> : <><ClipboardList size={11} className="inline-block mr-1" />Copy</>}
          </button>
        </div>
        <pre style={{ margin: 0, padding: '10px 14px', fontSize: 12, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, userSelect: 'all' }}>
          {AI_PROMPT_TEXT}
        </pre>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-ghost" onClick={onSwitchToImport}>
          <Download size={13} className="inline-block mr-1" />Import AI Response
        </button>
        <button className="btn btn-primary" onClick={handleExport} disabled={(!topic.trim() && !lessonText.trim()) || !qTypes.length || extracting}>
          <Upload size={13} className="inline-block mr-1" />Export Template
        </button>
      </div>
    </Modal>
  )
}

// ── Import AI Response Modal ──────────────────────────────────────────────────
function ImportResponseModal({ onClose, onImported }) {
  const [jsonInput, setJsonInput] = useState('')
  const [jsonErr, setJsonErr] = useState('')

  function handleImport() {
    setJsonErr('')
    let parsed
    try {
      parsed = JSON.parse(jsonInput.trim())
    } catch (e) {
      setJsonErr('Invalid JSON: ' + e.message)
      return
    }
    if (!Array.isArray(parsed)) { setJsonErr('Expected a JSON array of questions, e.g. [{ "type": "multiple_choice", ... }]'); return }
    if (!parsed.length) { setJsonErr('The array is empty — paste at least one question.'); return }
    const qs = parsed.map((q, i) => ({ ...q, id: 'q' + i + '_' + Date.now() }))
    onImported(qs)
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1"><Download size={18} className="inline-block mr-1 align-text-bottom" />Import AI Response</h3>
      <p className="modal-sub">
        Paste the JSON array returned by your AI platform. The quiz will be auto-configured and ready to save.
      </p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Paste AI JSON Output <span className="text-red-500">*</span></label>
        <textarea
          className="input w-full"
          rows={12}
          value={jsonInput}
          onChange={e => setJsonInput(e.target.value)}
          placeholder={'[\n  {"type":"multiple_choice","question":"...","options":[...],"answer":"..."},\n  ...\n]'}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          autoFocus
        />
      </div>

      {jsonErr && <div className="err-msg mb-2">{jsonErr}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleImport} disabled={!jsonInput.trim()}>
          Import & Configure Quiz →
        </button>
      </div>
    </Modal>
  )
}

// ── Create/Edit Quiz Modal ────────────────────────────────────────────────────
function QuizFormModal({ quiz, initialQuestions, onClose }) {
  const { classes, db, fbReady } = useData()
  const { toast } = useUI()
  const isEdit = !!quiz

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
  const [questions, setQuestions] = useState(quiz?.questions || initialQuestions || [])
  const [partialCredit, setPartialCredit] = useState(quiz?.partialCredit || false)
  const [editingQ, setEditingQ] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

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
    setQuestions(prev => [...prev, { id: 'q_' + Date.now(), type: 'multiple_choice', question: '', options: ['', '', '', ''], answer: '', points: 1 }])
  }

  const TEXT_TYPES = ['short_answer', 'fill_in_the_blank', 'identification']

  // Bulk auto-key: seed accepted alternate answers for every text question from
  // its model answer, splitting on common separators (",", "/", "|", ";", "or").
  function bulkAutoKey() {
    let touched = 0
    setQuestions(prev => prev.map(q => {
      if (!TEXT_TYPES.includes(q.type)) return q
      if (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length) return q
      const alts = String(q.answer || '').split(/\s*(?:[,/|;]|\bor\b)\s*/i).map(s => s.trim()).filter(Boolean)
      if (!alts.length) return q
      touched++
      return { ...q, acceptedAnswers: alts }
    }))
    toast(touched ? `Seeded accepted answers for ${touched} question${touched === 1 ? '' : 's'}.` : 'No text questions to auto-key.', touched ? 'green' : 'dark')
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

    const totalPoints = questions.reduce((sum, q) => sum + ((typeof q.points === 'number' && q.points > 0) ? q.points : 1), 0)
    const payload = {
      title: title.trim(), classIds, subject,
      timeLimit: parseInt(timeLimit), openAt: openTs, closeAt: closeTs,
      questions, totalPoints, partialCredit,
      submissions: quiz?.submissions || {},
      createdAt: quiz?.createdAt || Date.now(), createdBy: 'admin',
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

  return (
    <Modal onClose={onClose} size="lg">
      <h3 className="text-lg font-bold text-ink mb-1">
        {isEdit ? <><Pencil size={16} className="inline-block mr-1 align-text-bottom" />Edit Quiz</> : <><FileText size={16} className="inline-block mr-1 align-text-bottom" />Configure &amp; Share Quiz</>}
      </h3>
      <p className="modal-sub">{isEdit ? `${questions.length} questions` : `${questions.length} questions imported`}. Review, edit, then share with classes.</p>

      {err && <div ref={el => el?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="err-msg mb-3">{err}</div>}

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Quiz Title <span className="text-red-500">*</span></label>
        <input className="input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 3 Quiz" />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Share with Classes <span className="text-red-500">*</span></label>
        {classes.length === 0 ? (
          <p className="text-xs text-ink3">No classes available.</p>
        ) : (
          <>
          <div className="flex flex-wrap gap-2">
            {classes.filter(c => !c.archived).map(c => {
              const subs = (c.subjects || []).join(' · ')
              return (
                <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                  title={`${c.name} ${c.section}${subs ? ' — ' + subs : ''}`}
                  className={`btn btn-sm ${classIds.includes(c.id) ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, height: 'auto', padding: '6px 11px', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3, gap: 1 }}>
                  <span style={{ fontWeight: 700 }}>{classTag(c) || `${c.name} ${c.section}`}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85 }}>{subs || 'No subjects'}</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-ink3 mt-2">Each chip is a class section and the subject(s) it offers — pick the one that matches the subject below.</p>
          </>
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
          <input className="input w-full" type="number" min={1} max={300} value={timeLimit}
            onChange={e => setTimeLimit(Math.max(1, parseInt(e.target.value) || 1))} />
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

      {/* Auto-grading options */}
      <div className="field mb-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={partialCredit} onChange={e => setPartialCredit(e.target.checked)} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Allow partial credit on text answers</span>
        </label>
        <p className="text-xs text-ink3 mt-1" style={{ marginLeft: 24 }}>Near-miss short/identification/fill-in answers earn half the question's points. Multiple-choice and true/false are always all-or-nothing.</p>
      </div>

      {/* Questions Editor */}
      <div className="field mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-ink2">{questions.length} Questions · {questions.reduce((s, q) => s + ((typeof q.points === 'number' && q.points > 0) ? q.points : 1), 0)} pts</label>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={bulkAutoKey} title="Seed accepted alternate answers from each model answer"><Wand2 size={12} className="inline-block mr-1" />Auto-key</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add Question</button>
          </div>
        </div>
        <div className="flex flex-col gap-3" style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {questions.map((q, i) => (
            <div key={q.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
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
                    onClick={() => removeQuestion(q.id)}><X size={11} /></button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 4 }}>{q.question || <em style={{ color: 'var(--ink3)' }}>No question text</em>}</p>
              {q.type === 'multiple_choice' && q.options && (
                <div className="flex flex-wrap gap-1">
                  {q.options.map((opt, oi) => (
                    <span key={oi} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: opt === q.answer ? 'var(--green-l)' : 'var(--surface)',
                      color: opt === q.answer ? 'var(--green)' : 'var(--ink2)',
                      border: '1px solid var(--border)',
                    }}>
                      {String.fromCharCode(65 + oi)}. {opt}
                    </span>
                  ))}
                </div>
              )}
              {q.type !== 'multiple_choice' && (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                  Answer: {q.answer}
                </span>
              )}
              {editingQ === q.id && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div className="flex gap-2 mb-2">
                    <div className="field" style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Type</label>
                      <select className="input w-full" style={{ fontSize: 12 }} value={q.type}
                        onChange={e => updateQuestion(q.id, 'type', e.target.value)}>
                        {Object.entries(TYPE_LABELS).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ width: 80 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Points</label>
                      <input className="input w-full" style={{ fontSize: 12 }} type="number" min="1" value={q.points ?? 1}
                        onChange={e => updateQuestion(q.id, 'points', Math.max(1, parseInt(e.target.value) || 1))} />
                    </div>
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
                              background: q.answer === opt ? 'var(--green-l)' : 'var(--surface)',
                              color: q.answer === opt ? 'var(--green)' : 'var(--ink2)', cursor: 'pointer', flexShrink: 0 }}>
                            {q.answer === opt ? <><Check size={10} className="inline-block mr-0.5" />Correct</> : 'Set Correct'}
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
                    <>
                      <div className="field mb-2">
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Model Answer / Key Answer</label>
                        <input className="input w-full" style={{ fontSize: 12 }} value={q.answer}
                          onChange={e => updateQuestion(q.id, 'answer', e.target.value)} />
                      </div>
                      <div className="field mb-2">
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Accepted alternate answers <span className="text-ink3">(comma-separated — any one counts as correct)</span></label>
                        <input className="input w-full" style={{ fontSize: 12 }} placeholder="e.g. H2O, water, dihydrogen monoxide"
                          value={(q.acceptedAnswers || []).join(', ')}
                          onChange={e => updateQuestion(q.id, 'acceptedAnswers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? <><Save size={13} className="inline-block mr-1" />Save Changes</> : <><Rocket size={13} className="inline-block mr-1" />Share Quiz</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Item analysis: per-question performance across all submissions ─────────────
function QuizItemAnalysis({ quiz }) {
  const { responseCount, items } = useMemo(() => quizItemAnalysis(quiz), [quiz])

  if (!responseCount) {
    return <div style={{ fontSize: 12, color: 'var(--ink2)', padding: '8px 0' }}>No submissions yet — analysis appears once students have taken the quiz.</div>
  }

  const avgPct = Math.round(items.reduce((t, it) => t + it.correctPct, 0) / (items.length || 1))
  const hardest = [...items].sort((a, b) => a.correctPct - b.correctPct)[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
        Based on <strong>{responseCount}</strong> submission{responseCount === 1 ? '' : 's'} · class average <strong>{avgPct}%</strong> correct
        {hardest && hardest.correctPct < 60 && <> · hardest: <strong>Q{hardest.index + 1}</strong> ({hardest.correctPct}%)</>}
      </div>
      {items.map(it => {
        const col = it.correctPct >= 75 ? 'var(--green)' : it.correctPct >= 50 ? 'var(--yellow)' : 'var(--red)'
        return (
          <div key={it.index} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink2)', flexShrink: 0 }}>Q{it.index + 1}</span>
              <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{it.question}</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: col, flexShrink: 0 }}>{it.correctPct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${it.correctPct}%`, height: '100%', background: col }} />
            </div>
            {it.options && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {it.options.map((o, oi) => (
                  <span key={oi} style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 6,
                    background: o.isCorrect ? 'var(--green-l)' : 'var(--surface2)',
                    color: o.isCorrect ? 'var(--green)' : 'var(--ink2)',
                    fontWeight: o.isCorrect ? 700 : 500,
                  }}>
                    {o.text || '—'} · {o.count}
                  </span>
                ))}
              </div>
            )}
            {!it.options && it.topWrong && (
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                Most common wrong answer: <strong style={{ color: 'var(--ink2)' }}>{it.topWrong.text}</strong> ({it.topWrong.count})
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── View Results Modal ────────────────────────────────────────────────────────
function ViewQuizModal({ quiz, onClose, onEdit, onDelete }) {
  const [showAnalysis, setShowAnalysis] = useState(false)
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
      <div className="mb-2 pr-8">
        <h3 className="text-lg font-bold text-ink"><FileText size={18} className="inline-block mr-1 align-text-bottom" />{quiz.title}</h3>
        <p className="text-xs text-ink2 mt-0.5">
          {quiz.subject} · {quiz.questions?.length || 0} questions · {quiz.timeLimit} min time limit
        </p>
        <p className="text-xs text-ink2">
          Opens: {openLabel} · Closes: {closeLabel}
        </p>
      </div>

      {isUpcoming && (
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12, color: 'var(--ink2)' }}>
          <Clock size={13} className="inline-block mr-1 align-text-bottom" />Upcoming — opens {openLabel}
        </div>
      )}
      {isOpen && (
        <div style={{ background: 'var(--green-l)', color: 'var(--green)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <Circle size={13} className="inline-block mr-1 align-text-bottom" style={{ fill: 'var(--green)', color: 'var(--green)' }} />Open — closes {closeLabel}
        </div>
      )}
      {isClosed && (
        <div style={{ background: 'var(--red-l)', color: 'var(--red)', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <Lock size={13} className="inline-block mr-1 align-text-bottom" />Closed — {attempted}/{enrolledStudents.length} attempted · {graded} auto-graded
        </div>
      )}

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
                      ? <Badge variant="green"><CheckCircle size={11} className="inline-block mr-1 align-text-bottom" />Submitted</Badge>
                      : <Badge variant="gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{isClosed ? <><AlertCircle size={11} />Missed</> : <><Clock size={11} />Not yet</>}</Badge>}
                  </td>
                  <td>{score != null ? `${score}/${total}` : '—'}</td>
                  <td>
                    {pct != null ? (
                      <span style={{ fontWeight: 700, color: pct >= 75 ? 'var(--green)' : pct >= 50 ? '#f59e0b' : 'var(--red)' }}>
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

      {/* Item analysis — per-question performance */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowAnalysis(v => !v)}
          style={{ marginBottom: showAnalysis ? 10 : 0 }}
        >
          <ClipboardList size={13} className="inline-block mr-1" />
          {showAnalysis ? 'Hide item analysis' : 'Item analysis'}
        </button>
        {showAnalysis && <QuizItemAnalysis quiz={quiz} />}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={13} className="inline-block mr-1" />Edit</button>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
const PER_PAGE = 10

// ── Generate from Lesson File Modal ───────────────────────────────────────
function GenerateFromLessonModal({ onClose, onGenerated }) {
  const { toast } = useUI()
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [count, setCount] = useState(10)
  const [qTypes, setQTypes] = useState(['multiple_choice', 'true_false', 'fill_in_the_blank', 'identification'])
  const [method, setMethod] = useState('device') // 'device' | 'ai'
  const [busy, setBusy] = useState(false)

  function toggleType(t) {
    setQTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    setExtracting(true)
    setText('')
    try {
      const t = await extractTextFromFile(file)
      if (!t || t.trim().length < 80) {
        toast('Could not read enough text from that file. Try a text-based PDF/Word/PowerPoint.', 'warn', 6000)
      }
      setText(t || '')
    } catch (e) {
      toast(e.message || 'Could not read that file.', 'error', 6000)
      setFileName('')
    } finally {
      setExtracting(false)
    }
  }

  async function handleGenerate() {
    if (!text.trim()) { toast('Upload a lesson file first.', 'warn'); return }
    if (!qTypes.length) { toast('Pick at least one question type.', 'warn'); return }
    setBusy(true)
    try {
      if (method === 'ai') {
        // Routed through the serialized gateway so rapid re-clicks can't fan out
        // multiple Gemini calls against the free-tier quota.
        const { ok, status, data, error } = await aiRequest('/api/generate-quiz-gemini', { text, count, types: qTypes })
        if (ok) {
          const qs = (data?.questions || []).map(q => ({ id: 'q_' + Date.now() + Math.random().toString(36).slice(2, 6), ...q }))
          if (qs.length) { onGenerated(qs); return }
          toast('AI returned no questions. Using on-device drafts instead.', 'warn', 5000)
        } else if (status === 501) {
          toast('AI is not set up yet (no free key). Using on-device drafts instead.', 'info', 6000)
        } else if (error === 'aborted' || status === 0) {
          toast('Could not reach the AI service. Using on-device drafts instead.', 'warn', 5000)
        } else {
          toast('AI: ' + (error || 'request failed') + '. Using on-device drafts instead.', 'warn', 8000)
        }
      }
      // On-device (default, or AI fallback)
      const qs = generateDraftQuestions(text, { count, types: qTypes })
      if (!qs.length) { toast('Could not draft questions from this lesson. Try a longer, text-heavy file.', 'error', 6000); return }
      onGenerated(qs)
    } finally {
      setBusy(false)
    }
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1">
        <Wand2 size={18} className="inline-block mr-1 align-text-bottom" />Generate Quiz from a Lesson
      </h3>
      <p className="modal-sub">
        Upload your lesson file and AcadFlow drafts quiz questions from it. You review and edit everything before saving.
      </p>

      {/* Guide */}
      <div style={{ background: 'var(--accent-l)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--ink2)' }}>
        <strong style={{ color: 'var(--ink)' }}>How it works:</strong>
        <ol style={{ margin: '6px 0 0', paddingLeft: 20, listStyleType: 'decimal', lineHeight: 1.7 }}>
          <li>Upload a <strong>PDF, Word (.docx), or PowerPoint (.pptx)</strong> lesson file. It is read on your device only, never uploaded.</li>
          <li>Pick how many questions and which types you want.</li>
          <li>Click <strong>Generate</strong>. The draft opens for you to review, edit, and then save.</li>
        </ol>
      </div>

      {/* File upload */}
      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Lesson file <span className="text-red-500">*</span></label>
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          <FileUp size={14} className="inline-block mr-1" />{fileName ? 'Change file' : 'Choose file (PDF / Word / PowerPoint)'}
          <input type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </label>
        {extracting && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>Reading {fileName}…</div>}
        {!extracting && fileName && text && (
          <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>
            <Check size={12} className="inline-block mr-1" />{fileName} · {words.toLocaleString()} words read
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Number of Questions</label>
        <input className="input w-full" type="number" min={1} max={50} value={count}
          onChange={e => setCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))} />
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Question Types</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TYPE_LABELS).map(([t, label]) => (
            <button key={t} type="button" onClick={() => toggleType(t)}
              className={`btn btn-sm ${qTypes.includes(t) ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Method */}
      <div className="field mb-4">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Generation method</label>
        <div className="flex flex-col gap-2">
          {[
            { id: 'device', title: 'On-device', desc: 'Instant, free, no setup. Drafts from your lesson text.' },
            { id: 'ai', title: 'AI (Gemini free tier)', desc: 'Higher quality. Needs a free Google API key (no credit card). Falls back to on-device if not set up.' },
          ].map(opt => {
            const active = method === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMethod(opt.id)}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', width: '100%',
                  padding: '11px 13px', borderRadius: 12, cursor: 'pointer',
                  background: active ? 'var(--accent-l)' : 'var(--surface)',
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'border-color .15s, background .15s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  border: `2px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)' }} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{opt.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 2, lineHeight: 1.5 }}>{opt.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleGenerate} disabled={busy || extracting || !text.trim()}>
          <Sparkles size={13} className="inline-block mr-1" />{busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </Modal>
  )
}

export default function QuizTab() {
  const { quizzes, classes, fbReady } = useData()
  const [page, setPage] = useState(1)
  const [archivedPage, setArchivedPage] = useState(1)
  const [showArchivedQuizzes, setShowArchivedQuizzes] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showLesson, setShowLesson] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [importedQuestions, setImportedQuestions] = useState([])
  const [viewQuiz, setViewQuiz] = useState(null)
  const [editQuiz, setEditQuiz] = useState(null)

  const sorted = useMemo(
    () => [...quizzes].sort((a, b) => b.createdAt - a.createdAt),
    [quizzes]
  )

  const activeQuizzes = useMemo(
    () => sorted.filter(q => (q.classIds || []).some(id => !classes.find(c => c.id === id)?.archived)),
    [sorted, classes]
  )
  const archivedQuizzes = useMemo(
    () => sorted.filter(q => (q.classIds || []).length > 0 && (q.classIds || []).every(id => classes.find(c => c.id === id)?.archived)),
    [sorted, classes]
  )

  const slice = useMemo(
    () => activeQuizzes.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [activeQuizzes, page]
  )

  const archivedSlice = useMemo(
    () => archivedQuizzes.slice((archivedPage - 1) * PER_PAGE, archivedPage * PER_PAGE),
    [archivedQuizzes, archivedPage]
  )

  const now = Date.now()

  function statusInfo(q) {
    if (now < q.openAt) return { label: 'Upcoming', variant: 'blue' }
    if (now > q.closeAt) return { label: 'Closed', variant: 'red' }
    return { label: 'Open', variant: 'green' }
  }

  function handleImported(qs) {
    setImportedQuestions(qs)
    setShowImport(false)
    setShowForm(true)
  }

  if (!fbReady) return <SkeletonTable />

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">Quizzes</div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}><Download size={13} className="inline-block mr-1" />Import AI Response</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExport(true)}><Upload size={13} className="inline-block mr-1" />Export Template</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowLesson(true)}><Wand2 size={13} className="inline-block mr-1" />Generate from Lesson</button>
        </div>
      </div>

      {!activeQuizzes.length && !archivedQuizzes.length ? (
        <div className="empty">
          <div className="empty-icon"><FileText size={32} /></div>
          No quizzes yet. Export a template, generate with AI, then import the response.
        </div>
      ) : activeQuizzes.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><FileText size={32} /></div>
          No active quizzes. All quizzes belong to archived classes.
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
          <Pagination total={activeQuizzes.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}

      {/* Archived Quizzes Section */}
      {archivedQuizzes.length > 0 && (
        <div className="mt-5">
          <button
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: 'var(--amber, #d97706)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => setShowArchivedQuizzes(v => !v)}
          >
            {showArchivedQuizzes ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {showArchivedQuizzes ? 'Hide' : 'Show'} Archived Class Quizzes ({archivedQuizzes.length})
          </button>
          {showArchivedQuizzes && (
            <>
              <div className="rounded-lg px-3 py-2 mb-3 text-sm font-medium"
                style={{ background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a' }}>
                <Archive size={13} className="inline-block mr-1 align-text-bottom" />
                These quizzes belong to archived classes and are read-only.
              </div>
              <div className="flex flex-col gap-3 mb-3">
                {archivedSlice.map(q => {
                  const { label, variant } = statusInfo(q)
                  const clsNames = (q.classIds || []).map(id => {
                    const c = classes.find(x => x.id === id)
                    return c ? `${c.name} ${c.section}` : id
                  }).join(', ')
                  const attempted = Object.keys(q.submissions || {}).length
                  const openLabel = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                  const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                  return (
                    <div key={q.id} className="card card-pad" style={{ opacity: 0.85 }}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <strong style={{ fontSize: 14 }}>{q.title}</strong>
                            <Badge variant={variant}>{label}</Badge>
                            <Badge variant="blue">{q.subject}</Badge>
                            <Badge variant="yellow">Archived</Badge>
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
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <Pagination total={archivedQuizzes.length} perPage={PER_PAGE} page={archivedPage} onChange={setArchivedPage} />
            </>
          )}
        </div>
      )}

      {showExport && (
        <ExportTemplateModal
          onClose={() => setShowExport(false)}
          onSwitchToImport={() => { setShowExport(false); setShowImport(true) }}
        />
      )}

      {showImport && (
        <ImportResponseModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {showLesson && (
        <GenerateFromLessonModal
          onClose={() => setShowLesson(false)}
          onGenerated={(qs) => { setShowLesson(false); handleImported(qs) }}
        />
      )}

      {showForm && (
        <QuizFormModal
          initialQuestions={importedQuestions}
          onClose={() => { setShowForm(false); setImportedQuestions([]) }}
        />
      )}

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
