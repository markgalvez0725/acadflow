// ── Firestore real-time listeners ─────────────────────────────────────────
// This module owns the _fbWriting flag so it can suppress onSnapshot echoes
// during in-flight writes. It never imports React.
import {
  collection, doc, onSnapshot, getDoc, getDocs, setDoc,
} from 'firebase/firestore'
import { deserializeStudents } from '@/utils/attendance'
import { decryptEJS, encryptEJS } from '@/utils/crypto'

// Module-level write-in-flight flag — intentionally NOT React state so it
// doesn't trigger re-renders and is not reset by the rendering cycle.
let _fbWriting = false;
export function setFbWriting(val) { _fbWriting = val; }

let _unsub = [];

/**
 * Attach all real-time Firestore listeners.
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {{
 *   onStudentsUpdate: (students: any[]) => void,
 *   onClassesUpdate:  (classes: any[])  => void,
 *   onConfigUpdate:   (data: object)    => void,
 *   onSettingsUpdate: (data: object)    => void,
 *   onMessagesUpdate: (msgs: any[])     => void,
 *   onActivitiesUpdate: (acts: any[])   => void,
 *   onAdminNotifUpdate: (notifs: any[]) => void,
 * }} callbacks
 */
export function fbStartListening(db, callbacks) {
  const {
    onStudentsUpdate,
    onClassesUpdate,
    onConfigUpdate,
    onSettingsUpdate,
    onMessagesUpdate,
    onActivitiesUpdate,
    onAdminNotifUpdate,
  } = callbacks;

  // Stop any previous listeners
  stopListening();

  console.log('[Firebase] 👂 Starting real-time listeners...');

  // ── portal/config (EJS credentials) ──────────────────────────────────
  const u0 = onSnapshot(
    doc(db, 'portal', 'config'),
    async snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      let ejsConfig = null;

      if (data?.ejs_enc) {
        ejsConfig = await decryptEJS(data.ejs_enc);
        if (ejsConfig) {
          const enc = await encryptEJS(ejsConfig);
          if (enc) try { localStorage.setItem('cp_ejs', enc); } catch (e) {}
        }
      }
      if (!ejsConfig && data?.ejs?.publicKey) {
        ejsConfig = data.ejs;
        const enc = await encryptEJS(ejsConfig);
        if (enc) try { localStorage.setItem('cp_ejs', enc); } catch (e) {}
      }
      onConfigUpdate({ ejsConfig, raw: data });
    },
    e => console.error('[Firebase] config listener error:', e.message)
  );
  _unsub.push(u0);

  // Eager config fetch so EJS is available immediately
  _eagerConfigFetch(db, onConfigUpdate);

  // ── portal/classes ────────────────────────────────────────────────────
  const u1 = onSnapshot(
    doc(db, 'portal', 'classes'),
    snap => {
      if (!snap.exists()) return;
      const data = snap.data()?.list;
      if (!Array.isArray(data)) return;
      onClassesUpdate(data);
    },
    e => console.error('[Firebase] classes listener error:', e.message)
  );
  _unsub.push(u1);

  // ── students collection ───────────────────────────────────────────────
  const u2 = onSnapshot(
    collection(db, 'students'),
    snap => {
      if (_fbWriting) {
        console.log('[Firebase] ⏸ onSnapshot skipped — local write in progress.');
        return;
      }
      const incoming = [];
      snap.forEach(d => incoming.push(d.data()));
      const deserialized = deserializeStudents(incoming);
      onStudentsUpdate(deserialized);
    },
    e => console.error('[Firebase] students listener error:', e.message)
  );
  _unsub.push(u2);

  // ── messages collection ───────────────────────────────────────────────
  const u3 = onSnapshot(
    collection(db, 'messages'),
    snap => {
      const msgs = [];
      snap.forEach(d => msgs.push(d.data()));
      onMessagesUpdate(msgs);
    },
    e => console.error('[Firebase] messages listener error:', e.message)
  );
  _unsub.push(u3);

  // ── activities collection ─────────────────────────────────────────────
  const u4 = onSnapshot(
    collection(db, 'activities'),
    snap => {
      const acts = [];
      snap.forEach(d => acts.push(d.data()));
      onActivitiesUpdate(acts);
    },
    e => console.error('[Firebase] activities listener error:', e.message)
  );
  _unsub.push(u4);

  // ── notifications collection ──────────────────────────────────────────
  const u6 = onSnapshot(
    collection(db, 'notifications'),
    snap => {
      const notifs = [];
      snap.forEach(d => notifs.push({ id: d.id, ...d.data() }));
      onAdminNotifUpdate(notifs);
    },
    e => console.error('[Firebase] notifications listener error:', e.message)
  );
  _unsub.push(u6);

  // ── portal/settings (equiv scale, grade weights) ──────────────────────
  let _settingsWriteInFlight = false;
  const u5 = onSnapshot(
    doc(db, 'portal', 'settings'),
    snap => {
      if (_settingsWriteInFlight) { _settingsWriteInFlight = false; return; }
      if (!snap.exists()) return;
      onSettingsUpdate(snap.data());
    },
    e => console.error('[Firebase] settings listener error:', e.message)
  );
  _unsub.push(u5);

  // Expose write-in-flight setter for settings saves
  window._settingsWriteInFlight = () => {
    _settingsWriteInFlight = true;
    setTimeout(() => { _settingsWriteInFlight = false; }, 3000);
  };

  console.log('[Firebase] ✅ All listeners active.');

  // Eager fetch — populate all collections immediately without waiting for
  // onSnapshot warm-up. Each fetch is fire-and-forget; listeners stay live.
  _eagerFetchAll(db, { onStudentsUpdate, onClassesUpdate, onMessagesUpdate, onActivitiesUpdate, onAdminNotifUpdate, onSettingsUpdate });
}

