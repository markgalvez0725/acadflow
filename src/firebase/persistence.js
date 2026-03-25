// ── Firestore persistence helpers ─────────────────────────────────────────
import { doc, setDoc, deleteDoc } from 'firebase/firestore'
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
