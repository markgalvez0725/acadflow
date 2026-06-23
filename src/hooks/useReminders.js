// ── useReminders ──────────────────────────────────────────────────────────
// Client-side reminder dispatcher. While a student has AcadFlow open, this scans
// their pending work and fires a notification when a deadline crosses the 24h /
// 3h windows — the time-based reminders the app otherwise lacks (every other
// notification is event-triggered). It runs on mount and every few minutes.
//
// Idempotency lives in the writer (fbPushReminderNotif dedups by remKey against
// the student's own notifications doc), so running here repeatedly — or from
// several devices — still reminds each deadline exactly once. A new in-app item
// is always written; a best-effort web push is sent only when the item was
// newly created, so a backgrounded tab still surfaces the reminder.
//
// Note: this only reminds while the app is open on some device. A server cron
// (e.g. Vercel) reusing computeDueReminders() would extend this to closed apps;
// the logic is intentionally pure so it can be lifted there unchanged.
import { useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { computeDueReminders } from '@/utils/reminders'
import { fbPushReminderNotif } from '@/firebase/reminders'
import { sendPushToOwners } from '@/firebase/pushTokens'
import { isNotifAllowed } from '@/utils/notifPrefs'

const CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes

export function useReminders(student) {
  const { db, fbReady, classes, activities, quizzes, semester } = useData()
  const runningRef = useRef(false)

  useEffect(() => {
    if (!student?.id || !fbReady || !db.current) return
    let cancelled = false

    async function run() {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const due = computeDueReminders({ student, classes, activities, quizzes, semester })
        for (const rem of due) {
          if (cancelled) break
          // Respect the student's per-category mute preferences.
          if (!isNotifAllowed({ type: rem.type }, student.notifPrefs)) continue
          const created = await fbPushReminderNotif(db.current, student.id, rem)
          if (created) {
            sendPushToOwners(
              db.current, [student.id],
              { title: rem.title, body: rem.body },
              { url: '/', tag: rem.remKey },
            )
          }
        }
      } finally {
        runningRef.current = false
      }
    }

    run()
    const t = setInterval(run, CHECK_INTERVAL)
    return () => { cancelled = true; clearInterval(t) }
  }, [student?.id, fbReady, activities, quizzes, classes, semester])
}
