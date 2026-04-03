// ── Firestore persistence helpers ─────────────────────────────────────────
import { doc, setDoc, deleteDoc, arrayUnion, runTransaction } from 'firebase/firestore'
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

// ── Admin credentials ─────────────────────────────────────────────────────
const ADMIN_KEY = 'acadflow_admin_2025';

async function _getAdminCryptoKey(mode) {
  const keyData = new TextEncoder().encode(ADMIN_KEY.padEnd(32, '_').slice(0, 32));
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [mode]);
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
          id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
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
