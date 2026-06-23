// ── Activity AI helpers (free on-device templates + optional Gemini) ──────
// Used by the New Activity form (instructions, rubric) and the grading assist.
// AI calls go through /api/ai-generate (gated by a free Gemini key); every
// function has an on-device fallback so the app works with no key.

import { aiRequest } from '@/utils/aiGateway'

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

// ── AI wrappers (call /api/ai-generate via the serialized gateway) ─────────
async function callAI(prompt, json, opts = {}) {
  const { ok, status, data, error } = await aiRequest('/api/ai-generate', { prompt, json: !!json }, opts)
  if (status === 501) { const e = new Error('not-configured'); e.code = 501; throw e }
  if (!ok) throw new Error(error || 'AI request failed')
  return data
}

export async function aiInstructions(title, subject) {
  const prompt = `Write clear, concise instructions (2-4 sentences) for a student activity titled "${title}"${subject ? ` in the subject ${subject}` : ''}. Tell them what to do, what to submit (a shareable link), and any reminders. Output only the instructions text, no preamble.`
  const { text } = await callAI(prompt, false)
  return (text || '').trim()
}

// Explain a quiz question for a student reviewing their result. Throws with
// code 501 when AI is unconfigured so the caller can fall back gracefully.
export async function aiExplainQuiz({ question, correctAnswer, studentAnswer, subject }) {
  const prompt = `A student is reviewing a quiz question they got wrong${subject ? ` in ${subject}` : ''}.
Question: ${question}
Correct answer: ${correctAnswer}
Student's answer: ${studentAnswer || '(left blank)'}
In 2-3 short sentences, kindly explain why the correct answer is right and where the student likely went wrong. Output only the explanation, no preamble.`
  // Same question → same explanation: cache so repeated "Explain" taps don't re-call.
  const { text } = await callAI(prompt, false, { cache: true })
  return (text || '').trim()
}

export async function aiRubric(title, subject, instructions) {
  const prompt = `Create a grading rubric for the student activity "${title}"${subject ? ` in ${subject}` : ''}.${instructions ? ` Instructions: ${instructions}.` : ''}
Return ONLY a JSON array of 3-5 criteria. Each item: {"name":"...","points":NN}. The points must be whole numbers that sum to exactly 100.`
  const { json } = await callAI(prompt, true)
  const arr = Array.isArray(json) ? json : (json?.criteria || [])
  const clean = arr
    .filter(c => c && c.name)
    .map(c => ({ name: String(c.name).slice(0, 60), points: Math.max(1, Math.round(Number(c.points) || 0)) }))
  return withIds(clean.length ? clean : [])
}

/**
 * Suggest a grade for a submission against the rubric.
 * @returns {Promise<{score:number, feedback:string, criteria:Array<{name,met,points}>}>}
 */
export async function aiGrade({ title, subject, instructions, rubric, maxScore, submissionText }) {
  const rubricText = rubric?.length
    ? rubric.map(c => `- ${c.name} (${c.points} pts)`).join('\n')
    : `- Overall quality (out of ${maxScore || 100})`
  const prompt = `You are grading a student submission for the activity "${title}"${subject ? ` in ${subject}` : ''}.
${instructions ? `Instructions: ${instructions}\n` : ''}Rubric:
${rubricText}

Student submission:
"""
${(submissionText || '').slice(0, 12000)}
"""

Assess fairly against the rubric. Return ONLY JSON:
{"score": <number 0-${maxScore || 100}>, "feedback": "2-3 sentences of constructive feedback", "criteria": [{"name":"<rubric criterion>","met": true|false, "points": <points awarded>}]}`
  const { json } = await callAI(prompt, true)
  return {
    score: Math.max(0, Math.min(maxScore || 100, Math.round(Number(json?.score) || 0))),
    feedback: String(json?.feedback || '').slice(0, 800),
    criteria: Array.isArray(json?.criteria) ? json.criteria : [],
  }
}

export function isNotConfigured(err) { return err && (err.code === 501 || err.message === 'not-configured') }
