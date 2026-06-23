// ── Firestore persistence helpers ─────────────────────────────────────────
import { doc, setDoc, deleteDoc, arrayUnion, runTransaction } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import { fbWithTimeout } from './firebaseInit'
import { serializeStudents } from '@/utils/attendance'
import { setFbWriting } from './listeners'

const BATCH = 10;

// ── Data cleaning ─────────────────────────────────────────────────────────
export function fsCleanStudents(studentArr) {
  const arr = Array.isArray(studentArr) ? studentArr : [studentArr];
  const serialized = serializeStudents(arr);
  return JSON.parse(JSON.stringify(serialized));
}

export function fsCleanClasses(classes) {
  return JSON.parse(JSON.stringify(classes));
}

// ── Student writes ────────────────────────────────────────────────────────
export async function fbSaveStudent(db, s) {
  if (!db || !s?.id) return;
  const clean = fsCleanStudents([s])[0];
  await fbWithTimeout(setDoc(doc(db, 'students', clean.id), clean));
}

export async function fbDeleteStudent(db, id) {
  if (!db || !id) return;
  try {
    await deleteDoc(doc(db, 'students', id));
  } catch (e) {
    console.warn('[FB] delete student:', e.message);
  }
}

// ── Batch student sync ────────────────────────────────────────────────────
export async function persistStudentsSync(db, students, changedStudentIds) {
  if (!db) return;
  setFbWriting(true);
  try {
    const toSave = changedStudentIds?.length
      ? changedStudentIds.map(id => students.find(x => x.id === id)).filter(Boolean)
      : students;

    for (let i = 0; i < toSave.length; i += BATCH) {
      await Promise.all(toSave.slice(i, i + BATCH).map(s => fbSaveStudent(db, s)));
    }
  } catch (e) {
    console.warn('[FB] persistStudentsSync:', e.message);
  } finally {
    setTimeout(() => setFbWriting(false), 1500);
  }
}

// ── Class sync ────────────────────────────────────────────────────────────
export async function persistClassesSync(db, classes) {
  if (!db) return;
  try {
    const clean = fsCleanClasses(classes);
    await fbWithTimeout(setDoc(doc(db, 'portal', 'classes'), { list: clean }));
  } catch (e) {
    console.warn('[FB] persistClassesSync:', e.message);
  }
}

// ── Subject representative ────────────────────────────────────────────────
// Persists the already-updated classes list (computed by DataContext).
// studentId = null clears the rep.
export async function fbSetSubjectRep(db, classes) {
  if (!db) return;
  await persistClassesSync(db, classes);
}

// ── Admin credentials ─────────────────────────────────────────────────────
// SECURITY: Admin encryption key must come from environment, never hardcoded.
const ADMIN_KEY = import.meta.env.VITE_ADMIN_CRYPTO_KEY || _throwAdminKeyMissing()

function _throwAdminKeyMissing() {
  throw new Error('SECURITY: VITE_ADMIN_CRYPTO_KEY is required but not set. Add it to .env.local (minimum 16 characters). Never commit to git.')
}

async function _getAdminCryptoKey(mode) {
  if (!ADMIN_KEY || ADMIN_KEY.length < 16) {
    throw new Error('SECURITY: Invalid VITE_ADMIN_CRYPTO_KEY — must be at least 16 characters.')
  }
  const keyData = new TextEncoder().encode(ADMIN_KEY.padEnd(32, '_').slice(0, 32))
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [mode])
}

export async function encryptAdmin(obj) {
  try {
    const key = await _getAdminCryptoKey('encrypt');
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    const combined = new Uint8Array(iv.length + enc.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(enc), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch (e) { return null; }
}

export async function decryptAdmin(blob) {
  try {
    const key   = await _getAdminCryptoKey('decrypt');
    const bytes = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
    const dec   = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)
    );
    return JSON.parse(new TextDecoder().decode(dec));
  } catch (e) { return null; }
}

