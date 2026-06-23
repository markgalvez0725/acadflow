// ── Live Quiz (Kahoot-style) — Firestore writes ─────────────────────────────
// One document per game lives in the `liveQuizSessions` collection. Students
// only ever write their own `players.<pid>` sub-path, so concurrent answers
// merge at the field level and never clobber each other (same pattern as
// activity submissions). Reads come through the real-time listener.

import { fbWithTimeout } from './firebaseInit'

function genPin() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Create a new live session from a quiz snapshot. `questions` should already be
// filtered to the playable (MC/TF) set by the caller.
export async function fbCreateLiveSession(db, { quiz, questions, hostId = 'admin', perQuestionSeconds = 20 }) {
  const { doc, setDoc } = await import('firebase/firestore')
  const id = 'lq_' + Date.now() + Math.random().toString(36).slice(2, 6)
  const session = {
    id,
    pin: genPin(),
    quizId: quiz.id,
    quizTitle: quiz.title || 'Live quiz',
    subject: quiz.subject || '',
    classIds: Array.isArray(quiz.classIds) ? quiz.classIds : (quiz.classId ? [quiz.classId] : []),
    hostId,
    status: 'lobby',          // 'lobby' | 'question' | 'reveal' | 'ended'
    currentIndex: -1,
    questionStartedAt: null,
    perQuestionSeconds,
    questionCount: questions.length,
    questions,                // snapshot: [{ question, type, options, answer }]
    players: {},              // pid -> { name, joinedAt, answers: { idx: {choice,correct,ms,points} } }
    createdAt: Date.now(),
  }
  await fbWithTimeout(setDoc(doc(db, 'liveQuizSessions', id), session))
  return session
}

async function patch(db, id, data) {
  const { doc, updateDoc } = await import('firebase/firestore')
  return fbWithTimeout(updateDoc(doc(db, 'liveQuizSessions', id), data))
}

// A player joins the lobby (idempotent — re-join keeps existing answers).
export async function fbJoinLiveSession(db, id, pid, name) {
  const { doc, getDoc, updateDoc } = await import('firebase/firestore')
  const ref = doc(db, 'liveQuizSessions', id)
  const snap = await fbWithTimeout(getDoc(ref))
  const existing = snap.exists() ? (snap.data().players || {})[pid] : null
  if (existing) return
  return fbWithTimeout(updateDoc(ref, { [`players.${pid}`]: { name, joinedAt: Date.now(), answers: {} } }))
}

// Host advances the room state (start, next, reveal, end).
export function fbSetLiveState(db, id, { status, currentIndex, questionStartedAt }) {
  const data = {}
  if (status !== undefined) data.status = status
  if (currentIndex !== undefined) data.currentIndex = currentIndex
  if (questionStartedAt !== undefined) data.questionStartedAt = questionStartedAt
  return patch(db, id, data)
}

// A player submits an answer for one question (writes only their own sub-path).
export function fbSubmitLiveAnswer(db, id, pid, qIndex, answer) {
  return patch(db, id, { [`players.${pid}.answers.${qIndex}`]: answer })
}

export async function fbDeleteLiveSession(db, id) {
  const { doc, deleteDoc } = await import('firebase/firestore')
  return fbWithTimeout(deleteDoc(doc(db, 'liveQuizSessions', id)))
}
