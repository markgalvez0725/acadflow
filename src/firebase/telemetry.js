// ── Firestore access for device telemetry ─────────────────────────────────
// One doc per device per day in `telemetry/{deviceId}-{day}`. Devices write
// their own doc (whole-doc replace: the client-side accumulator is the truth
// for that device's day); only the professor reads the collection back for
// the System reports tab. Writes are deliberately NOT wrapped in fbWithTimeout:
// they fire during pagehide/visibility flushes where nothing awaits them, and
// a timeout rejection would just be noise.

import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'

export async function fbSaveTelemetry(db, docId, data) {
  if (!db || !docId || !data) return
  await setDoc(doc(db, 'telemetry', docId), data)
}

/** Admin-side one-shot fetch of every device-day doc since `sinceDay`
 *  (YYYYMMDD string). Returns plain row objects, newest day last. */
export async function fbFetchTelemetry(db, sinceDay) {
  if (!db) return []
  const q = query(collection(db, 'telemetry'), where('day', '>=', String(sinceDay)))
  const snap = await getDocs(q)
  const rows = []
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
  rows.sort((a, b) => String(a.day).localeCompare(String(b.day)))
  return rows
}