export async function loadAdminFromStorage() {
  try {
    const enc = localStorage.getItem('cp_admin_enc');
    if (enc) {
      const dec = await decryptAdmin(enc);
      if (dec?.pass) return dec;
    }
    // Legacy plain-text migration
    const plain = localStorage.getItem('cp_admin');
    if (plain) {
      const parsed = JSON.parse(plain);
      if (parsed?.pass) {
        const newEnc = await encryptAdmin(parsed);
        if (newEnc) localStorage.setItem('cp_admin_enc', newEnc);
        localStorage.removeItem('cp_admin');
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

// ── Announcement writes ────────────────────────────────────────────────────
export async function fbSaveAnnouncement(db, announcement) {
  const { doc: fbDoc, setDoc } = await import('firebase/firestore')
  return fbWithTimeout(setDoc(fbDoc(db, 'announcements', announcement.id), announcement))
}

export async function fbDeleteAnnouncement(db, id) {
  const { doc: fbDoc, deleteDoc } = await import('firebase/firestore')
  return fbWithTimeout(deleteDoc(fbDoc(db, 'announcements', id)))
}

// ── Resource Hub writes (per class + subject learning materials) ─────────────
export async function fbSaveResource(db, resource) {
  const { doc: fbDoc, setDoc } = await import('firebase/firestore')
  return fbWithTimeout(setDoc(fbDoc(db, 'resources', resource.id), resource))
}

export async function fbDeleteResource(db, id) {
  const { doc: fbDoc, deleteDoc } = await import('firebase/firestore')
  return fbWithTimeout(deleteDoc(fbDoc(db, 'resources', id)))
}

// ── Message delete (teacher-side hard delete of a message document) ───────────
// Removes the whole message doc (and its nested replies). Used by the admin
// Messages tab. Student-side "delete" hides locally instead — students must not
// destroy shared/announcement docs for everyone.
export async function fbDeleteMessage(db, id) {
  const { doc: fbDoc, deleteDoc } = await import('firebase/firestore')
  return fbWithTimeout(deleteDoc(fbDoc(db, 'messages', id)))
}

export async function fbAddAnnouncementComment(db, announcementId, comment) {
  if (!db || !announcementId || !comment) return
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'announcements', announcementId)
  
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Announcement not found')
    const ann = snap.data()
    const comments = Array.isArray(ann.comments) ? ann.comments : []
    transaction.update(ref, { comments: [...comments, comment] })
  }))
}

export async function fbAddCommentReply(db, announcementId, commentId, reply) {
  if (!db || !announcementId || !commentId || !reply) return
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'announcements', announcementId)
  
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Announcement not found')
    const ann = snap.data()
    const comments = Array.isArray(ann.comments) ? ann.comments : []
    const updated = comments.map(c =>
      c.id === commentId
        ? { ...c, replies: [...(c.replies || []), reply] }
        : c
    )
    transaction.update(ref, { comments: updated })
  }))
}

// Atomically append a reply to a message thread. Reading the current replies
// inside a transaction prevents the lost-update race where teacher and student
// reply near-simultaneously and one reply silently overwrites the other.
export async function fbAddMessageReply(db, msgId, reply, opts = {}) {
  if (!db || !msgId || !reply) return
  const ref = doc(db, 'messages', msgId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Message not found')
    const m = snap.data()
    const replies = Array.isArray(m.replies) ? m.replies : []
    const patch = { replies: [...replies, reply] }
    if (opts.adminRead !== undefined) patch.adminRead = opts.adminRead
    if (opts.readerId) {
      const read = Array.isArray(m.read) ? m.read : []
      if (!read.includes(opts.readerId)) patch.read = [...read, opts.readerId]
    }
    transaction.update(ref, patch)
  }))
}

// Atomically mark a message read for one reader without clobbering other
// readers' entries (important for broadcast messages shared by many students).
export async function fbMarkMessageRead(db, msgId, readerId, readAtTs) {
  if (!db || !msgId || !readerId) return
  const ref = doc(db, 'messages', msgId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) return
    const m = snap.data()
    const read = Array.isArray(m.read) ? m.read : []
    const readAt = (m.readAt && typeof m.readAt === 'object') ? m.readAt : {}
    const patch = { readAt: { ...readAt, [readerId]: readAtTs || Date.now() } }
    if (!read.includes(readerId)) patch.read = [...read, readerId]
    transaction.update(ref, patch)
  }))
}

