// Append an in-app notification to a single student's feed (notifications/{id}).
// Centralized so the admin grade/activity flows that notify students all write
// the SAME shape (newest-first, capped at 200) instead of keeping copies that
// could drift. Best-effort: a failed write never blocks the grading action.
//
// Mirrors the `notifications/{userId}.items` model described in the project docs
// (see also fbPush*/fbNotify* in persistence.js). Pass the Firestore `db`.
export async function pushStudentNotif(db, studentId, title, body, type = 'act_grade', link = 'grades') {
  try {
    const { getDoc, setDoc, doc: fbDoc } = await import('firebase/firestore')
    const ref = fbDoc(db, 'notifications', studentId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
      type, read: false, ts: Date.now(), title, body, link,
    }
    await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}
