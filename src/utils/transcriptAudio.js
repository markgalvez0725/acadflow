// ── IndexedDB home for transcript audio ─────────────────────────────────────
// While a class is being recorded, transcriptRecorder.js hands over
// self-contained ~5 minute Opus segments; they are persisted HERE (plus the
// speaker timeline) so a crashed tab never loses the class audio. Everything
// is local to the professor's browser only, keyed by meeting id, and deleted
// after a transcript is generated.

const DB_NAME = 'acadflow_transcript_audio'
const DB_VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments', { keyPath: ['meetingId', 'index'] })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'meetingId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, store, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const out = run(t.objectStore(store))
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function saveSegment(meetingId, index, blob, startedAt) {
  const db = await openDb()
  try {
    await tx(db, 'segments', 'readwrite', s => s.put({ meetingId, index, blob, startedAt, savedAt: Date.now() }))
  } finally { db.close() }
}

export async function saveMeta(meetingId, meta) {
  const db = await openDb()
  try {
    await tx(db, 'meta', 'readwrite', s => s.put({ meetingId, ...meta, savedAt: Date.now() }))
  } finally { db.close() }
}

// Everything captured for one class: segments in order + the speaker timeline.
export async function loadSession(meetingId) {
  const db = await openDb()
  try {
    const segments = await new Promise((resolve, reject) => {
      const t = db.transaction('segments', 'readonly')
      const req = t.objectStore('segments').getAll(IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity]))
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    const meta = await new Promise((resolve, reject) => {
      const t = db.transaction('meta', 'readonly')
      const req = t.objectStore('meta').get(meetingId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    segments.sort((a, b) => a.index - b.index)
    return { segments, meta }
  } finally { db.close() }
}

// Which meetings still have local audio waiting to be transcribed (the
// professor tab uses this to decide which ended rows get the button).
export async function listSessionIds() {
  const db = await openDb()
  try {
    const rows = await new Promise((resolve, reject) => {
      const t = db.transaction('segments', 'readonly')
      const req = t.objectStore('segments').getAllKeys()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return [...new Set(rows.map(k => k[0]))]
  } finally { db.close() }
}

export async function clearSession(meetingId) {
  const db = await openDb()
  try {
    await tx(db, 'segments', 'readwrite', s => s.delete(IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity])))
    await tx(db, 'meta', 'readwrite', s => s.delete(meetingId))
  } finally { db.close() }
}