export function stopListening() {
  _unsub.forEach(u => { try { u(); } catch (e) {} });
  _unsub = [];
}

// ── Admin notification listener (called separately after auth) ────────────
export function startAdminNotifListener(db, onAdminNotifUpdate) {
  const u = onSnapshot(
    collection(db, 'notifications'),
    snap => {
      const notifs = [];
      snap.forEach(d => notifs.push({ id: d.id, ...d.data() }));
      onAdminNotifUpdate(notifs);
    },
    e => console.error('[Firebase] admin notif listener error:', e.message)
  );
  _unsub.push(u);
}

// ── Eager fetch for all collections on connect ────────────────────────────
async function _eagerFetchAll(db, { onStudentsUpdate, onClassesUpdate, onMessagesUpdate, onActivitiesUpdate, onAdminNotifUpdate, onSettingsUpdate }) {
  try {
    const [studentsSnap, classesSnap, messagesSnap, activitiesSnap, notifsSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db, 'students')),
      getDoc(doc(db, 'portal', 'classes')),
      getDocs(collection(db, 'messages')),
      getDocs(collection(db, 'activities')),
      getDocs(collection(db, 'notifications')),
      getDoc(doc(db, 'portal', 'settings')),
    ]);

    const students = [];
    studentsSnap.forEach(d => students.push(d.data()));
    if (students.length) onStudentsUpdate(deserializeStudents(students));

    if (classesSnap.exists()) {
      const list = classesSnap.data()?.list;
      if (Array.isArray(list)) onClassesUpdate(list);
    }

    const messages = [];
    messagesSnap.forEach(d => messages.push(d.data()));
    onMessagesUpdate(messages);

    const activities = [];
    activitiesSnap.forEach(d => activities.push(d.data()));
    onActivitiesUpdate(activities);

    const notifs = [];
    notifsSnap.forEach(d => notifs.push({ id: d.id, ...d.data() }));
    onAdminNotifUpdate(notifs);

    if (settingsSnap.exists()) onSettingsUpdate(settingsSnap.data());

    console.log('[Firebase] ✅ Eager fetch complete.');
  } catch (e) {
    console.warn('[Firebase] Eager fetch failed (listeners will still deliver data):', e.message);
  }
}

// ── Eager config fetch (retries on SDK warm-up errors) ───────────────────
async function _eagerConfigFetch(db, onConfigUpdate, attempt = 1) {
  try {
    const snap = await getDoc(doc(db, 'portal', 'config'));
    if (!snap.exists()) return;
    const d = snap.data();
    let ejsConfig = null;
    if (d?.ejs_enc) {
      ejsConfig = await decryptEJS(d.ejs_enc);
      if (ejsConfig) {
        const enc = await encryptEJS(ejsConfig);
        if (enc) try { localStorage.setItem('cp_ejs', enc); } catch (e) {}
      }
    }
    if (!ejsConfig && d?.ejs?.publicKey) {
      ejsConfig = d.ejs;
    }
    onConfigUpdate({ ejsConfig, raw: d });
  } catch (e) {
    const warmup = ['shutting down', 'terminated', 'offline', 'unavailable', 'UNAVAILABLE']
      .some(s => (e.message || '').includes(s));
    if (warmup && attempt < 6) {
      setTimeout(() => _eagerConfigFetch(db, onConfigUpdate, attempt + 1), attempt * 1000);
    }
  }
}
