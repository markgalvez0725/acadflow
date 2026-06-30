import React, { useState, useMemo, useEffect } from 'react'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { useRedirectHighlight } from '@/navigation/useRedirectHighlight'
import Modal from '@/components/primitives/Modal'
import Badge from '@/components/primitives/Badge'
import Avatar from '@/components/primitives/Avatar'
import Pagination from '@/components/primitives/Pagination'
import EmptyState from '@/components/ds/EmptyState'
import { Clock, AlertCircle, Upload, Download, Check, CheckCircle, ClipboardList, Pencil, Save, Rocket, FileText, X, Lock, Circle, Archive, ArchiveRestore, Sparkles, Wand2, FileUp, Copy, Lightbulb, ScanSearch, Fingerprint } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { extractTextFromFile } from '@/utils/lessonExtract'
import { generateDraftQuestions } from '@/utils/quizGen'
import { generateQuizSmart, prewarmQuizSmart, smartAutoKey, splitAnswerAlternates } from '@/utils/quizGenSmart'
import { auditDistractors } from '@/utils/distractorAudit'
import { compareStyle, collectQuizText } from '@/utils/stylometry'
import { mineAnswerKey } from '@/utils/answerKeyMine'
import { computeQuizScore } from '@/utils/quizScore'
import { quizItemAnalysis } from '@/utils/quizStats'
import { classTag, courseShort } from '@/utils/groupChat'


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

  const instructions = `INSTRUCTIONS:
Generate exactly ${count} quiz questions.
${source}
Use ${typeLabel}. Do NOT generate any other question type.
${extraContext}
Rules:
${rules}
- Every question MUST include an "explanation" field: 1-2 sentences stating why the answer is correct (shown to students when they review their results).

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

const ASSISTANT_PROMPT_TEXT = `I have a quiz template JSON file. Please read the _instructions field inside it carefully and generate the quiz questions exactly as described.