export async function fbPushAnnouncementNotifs(db, announcement, students) {
  if (!db || !announcement || !students?.length) return
  const enrolled = announcement.classId === 'all'
    ? students
    : students.filter(s => {
        const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
        return ids.includes(announcement.classId)
      })
  if (!enrolled.length) return
  const { doc: fbDoc, getDoc, setDoc } = await import('firebase/firestore')
  for (let i = 0; i < enrolled.length; i += BATCH) {
    await Promise.all(enrolled.slice(i, i + BATCH).map(async s => {
      try {
        const ref = fbDoc(db, 'notifications', s.id)
        const snap = await getDoc(ref)
        const existing = snap.exists() ? (snap.data().items || []) : []
        const notif = {
          id: `n_${uuidv4()}`,
          type: 'announce',
          read: false,
          ts: Date.now(),
          title: announcement.title,
          body: announcement.message || '',
          link: 'overview',
        }
        await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
      } catch (e) {}
    }))
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────
// Append-only record of significant admin actions (grade edits, deletions,
// regrade decisions). Each entry is its own document so writes never contend.
// Fire-and-forget: an audit-write failure must never block the primary action.
export async function fbAddAuditLog(db, entry) {
  if (!db || !entry) return
  const id = `audit_${Date.now()}_${uuidv4().slice(0, 8)}`
  const record = {
    id,
    ts: Date.now(),
    actor: entry.actor || 'admin',
    action: entry.action || 'unknown',      // e.g. 'grade.edit', 'activity.delete'
    target: entry.target || '',              // human-readable subject of the action
    summary: entry.summary || '',            // one-line description
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
  }
  try {
    await fbWithTimeout(setDoc(doc(db, 'auditLog', id), record))
  } catch (e) {
    console.warn('[FB] fbAddAuditLog:', e.message)
  }
  return record
}

export async function persistAdmin(db, admin) {
  const payload = { user: admin.user, pass: admin.pass, email: admin.email };
  if (admin.resetPin) payload.resetPin = admin.resetPin;

  // 1. Write localStorage immediately — this is what the UI depends on
  try {
    const enc = await encryptAdmin(payload);
    if (enc) localStorage.setItem('cp_admin_enc', enc);
    localStorage.removeItem('cp_admin');
  } catch (e) {}

  // 2. Sync to Firebase in the background — non-blocking
  if (db) {
    fbWithTimeout(setDoc(doc(db, 'portal', 'admin'), payload), 20000)
      .then(() => console.log('[FB] persistAdmin synced to Firebase'))
      .catch(e => console.warn('[FB] persistAdmin Firebase sync failed:', e.message));
  }
}

// ── Online Meetings ────────────────────────────────────────────────────────

/**
 * Save a Google Meet link to a class document inside portal/classes.
 * Classes are stored as portal/classes.list (array), so we read-modify-write.
 */
export async function fbSaveMeetLink(db, classId, meetLink) {
  if (!db || !classId) return;
  const { doc: fbDoc, getDoc, setDoc } = await import('firebase/firestore');
  const ref = fbDoc(db, 'portal', 'classes');
  const snap = await fbWithTimeout(getDoc(ref));
  if (!snap.exists()) return;
  const list = snap.data()?.list || [];
  const updated = list.map(c => c.id === classId ? { ...c, meetLink } : c);
  await fbWithTimeout(setDoc(ref, { list: updated }));
}

export async function fbScheduleMeeting(db, meetingData) {
  if (!db) return;
  const { doc: fbDoc, setDoc } = await import('firebase/firestore');
  const id = uuidv4();
  const meeting = {
    id,
    classId: meetingData.classId,
    className: meetingData.className,
    title: meetingData.title,
    description: meetingData.description || '',
    meetLink: meetingData.meetLink || '',
    scheduledAt: meetingData.scheduledAt, // JS timestamp (ms)
    status: 'scheduled',
    createdAt: Date.now(),
    endedAt: null,
  };
  await fbWithTimeout(setDoc(fbDoc(db, 'onlineMeetings', id), meeting));
  return meeting;
}

export async function fbStartMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, updateDoc } = await import('firebase/firestore');
  await fbWithTimeout(updateDoc(fbDoc(db, 'onlineMeetings', meetingId), {
    status: 'live',
  }));
}

export async function fbEndMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, updateDoc } = await import('firebase/firestore');
  await fbWithTimeout(updateDoc(fbDoc(db, 'onlineMeetings', meetingId), {
    status: 'ended',
    endedAt: Date.now(),
  }));
}

export async function fbCancelMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, deleteDoc } = await import('firebase/firestore');
  await fbWithTimeout(deleteDoc(fbDoc(db, 'onlineMeetings', meetingId)));
}

