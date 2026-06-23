// ── Smart deadline reminders ──────────────────────────────────────────────
// Pure, side-effect-free logic for the reminder engine and the "Coming up"
// digest. Given a student's enrolled work, it answers two questions:
//   1. pendingItems()      → what is still due (activities + quizzes)?
//   2. computeDueReminders() → which deadlines have crossed a reminder window
//                              and should fire a notification right now?
//
// The dispatcher (useReminders) and the Overview digest both build on these,
// so the rules for "what counts as due" live in exactly one place.

import { activeClassIds } from '@/utils/active'

// Reminder windows, largest first. A deadline fires one reminder per window it
// crosses; dedup (by remKey) guarantees each fires at most once per student.
export const REMINDER_OFFSETS = [
  { id: 't24h', ms: 24 * 60 * 60 * 1000 },
  { id: 't3h',  ms: 3  * 60 * 60 * 1000 },
]

// Human "time remaining" phrase for a positive millisecond gap.
export function humanLeft(ms) {
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${mins} min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? '' : 's'}`
  const days = Math.round(hrs / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// Unsubmitted, enrolled work that carries a due timestamp. Returns a normalized
// shape ({ kind, id, key, title, subject, when, tab }) the digest and the
// reminder engine share. Includes overdue items — callers filter as needed.
export function pendingItems({ student, classes, activities = [], quizzes = [], semester, now = Date.now() }) {
  if (!student) return []
  const ids = activeClassIds(student, classes, semester)
  if (!ids.length) return []
  const out = []

  for (const a of activities) {
    if (!a?.deadline || !ids.includes(a.classId)) continue
    if ((a.submissions || {})[student.id]?.link) continue
    out.push({
      kind: 'activity', id: a.id, key: `act_${a.id}`,
      title: a.title || 'Activity', subject: a.subject || '',
      when: a.deadline, tab: 'activities',
    })
  }

  for (const q of quizzes) {
    const qids = q?.classIds || []
    if (!q?.closeAt || !qids.some(id => ids.includes(id))) continue
    if ((q.submissions || {})[student.id]) continue
    out.push({
      kind: 'quiz', id: q.id, key: `quiz_${q.id}`,
      title: q.title || 'Quiz', subject: q.subject || '',
      when: q.closeAt, tab: 'quizzes',
    })
  }

  return out
}

// Reminders whose window has been reached but not yet passed. For each pending
// item we emit the SMALLEST (most urgent) window already crossed, so a student
// opening the app with 2 hours left gets a single "due in 2 hours" reminder,
// not a stale "due in 24 hours" one as well.
export function computeDueReminders(args) {
  const now = args.now || Date.now()
  const items = pendingItems({ ...args, now })
  const reminders = []

  for (const it of items) {
    const left = it.when - now
    if (left <= 0) continue // overdue: the deadline has passed, no reminder

    let bucket = null
    for (const off of REMINDER_OFFSETS) {
      if (left <= off.ms) bucket = off // offsets are largest→smallest, so this lands on the smallest crossed
    }
    if (!bucket) continue

    const isQuiz = it.kind === 'quiz'
    reminders.push({
      remKey: `${it.key}_${bucket.id}`,
      type: isQuiz ? 'quiz_reminder' : 'act_reminder',
      title: isQuiz ? 'Quiz closing soon' : 'Deadline reminder',
      body: `${it.title}${it.subject ? ' · ' + it.subject : ''} is due ${humanLeft(left)}.`,
      link: it.tab,
    })
  }

  return reminders
}