Each question object must include an "explanation" field (1-2 sentences on why the answer is correct).
Respond ONLY with a valid JSON array - no markdown, no commentary, no code block. Just the raw JSON array starting with [ and ending with ].`

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
    navigator.clipboard.writeText(ASSISTANT_PROMPT_TEXT).then(() => {
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
    toast('Template exported! Send it to your chat assistant.', 'green')
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1"><Upload size={18} className="inline-block mr-1 align-text-bottom" />Export Quiz Template</h3>
      <p className="modal-sub">
        Upload a lesson file (or type a topic), export the template JSON, send it to any chat assistant (Perplexity, ChatGPT, Claude…), then import the response back here.
      </p>

      {/* Lesson file - questions are drawn from its content (read on your device) */}
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
        <label className="text-xs font-semibold text-ink2 mb-1 block">Topic / focus <span className="font-normal text-ink3">{lessonText.trim() ? '(optional - narrows the lesson)' : '(required if no file)'}</span></label>
        <textarea
          className="input w-full"
          rows={3}
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder={lessonText.trim()
            ? 'Optional - e.g. focus on Chapter 3, or skip to cover the whole file'
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
          Additional Prompt <span className="font-normal text-ink3">(optional)</span>
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
          <li>Go to ChatGPT, Gemini, Claude, or any chat assistant</li>
          <li>Copy the prompt below, paste it, then attach or paste the <code>.json</code> file contents</li>
          <li>Copy the assistant’s JSON output, then click <strong>Import Response</strong></li>
        </ol>
      </div>

      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prompt to paste into the assistant</span>
          <button
            type="button"
            onClick={handleCopyPrompt}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: copied ? 'var(--accent)' : 'var(--surface)', color: copied ? '#fff' : 'var(--ink)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}
          >
            {copied ? <><Check size={11} className="inline-block mr-1" />Copied!</> : <><ClipboardList size={11} className="inline-block mr-1" />Copy</>}
          </button>
        </div>
        <pre style={{ margin: 0, padding: '10px 14px', fontSize: 12, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, userSelect: 'all' }}>
          {ASSISTANT_PROMPT_TEXT}
        </pre>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-ghost" onClick={onSwitchToImport}>
          <Download size={13} className="inline-block mr-1" />Import Response
        </button>
        <button className="btn btn-primary" onClick={handleExport} disabled={(!topic.trim() && !lessonText.trim()) || !qTypes.length || extracting}>
          <Upload size={13} className="inline-block mr-1" />Export Template
        </button>
      </div>
    </Modal>
  )
}

// ── Import Response Modal ──────────────────────────────────────────────────
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
    if (!parsed.length) { setJsonErr('The array is empty - paste at least one question.'); return }
    const qs = parsed.map((q, i) => ({ ...q, id: 'q' + i + '_' + Date.now() }))
    onImported(qs)
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1"><Download size={18} className="inline-block mr-1 align-text-bottom" />Import Response</h3>
      <p className="modal-sub">
        Paste the JSON array returned by your chat assistant. The quiz will be auto-configured and ready to save.
      </p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Paste JSON Output <span className="text-red-500">*</span></label>
        <textarea
          className="input w-full"
          rows={12}
          value={jsonInput}
          onChange={e => setJsonInput(e.target.value)}
          placeholder={'[\n  {"type":"multiple_choice","question":"...","options":[...],"answer":"..."},\n  ...\n]'}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
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
function QuizFormModal({ quiz, initialQuestions, initialDifficulty = 'medium', onClose }) {
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
  const [difficulty, setDifficulty] = useState(quiz?.difficulty || initialDifficulty || 'medium')
  const [editingQ, setEditingQ] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [keying, setKeying] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [audit, setAudit] = useState(null) // { perQuestion, quizNotes, audited, modelUsed } | null
  const [tab, setTab] = useState('details') // 'details' | 'questions'

  // Warm the shared on-device model so the first Auto-key / Audit click is fast.
  useEffect(() => { prewarmQuizSmart() }, [])

  const mcCount = useMemo(() => questions.filter(q => q.type === 'multiple_choice' && Array.isArray(q.options) && q.options.length >= 2).length, [questions])

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

  // Smart Auto-key: fill accepted alternate answers for text questions. Uses the
  // on-device Smart to mine grounded synonyms from the quiz's own content, merged
  // with the deterministic separator split. Falls back to split-only if the
  // model can't load. Suggestions are review-required (shown in editable boxes).
  async function bulkAutoKey() {
    setKeying(true)
    try {
      let result = null
      try { result = await smartAutoKey(questions, {}) } catch { result = null }
      if (result) {
        setQuestions(result.questions)
        toast(
          result.touched
            ? `Suggested accepted answers for ${result.touched} question${result.touched === 1 ? '' : 's'} - please review them.`
            : 'No new accepted answers to add.',
          result.touched ? 'green' : 'dark',
        )
        return
      }
      // Fallback: deterministic separator split (no model available).
      let touched = 0
      setQuestions(prev => prev.map(q => {
        if (!TEXT_TYPES.includes(q.type)) return q
        if (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length) return q
        const ans = String(q.answer || '').trim()
        const alts = splitAnswerAlternates(ans).filter(a => a.toLowerCase() !== ans.toLowerCase())
        if (!alts.length) return q
        touched++
        return { ...q, acceptedAnswers: alts }
      }))
      toast(touched ? `Seeded accepted answers for ${touched} question${touched === 1 ? '' : 's'}.` : 'No text questions to auto-key.', touched ? 'green' : 'dark')
    } finally {
      setKeying(false)
    }
  }

  // Audit distractors (#24) - on-device, advisory only. Flags weak MC options.
  async function runAudit() {
    setAuditing(true)
    try {
      const result = await auditDistractors(questions)
      setAudit(result)
      const flagged = Object.values(result.perQuestion).filter(p => !p.ok).length
      if (result.audited === 0) {
        toast('No multiple-choice questions to audit.', 'dark')
      } else if (flagged === 0 && !result.quizNotes.length) {
        toast(`Checked ${result.audited} multiple-choice question${result.audited === 1 ? '' : 's'} - distractors look good.`, 'green')
      } else {
        toast(`Found issues in ${flagged} question${flagged === 1 ? '' : 's'}${result.quizNotes.length ? ' + a quiz-level note' : ''} - see the flags below.`, 'dark')
      }
    } catch {
      toast('Could not run the audit on this device.', 'red')
    } finally {
      setAuditing(false)
    }
  }

  async function handleSave() {
    setErr('')
    if (!title.trim()) { setTab('details'); setErr('Quiz title is required.'); return }
    if (!classIds.length) { setTab('details'); setErr('Select at least one class.'); return }
    if (!subject) { setTab('details'); setErr('Select a subject.'); return }
    if (!questions.length) { setTab('questions'); setErr('Quiz must have at least one question.'); return }
    if (timeLimit < 1) { setTab('details'); setErr('Time limit must be at least 1 minute.'); return }
    const openTs = new Date(openAt).getTime()
    const closeTs = new Date(closeAt).getTime()
    if (isNaN(openTs) || isNaN(closeTs)) { setTab('details'); setErr('Invalid date range.'); return }
    if (closeTs <= openTs) { setTab('details'); setErr('Close time must be after open time.'); return }
    if (!fbReady || !db.current) { setErr('Firebase is required.'); return }

    const totalPoints = questions.reduce((sum, q) => sum + ((typeof q.points === 'number' && q.points > 0) ? q.points : 1), 0)
    const payload = {
      title: title.trim(), classIds, subject,
      timeLimit: parseInt(timeLimit), openAt: openTs, closeAt: closeTs,
      questions, totalPoints, partialCredit, difficulty,
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

      {/* Tabs: Details · Questions */}
      <div className="inline-flex bg-[var(--surface2)] border border-[var(--border)] rounded-full p-0.5 mb-3">
        {[
          { id: 'details', label: 'Details' },
          { id: 'questions', label: `Questions · ${questions.length}` },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors ${
              tab === t.id ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <div ref={el => el?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="err-msg mb-3">{err}</div>}

      {tab === 'details' && (
      <>
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
                  title={`${c.name} ${c.section}${subs ? ' - ' + subs : ''}`}
                  className={`btn btn-sm ${classIds.includes(c.id) ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, height: 'auto', padding: '6px 11px', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3, gap: 1 }}>
                  <span style={{ fontWeight: 700 }}>{classTag(c) || `${courseShort(c.name)} ${c.section}`}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85 }}>{subs || 'No subjects'}</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-ink3 mt-2">Each chip is a class section and the subject(s) it offers - pick the one that matches the subject below.</p>
          </>
        )}
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Subject <span className="text-red-500">*</span></label>
        <select className="input w-full" value={subject} onChange={e => setSubject(e.target.value)}>
          <option value="">- Select Subject -</option>
          {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Difficulty</label>
        <div className="flex gap-2">
          {['easy', 'medium', 'hard'].map(d => (
            <button key={d} type="button" onClick={() => setDifficulty(d)}
              className={`btn btn-sm ${difficulty === d ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, fontSize: 12, textTransform: 'capitalize' }}>
              {d}
            </button>
          ))}
        </div>
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
      </>
      )}

      {/* Questions Editor */}
      {tab === 'questions' && (
      <div className="field mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-ink2">{questions.length} Questions · {questions.reduce((s, q) => s + ((typeof q.points === 'number' && q.points > 0) ? q.points : 1), 0)} pts</label>
          <div className="flex gap-1">
            {mcCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={runAudit} disabled={auditing} title="Check multiple-choice distractors for ambiguous, duplicate, or giveaway options (on-device, advisory)"><ScanSearch size={12} className="inline-block mr-1" />{auditing ? 'Auditing…' : 'Audit choices'}</button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={bulkAutoKey} disabled={keying} title="Suggest accepted alternate answers using on-device Smart suggestions (review before sharing)"><Wand2 size={12} className="inline-block mr-1" />{keying ? 'Auto-keying…' : 'Auto-key'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add Question</button>
          </div>
        </div>
        {audit && audit.quizNotes.length > 0 && (
          <div className="mb-2 px-3 py-2 rounded-lg" style={{ background: 'var(--yellow-l)', border: '1px solid var(--border)' }}>
            {audit.quizNotes.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>
                <AlertCircle size={12} style={{ flexShrink: 0, color: 'var(--gold-var)', transform: 'translateY(2px)' }} />
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3" style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
          {questions.map((q, i) => (
            <div key={q.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>
                  Q{i + 1} · <span style={{ color: 'var(--accent)' }}>{TYPE_LABELS[q.type] || q.type}</span>
                  <span style={{ marginLeft: 6, fontWeight: 600, color: 'var(--ink3)' }}>{(typeof q.points === 'number' && q.points > 0) ? q.points : 1} pt{((typeof q.points === 'number' && q.points > 0) ? q.points : 1) === 1 ? '' : 's'}</span>
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
              {q.type === 'multiple_choice' && audit?.perQuestion[q.id] && (() => {
                const a = audit.perQuestion[q.id]
                return (
                  <div style={{ marginTop: 6 }}>
                    {a.ok ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--green-l)', color: 'var(--green)' }}>
                        <CheckCircle size={11} /> Good distractors
                      </span>
                    ) : (
                      <>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--red-l, #fee2e2)', color: 'var(--red)' }}>
                          <AlertCircle size={11} /> {a.issues.length} issue{a.issues.length === 1 ? '' : 's'}
                        </span>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                          {a.issues.map((it, k) => (
                            <li key={k} style={{ display: 'flex', gap: 5, alignItems: 'baseline', fontSize: 11, color: 'var(--ink2)', lineHeight: 1.5 }}>
                              <span style={{ flexShrink: 0, color: 'var(--red)' }}>•</span>
                              <span>{it.msg}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )
              })()}
              {q.explanation && editingQ !== q.id && (
                <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', marginTop: 6, fontSize: 11, color: 'var(--ink3)', lineHeight: 1.5 }}>
                  <Lightbulb size={12} style={{ flexShrink: 0, color: 'var(--yellow)', transform: 'translateY(2px)' }} />
                  <span><span style={{ fontWeight: 600, color: 'var(--ink2)' }}>Explanation:</span> {q.explanation}</span>
                </div>
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
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>Accepted alternate answers <span className="text-ink3">(comma-separated - any one counts as correct)</span></label>
                        <input className="input w-full" style={{ fontSize: 12 }} placeholder="e.g. H2O, water, dihydrogen monoxide"
                          value={(q.acceptedAnswers || []).join(', ')}
                          onChange={e => updateQuestion(q.id, 'acceptedAnswers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
                      </div>
                    </>
                  )}
                  <div className="field">
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <Lightbulb size={11} style={{ color: 'var(--yellow)' }} />Explanation <span className="text-ink3" style={{ fontWeight: 500 }}>(shown to students on review)</span>
                    </label>
                    <textarea className="input w-full" rows={2} style={{ fontSize: 12 }} placeholder="Why this answer is correct…"
                      value={q.explanation || ''}
                      onChange={e => updateQuestion(q.id, 'explanation', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

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
    return <div style={{ fontSize: 12, color: 'var(--ink2)', padding: '8px 0' }}>No submissions yet - analysis appears once students have taken the quiz.</div>
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
                    {o.text || '-'} · {o.count}
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
  const { students, purgeQuizFromStudents, quizzes, saveStudents } = useData()
  const { toast, openDialog } = useUI()
  const { db } = useData()

  // ── Answer-key auto-improvement (#41) ───────────────────────────────────────
  const [mineResult, setMineResult] = useState(null)   // { perQuestion, modelUsed } | null
  const [mining, setMining] = useState(false)
  const [mineOpen, setMineOpen] = useState(false)
  const [picked, setPicked] = useState({})             // { `${qIndex}:::${text}`: true }
  const [applying, setApplying] = useState(false)

  // ── Impersonation / writing-style check (#39) ───────────────────────────────
  // On-device stylometry (no model): compares each student's text answers in this
  // quiz against their text answers across their OTHER quizzes. Advisory flag only.
  const [styleResults, setStyleResults] = useState(null) // { [sid]: compareStyle result } | null
  const [styleChecking, setStyleChecking] = useState(false)
  const hasTextQs = useMemo(
    () => (quiz.questions || []).some(q => q.type === 'short_answer' || q.type === 'fill_in_the_blank' || q.type === 'identification'),
    [quiz.questions]
  )

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

  function runStyleCheck() {
    setStyleChecking(true)
    try {
      const others = (quizzes || []).filter(q => q.id !== quiz.id)
      const res = {}
      let flagged = 0, compared = 0
      enrolledStudents.forEach(s => {
        if (!submissions[s.id]) return
        const cur  = collectQuizText(quiz, s.id)
        const base = others.map(q => collectQuizText(q, s.id)).filter(Boolean).join('. ')
        const r = compareStyle(cur, base)
        res[s.id] = r
        if (r.enoughData) compared++
        if (r.flag) flagged++
      })
      setStyleResults(res)
      if (compared === 0) toast('Not enough past writing yet to compare styles.', 'dark')
      else if (flagged === 0) toast(`Checked ${compared} attempt${compared === 1 ? '' : 's'} - styles look consistent.`, 'green')
      else toast(`${flagged} attempt${flagged === 1 ? '' : 's'} differ from the student's past writing - worth a look.`, 'dark')
    } catch {
      toast('Could not run the style check.', 'red')
    } finally {
      setStyleChecking(false)
    }
  }

  async function runMine() {
    setMining(true)
    try {
      const res = await mineAnswerKey(quiz)
      setMineResult(res)
      setPicked({})
      const total = res.perQuestion.reduce((n, p) => n + p.candidates.length, 0)
      if (!res.modelUsed && !res.perQuestion.length) {
        toast('No likely-correct answers were missed - or the on-device model is unavailable.', 'dark')
      } else if (total === 0) {
        toast('No missed-correct answers found - the key looks complete.', 'green')
      } else {
        setMineOpen(true)
      }
    } catch {
      toast('Could not analyze answers on this device.', 'red')
    } finally {
      setMining(false)
    }
  }

  // Append the professor-approved alternates to the key and re-grade existing
  // attempts so students who gave those answers get credit now.
  async function applyKeyImprovements() {
    if (!mineResult) return
    // Collect selected alternates per question index.
    const addsByQ = {}
    mineResult.perQuestion.forEach(p => {
      p.candidates.forEach(c => {
        if (picked[`${p.qIndex}:::${c.text}`]) (addsByQ[p.qIndex] ||= []).push(c.text)
      })
    })
    const qIndexes = Object.keys(addsByQ)
    if (!qIndexes.length) { toast('Tick at least one answer to add.', 'dark'); return }

    setApplying(true)
    try {
      // 1. Build updated questions with merged acceptedAnswers (deduped).
      const updatedQuestions = quiz.questions.map((q, i) => {
        const adds = addsByQ[i]
        if (!adds || !adds.length) return q
        const existing = Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : []
        const merged = [...existing]
        adds.forEach(a => { if (!merged.some(x => String(x).trim().toLowerCase() === a.trim().toLowerCase())) merged.push(a) })
        return { ...q, acceptedAnswers: merged }
      })

      // 2. Re-grade every submission against the improved key.
      const update = { questions: updatedQuestions }
      const newScores = {} // sid -> { score, total, pct }
      Object.entries(submissions).forEach(([sid, sub]) => {
        if (!Array.isArray(sub.answers)) return
        const { score, total } = computeQuizScore(updatedQuestions, sub.answers, { partialCredit: !!quiz.partialCredit })
        if (score !== sub.score) {
          update[`submissions.${sid}.score`] = score
          update[`submissions.${sid}.total`] = total
          newScores[sid] = { score, total, pct: total > 0 ? Math.round((score / total) * 10000) / 100 : 0 }
        }
      })

      // 3. Persist the quiz doc (key + re-graded scores) - admin write, rule-safe.
      await updateDoc(doc(db.current, 'quizzes', quiz.id), update)

      // 4. Update the denormalized quizResults cache on affected students.
      const changedIds = Object.keys(newScores)
      if (changedIds.length) {
        const subject = quiz.subject
        const updatedStudents = students.map(s => {
          if (!newScores[s.id]) return s
          const qr = s.quizResults || {}
          const list = (qr[subject] || []).map(e => e.quizId === quiz.id ? { ...e, ...newScores[s.id] } : e)
          return { ...s, quizResults: { ...qr, [subject]: list } }
        })
        await saveStudents(updatedStudents, changedIds)
      }

      const added = qIndexes.reduce((n, i) => n + addsByQ[i].length, 0)
      toast(`Added ${added} answer${added === 1 ? '' : 's'} to the key${changedIds.length ? ` - re-graded ${changedIds.length} attempt${changedIds.length === 1 ? '' : 's'}` : ''}.`, 'green')
      setMineOpen(false); setMineResult(null); setPicked({})
    } catch (e) {
      toast('Could not apply changes: ' + e.message, 'red')
    } finally {
      setApplying(false)
    }
  }

  async function handleDelete() {
    const ok = await openDialog({
      title: `Delete "${quiz.title}"?`,
      msg: 'This quiz, its submissions, and every student’s recorded score for it will be permanently removed.',
      type: 'danger', confirmLabel: 'Delete Quiz', showCancel: true,
    })
    if (!ok) return
    try {
      await deleteDoc(doc(db.current, 'quizzes', quiz.id))
      // Remove the quiz's denormalized score from every student so it no longer
      // shows in their Grades/Overview.
      try { await purgeQuizFromStudents(quiz) } catch (e) { /* listener will still drop the quiz doc */ }
      onDelete()
    } catch (e) {
      toast('Delete failed: ' + e.message, 'red')
    }
  }

  async function handleClone() {
    try {
      const id = quizId()
      const copy = {
        ...quiz, id,
        title: `${quiz.title} (Copy)`,
        submissions: {},          // a fresh quiz - no carried-over attempts
        createdAt: Date.now(),
        openAt: Date.now(),
        closeAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
      await setDoc(doc(db.current, 'quizzes', id), copy)
      toast('Quiz duplicated - opens now, closes in 7 days. Edit to adjust dates/classes.', 'green')
      onClose()
    } catch (e) {
      toast('Duplicate failed: ' + e.message, 'red')
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
          <Clock size={13} className="inline-block mr-1 align-text-bottom" />Upcoming - opens {openLabel}
        </div>
      )}
      {isOpen && (
        <div style={{ background: 'var(--green-l)', color: 'var(--green)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <Circle size={13} className="inline-block mr-1 align-text-bottom" style={{ fill: 'var(--green)', color: 'var(--green)' }} />Open - closes {closeLabel}
        </div>
      )}
      {isClosed && (
        <div style={{ background: 'var(--red-l)', color: 'var(--red)', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <Lock size={13} className="inline-block mr-1 align-text-bottom" />Closed - {attempted}/{enrolledStudents.length} attempted · {graded} auto-graded
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
              <th title="Anti-cheat signals captured while taking the quiz">
                Flags
                {hasTextQs && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px', verticalAlign: 'middle' }}
                    onClick={runStyleCheck} disabled={styleChecking}
                    title="Compare each student's writing style here against their past quizzes (on-device, advisory)">
                    <Fingerprint size={11} className="inline-block mr-1 align-text-bottom" />{styleChecking ? 'Checking…' : styleResults ? 'Re-check style' : 'Check style'}
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {enrolledStudents.map(s => {
              const sub = submissions[s.id]
              const hasAttempt = !!sub
              const score = sub?.score
              const total = (sub?.total ?? quiz.totalPoints ?? quiz.questions?.length) || 1
              const pct = score != null ? ((score / total) * 100).toFixed(1) : null
              const timeTaken = sub?.timeTaken ? Math.round(sub.timeTaken / 60) + ' min' : '-'
              const limitSecs = (quiz.timeLimit || 0) * 60
              const tooFast = hasAttempt && sub?.timeTaken != null && limitSecs > 0 && sub.timeTaken < Math.max(20, limitSecs * 0.15)
              const leftN = sub?.leftCount || 0
              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar photo={s.photo} name={s.name} size={26} style={{ borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <strong>{s.name}</strong>
                        <br /><span style={{ fontSize: 11, color: 'var(--ink2)' }}>{s.snum || s.id}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {hasAttempt
                      ? <Badge variant="green"><CheckCircle size={11} className="inline-block mr-1 align-text-bottom" />Submitted</Badge>
                      : <Badge variant="gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{isClosed ? <><AlertCircle size={11} />Missed</> : <><Clock size={11} />Not yet</>}</Badge>}
                  </td>
                  <td>{score != null ? `${score}/${total}` : '-'}</td>
                  <td>
                    {pct != null ? (
                      <span style={{ fontWeight: 700, color: pct >= 75 ? 'var(--green)' : pct >= 50 ? '#f59e0b' : 'var(--red)' }}>
                        {pct}%
                      </span>
                    ) : '-'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink2)' }}>{timeTaken}</td>
                  <td>
                    {hasAttempt ? (
                      <div className="flex gap-1 flex-wrap">
                        {tooFast && <span className="badge badge-yellow" title={`Finished in ${sub.timeTaken}s - under 15% of the ${quiz.timeLimit}-min limit`}>Fast</span>}
                        {leftN >= 2 && <span className="badge badge-red" title={`Left the quiz ${leftN} times - answers were reset & reshuffled`}>Left {leftN}×</span>}
                        {leftN === 1 && <span className="badge badge-gray" title="Left once (first slip is only a warning)">1 slip</span>}
                        {styleResults?.[s.id]?.flag && (
                          <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            title={`Writing style differs from this student's past quizzes (similarity ${(styleResults[s.id].sim * 100).toFixed(0)}%) - a hint to look closer, not a verdict.`}>
                            <Fingerprint size={11} />Style
                          </span>
                        )}
                        {styleResults?.[s.id] && !styleResults[s.id].flag && styleResults[s.id].enoughData && (
                          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            title={`Writing style is consistent with this student's past quizzes (similarity ${(styleResults[s.id].sim * 100).toFixed(0)}%).`}>
                            <Fingerprint size={11} />OK
                          </span>
                        )}
                        {!tooFast && leftN === 0 && !(styleResults?.[s.id]?.enoughData) && <span style={{ color: 'var(--ink3)', fontSize: 12 }}>-</span>}
                      </div>
                    ) : <span style={{ color: 'var(--ink3)', fontSize: 12 }}>-</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Item analysis - per-question performance */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 12 }}>
        <div className="flex gap-1 flex-wrap" style={{ marginBottom: showAnalysis ? 10 : 0 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowAnalysis(v => !v)}
          >
            <ClipboardList size={13} className="inline-block mr-1" />
            {showAnalysis ? 'Hide item analysis' : 'Item analysis'}
          </button>
          {hasTextQs && attempted > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={runMine} disabled={mining}
              title="Find correct answers your key missed by mining student responses (on-device, you approve before anything changes)">
              <Wand2 size={13} className="inline-block mr-1" />{mining ? 'Analyzing…' : 'Improve answer key'}
            </button>
          )}
        </div>
        {showAnalysis && <QuizItemAnalysis quiz={quiz} />}
      </div>

      {mineOpen && mineResult && (
        <Modal onClose={() => setMineOpen(false)} size="lg">
          <h3 className="text-lg font-bold text-ink mb-1"><Wand2 size={16} className="inline-block mr-1 align-text-bottom" />Improve answer key</h3>
          <p className="modal-sub">These student answers were marked wrong but mean roughly the same as your key. Tick the ones that should count - they'll be added to the key and matching attempts re-graded.</p>
          <div className="flex flex-col gap-3" style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4, marginTop: 8 }}>
            {mineResult.perQuestion.map(p => (
              <div key={p.qIndex} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)', marginBottom: 2 }}>Q{p.qIndex + 1}</div>
                <p style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 2 }}>{p.question || <em style={{ color: 'var(--ink3)' }}>No question text</em>}</p>
                <p style={{ fontSize: 11, color: 'var(--green)', marginBottom: 8 }}>Key: {p.keys.join(' · ')}</p>
                <div className="flex flex-col gap-1.5">
                  {p.candidates.map(c => {
                    const key = `${p.qIndex}:::${c.text}`
                    return (
                      <label key={key} className="flex items-center gap-2" style={{ fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!picked[key]}
                          onChange={e => setPicked(prev => ({ ...prev, [key]: e.target.checked }))} />
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.text}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>· {c.count} student{c.count === 1 ? '' : 's'} · {(c.sim * 100).toFixed(0)}% match</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setMineOpen(false)} disabled={applying}>Cancel</button>
            <button className="btn btn-primary" onClick={applyKeyImprovements} disabled={applying}>
              {applying ? 'Applying…' : 'Add selected & re-grade'}
            </button>
          </div>
        </Modal>
      )}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={13} className="inline-block mr-1" />Edit</button>
        <button className="btn btn-ghost btn-sm" onClick={handleClone}><Copy size={13} className="inline-block mr-1" />Duplicate</button>
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
  const [difficulty, setDifficulty] = useState('medium') // 'easy' | 'medium' | 'hard'
  const [method, setMethod] = useState('smart') // 'smart' (on-device) | 'quick' (instant rules)
  const [busy, setBusy] = useState(false)

  // Warm the on-device Smart model the moment the modal opens so the first
  // generation isn't a cold ~120MB download-and-compile wait.
  useEffect(() => { prewarmQuizSmart() }, [])

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
      if (method === 'smart') {
        // Custom on-device Smart (sentence embeddings). Grounded in the lesson,
        // private, $0 - no Gemini. Falls back to quick drafts if it can't run.
        try {
          const qs = await generateQuizSmart(text, { count, types: qTypes, difficulty })
          if (qs && qs.length) { onGenerated(qs, difficulty); return }
          toast('Smart generator unavailable on this device - using quick drafts.', 'info', 5000)
        } catch {
          toast('Smart generator hit a snag - using quick drafts.', 'warn', 5000)
        }
      }
      // Quick rule-based drafts (default, or smart fallback)
      const qs = generateDraftQuestions(text, { count, types: qTypes, difficulty })
      if (!qs.length) { toast('Could not draft questions from this lesson. Try a longer, text-heavy file.', 'error', 6000); return }
      onGenerated(qs, difficulty)
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

      {/* Difficulty */}
      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Difficulty</label>
        <div className="flex gap-2">
          {[
            { id: 'easy',   label: 'Easy',   desc: 'Clearly different options' },
            { id: 'medium', label: 'Medium', desc: 'Balanced' },
            { id: 'hard',   label: 'Hard',   desc: 'Tricky near-miss options' },
          ].map(opt => {
            const active = difficulty === opt.id
            return (
              <button key={opt.id} type="button" onClick={() => setDifficulty(opt.id)}
                title={opt.desc}
                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, fontSize: 12 }}>
                {opt.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-ink3 mt-1">
          {difficulty === 'easy'
            ? 'Wrong choices look obviously different - easier to eliminate.'
            : difficulty === 'hard'
              ? 'Wrong choices are close in meaning - students must read carefully.'
              : 'A balanced mix of plausible wrong choices.'}
        </p>
      </div>

      {/* Method */}
      <div className="field mb-4">
        <label className="text-xs font-semibold text-ink2 mb-2 block">Generation method</label>
        <div className="flex flex-col gap-2">
          {[
            { id: 'smart', title: 'Smart (on-device)', desc: 'Best quality. A multilingual on-device model reads your lesson - private, free, no key, works in Filipino. First run downloads ~120MB, then it’s cached.' },
            { id: 'quick', title: 'Quick draft', desc: 'Instant, no download. Rule-based drafts from your lesson text.' },
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
  const highlightId = useRedirectHighlight('quiz')
  const [page, setPage] = useState(1)
  const [archivedPage, setArchivedPage] = useState(1)
  const [showArchivedQuizzes, setShowArchivedQuizzes] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showLesson, setShowLesson] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [importedQuestions, setImportedQuestions] = useState([])
  const [importedDifficulty, setImportedDifficulty] = useState('medium')
  const [viewQuiz, setViewQuiz] = useState(null)
  const [editQuiz, setEditQuiz] = useState(null)

  // O(1) class lookups by id, instead of classes.find() per quiz/card.
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes])

  const sorted = useMemo(
    () => [...quizzes].sort((a, b) => b.createdAt - a.createdAt),
    [quizzes]
  )

  const activeQuizzes = useMemo(
    // A quiz is active if it has any non-archived class - OR no class assignment
    // at all (orphaned quizzes must stay visible/deletable, not vanish).
    () => sorted.filter(q => !(q.classIds || []).length || (q.classIds || []).some(id => !classMap.get(id)?.archived)),
    [sorted, classMap]
  )
  const archivedQuizzes = useMemo(
    () => sorted.filter(q => (q.classIds || []).length > 0 && (q.classIds || []).every(id => classMap.get(id)?.archived)),
    [sorted, classMap]
  )

  const slice = useMemo(
    () => activeQuizzes.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [activeQuizzes, page]
  )

  // Deep-linked from elsewhere: page to the quiz (revealing the archived list
  // if needed) so its card renders for the scroll-and-glow.
  useEffect(() => {
    if (!highlightId) return
    const ai = activeQuizzes.findIndex(q => q.id === highlightId)
    if (ai >= 0) { setPage(Math.floor(ai / PER_PAGE) + 1); return }
    const xi = archivedQuizzes.findIndex(q => q.id === highlightId)
    if (xi >= 0) { setShowArchivedQuizzes(true); setArchivedPage(Math.floor(xi / PER_PAGE) + 1) }
  }, [highlightId, activeQuizzes, archivedQuizzes])

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

  function handleImported(qs, difficulty = 'medium') {
    setImportedQuestions(qs)
    setImportedDifficulty(difficulty)
    setShowImport(false)
    setShowForm(true)
  }

  if (!fbReady) return <SkeletonTable />

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">Quizzes</div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}><Download size={13} className="inline-block mr-1" />Import Response</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExport(true)}><Upload size={13} className="inline-block mr-1" />Export Template</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowLesson(true)}><Wand2 size={13} className="inline-block mr-1" />Generate from Lesson</button>
        </div>
      </div>

      {!activeQuizzes.length && !archivedQuizzes.length ? (
        <EmptyState
          Icon={FileText}
          title="No quizzes yet"
          text="Export a template, generate with a chat assistant, then import the response."
        />
      ) : activeQuizzes.length === 0 ? (
        <EmptyState
          Icon={FileText}
          title="No active quizzes"
          text="All quizzes belong to archived classes."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-3">
            {slice.map(q => {
              const { label, variant } = statusInfo(q)
              const clsNames = (q.classIds || []).map(id => {
                const c = classMap.get(id)
                return c ? `${courseShort(c.name)} ${c.section}` : id
              }).join(', ')
              const attempted = Object.keys(q.submissions || {}).length
              const openLabel = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
              const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

              return (
                <div key={q.id} id={`quiz-${q.id}`} className={`card card-pad${highlightId === q.id ? ' redirect-glow' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <strong style={{ fontSize: 14 }}>{q.title}</strong>
                        <Badge variant={variant}>{label}</Badge>
                        <Badge variant="blue">{q.subject}</Badge>
                        {q.difficulty && (
                          <Badge variant={q.difficulty === 'easy' ? 'green' : q.difficulty === 'hard' ? 'red' : 'gray'}>{q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}</Badge>
                        )}
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
                    const c = classMap.get(id)
                    return c ? `${courseShort(c.name)} ${c.section}` : id
                  }).join(', ')
                  const attempted = Object.keys(q.submissions || {}).length
                  const openLabel = new Date(q.openAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                  const closeLabel = new Date(q.closeAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                  return (
                    <div key={q.id} id={`quiz-${q.id}`} className={`card card-pad${highlightId === q.id ? ' redirect-glow' : ''}`} style={{ opacity: 0.85 }}>
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
          onGenerated={(qs, difficulty) => { setShowLesson(false); handleImported(qs, difficulty) }}
        />
      )}

      {showForm && (
        <QuizFormModal
          initialQuestions={importedQuestions}
          initialDifficulty={importedDifficulty}
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