// ── Delete all data related to a class (called on permanent class deletion) ──
// Removes activities, announcements, online meetings, and quizzes that belong
// to the given classId from Firestore using batched deletes.
export async function fbDeleteClassRelatedData(db, classId) {
  if (!db || !classId) return;
  const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore');

  const [actsSnap, annsSnap, meetingsSnap, quizzesSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'),    where('classId',  '==',            classId))),
    getDocs(query(collection(db, 'announcements'), where('classId',  '==',            classId))),
    getDocs(query(collection(db, 'onlineMeetings'),where('classId',  '==',            classId))),
    getDocs(query(collection(db, 'quizzes'),       where('classIds', 'array-contains', classId))),
  ]);

  const allDocs = [
    ...actsSnap.docs,
    ...annsSnap.docs,
    ...meetingsSnap.docs,
    ...quizzesSnap.docs,
  ];

  if (!allDocs.length) return;

  // Firestore batch limit is 500 writes
  for (let i = 0; i < allDocs.length; i += 500) {
    const batch = writeBatch(db);
    allDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function fbPushMeetingNotifs(db, meeting, students, type) {
  if (!db || !meeting || !students?.length) return;
  const enrolled = students.filter(s => {
    const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []);
    return ids.includes(meeting.classId);
  });
  if (!enrolled.length) return;

  const { doc: fbDoc, getDoc, setDoc } = await import('firebase/firestore');

  const messages = {
    meeting_scheduled: `${meeting.className}: Online class scheduled for ${new Date(meeting.scheduledAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} at ${new Date(meeting.scheduledAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`,
    meeting_live: `${meeting.className} is LIVE now! Join the meeting.`,
    meeting_cancelled: `${meeting.className}: Scheduled online class on ${new Date(meeting.scheduledAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} has been cancelled.`,
    meeting_ended: `${meeting.className}: Online class session has ended.`,
  };

  const notif = {
    id: `n_${uuidv4()}`,
    type,
    read: false,
    ts: Date.now(),
    title: messages[type] || `${meeting.className}: Meeting update`,
    body: meeting.title,
    link: 'onlineClasses',
    meetingId: meeting.id,
    meetLink: meeting.meetLink || null,
    classId: meeting.classId,
    className: meeting.className,
    scheduledAt: meeting.scheduledAt || null,
  };

  for (let i = 0; i < enrolled.length; i += BATCH) {
    await Promise.all(enrolled.slice(i, i + BATCH).map(async s => {
      try {
        const ref = fbDoc(db, 'notifications', s.id);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? (snap.data().items || []) : [];
        await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false });
      } catch (e) {
        console.warn('[FB] fbPushMeetingNotifs student:', s.id, e.message);
      }
    }));
  }
}

// ── Full backup restore ────────────────────────────────────────────────────
// Writes a backup object (produced by DataContext.buildBackup) back to
// Firestore. Restores durable academic data only — students, classes,
// messages, activities, quizzes, announcements, online meetings, attendance
// sessions, excuse requests and settings. Transient/derived collections
// (notifications, auditLog) are intentionally NOT written back. Existing docs
// with matching ids are overwritten; docs not present in the backup are left
// untouched (this is a restore, not a wipe). onProgress(label, count) reports
// progress per section.
export async function fbRestoreFromBackup(db, backup, onProgress = () => {}) {
  if (!db) throw new Error('Firebase not connected');
  const d = backup?.data;
  if (!d || typeof d !== 'object') throw new Error('Backup file has no data.');

  const clone = obj => JSON.parse(JSON.stringify(obj));

  // Per-doc collections keyed by an `id` field.
  const writeColl = async (name, items) => {
    const arr = Array.isArray(items) ? items.filter(x => x && x.id != null) : [];
    for (let i = 0; i < arr.length; i += BATCH) {
      await Promise.all(arr.slice(i, i + BATCH).map(it =>
        fbWithTimeout(setDoc(doc(db, name, String(it.id)), clone(it)))
      ));
    }
    onProgress(name, arr.length);
  };

  await writeColl('students', d.students);

  if (Array.isArray(d.classes)) {
    await fbWithTimeout(setDoc(doc(db, 'portal', 'classes'), { list: clone(d.classes) }));
    onProgress('classes', d.classes.length);
  }

  await writeColl('messages', d.messages);
  await writeColl('activities', d.activities);
  await writeColl('quizzes', d.quizzes);
  await writeColl('announcements', d.announcements);
  await writeColl('onlineMeetings', d.meetings);
  await writeColl('attendanceSessions', d.attendanceSessions);
  await writeColl('excuseRequests', d.excuseRequests);

  if (d.settings && typeof d.settings === 'object') {
    const s = {};
    if (Array.isArray(d.settings.equivScale)) s.equivScale = d.settings.equivScale;
    if (d.settings.semester) s.semester = d.settings.semester;
    if (d.settings.latePolicy) s.latePolicy = d.settings.latePolicy;
    if (Object.keys(s).length) {
      await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), s, { merge: true }));
      onProgress('settings', 1);
    }
  }
}
