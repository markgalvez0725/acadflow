// ── Portal settings - Firebase-primary (equiv scale, grade weights) ───────
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'
import { DEFAULT_EQ_SCALE } from '@/utils/grades'
import { encryptEJS } from '@/utils/crypto'

export async function syncSettingsFromFirebase(db) {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'portal', 'settings'));
    if (!snap.exists()) return null;
    const d = snap.data();
    const result = {};
    if (Array.isArray(d?.equivScale) && d.equivScale.length === DEFAULT_EQ_SCALE.length) {
      result.equivScale = d.equivScale;
    }
    if (d?.eqUserDefault) {
      try { localStorage.setItem('cp_eq_user_default', JSON.stringify(d.eqUserDefault)); } catch (e) {}
    }
    if (d?.semester) result.semester = d.semester;
    if (d?.latePolicy && typeof d.latePolicy === 'object') result.latePolicy = d.latePolicy;
    if (typeof d?.gradeFloor === 'number') result.gradeFloor = d.gradeFloor;
    if (d?.branding && typeof d.branding === 'object') result.branding = d.branding;
    return result;
  } catch (e) {
    if (!e.message?.includes('offline')) console.warn('[Firebase] Settings sync failed:', e.message);
    return null;
  }
}

export async function saveSemesterToFirebase(db, semester) {
  if (!db) return;
  await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), { semester }, { merge: true }));
}

export async function saveLatePolicyToFirebase(db, latePolicy) {
  if (!db) return;
  await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), { latePolicy }, { merge: true }));
}

export async function saveGradeFloorToFirebase(db, gradeFloor) {
  if (!db) return;
  await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), { gradeFloor }, { merge: true }));
}

// Branding for report exports: { schoolName, department, address, logo } where
// `logo` is a base64 PNG/JPG data URL (kept well under Firestore's 1 MB doc cap).
export async function saveBrandingToFirebase(db, branding) {
  if (!db) return;
  await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), { branding: branding || null }, { merge: true }));
}

export async function saveSettingsToFirebase(db, equivScale) {
  if (!db) return;
  const eqUserDefault = (() => {
    try { const r = localStorage.getItem('cp_eq_user_default'); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  })();
  await fbWithTimeout(setDoc(doc(db, 'portal', 'settings'), {
    equivScale,
    eqUserDefault,
  }, { merge: true }));
}

export async function syncAdminFromFirebase(db) {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'portal', 'admin'));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d?.pass) return { user: d.user || 'admin', pass: d.pass, email: d.email || '', resetPin: d.resetPin || null, name: d.name || '', photo: d.photo || null };
    return null;
  } catch (e) {
    if (!e.message?.includes('offline')) console.warn('[Firebase] Admin sync failed:', e.message);
    return null;
  }
}

export async function saveEjsToFirebase(db, ejsConfig) {
  if (!db || !ejsConfig) return;
  const ejs_enc = await encryptEJS(ejsConfig);
  if (!ejs_enc) throw new Error('Failed to encrypt EJS config');

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fbWithTimeout(
        setDoc(doc(db, 'portal', 'config'), { ejs_enc }, { merge: true }),
        20000 + (attempt - 1) * 10000 // 20s, 30s, 40s
      );
      console.log('[Firebase] EJS config synced to Firebase');
      return;
    } catch (e) {
      lastError = e;
      console.warn(`[Firebase] saveEjsToFirebase attempt ${attempt}/3 failed:`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  throw lastError;
}
