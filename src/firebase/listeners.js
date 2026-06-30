// ── Firestore real-time listeners ─────────────────────────────────────────
// This module owns the _fbWriting flag so it can suppress onSnapshot echoes
// during in-flight writes. It never imports React.
import {
  collection, doc, onSnapshot, getDoc, query, where, orderBy, limit,
} from 'firebase/firestore'
import { deserializeStudents } from '@/utils/attendance'
import { decryptEJS, encryptEJS } from '@/utils/crypto'

// Module-level write-in-flight depth counter - intentionally NOT React state so
// it doesn't trigger re-renders and is not reset by the rendering cycle. Using a
// counter (not a boolean) means two overlapping writes can't clear each other's
// suppression window early: each write increments on start and decrements after
// its own settle delay, so echoes stay suppressed until the LAST write drains.
let _fbWriting = 0;
export function setFbWriting(val) {
  if (val) _fbWriting++;
  else _fbWriting = Math.max(0, _fbWriting - 1);
}

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
 *   onQuizzesUpdate: (quizzes: any[])   => void,
 *   onAnnouncementsUpdate: (anns: any[]) => void,
 *   onMeetingsUpdate: (meetings: any[]) => void,
 * }} callbacks
 */
export function fbStartListening(db, callbacks, opts = {}) {
  // Role/identity scoping. Defaults keep the broad (admin) behavior if a caller
  // omits opts. For a student we attach per-user listeners (their own feedback /
  // excuse requests) instead of whole collections, and skip the admin-only
  // notifications feed entirely.
  const { isAdmin = true, studentId = null } = opts;
  const {
    onStudentsUpdate,
    onClassesUpdate,
    onConfigUpdate,
    onSettingsUpdate,
    onMessagesUpdate,
    onActivitiesUpdate,
    onAdminNotifUpdate,
    onQuizzesUpdate,
    onAnnouncementsUpdate,
    onMeetingsUpdate,
    onAttendanceSessionsUpdate,
    onExcuseRequestsUpdate,
    onStudentFeedbackUpdate,
    onAuditLogUpdate,
    onRubricLibraryUpdate,
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
        console.log('[Firebase] ⏸ onSnapshot skipped - local write in progress.');
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
  // Students load the whole collection (filtered to their own threads client-
  // side - a per-user server query isn't possible without a participants[] array
  // on each thread). The ADMIN instead uses a paginated, recency-ordered listener
  // managed separately by DataContext (subscribeAdminMessages), so the professor's
  // initial load is the most-recently-active threads, not the entire history.
  if (!isAdmin) {
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
  }

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

  // ── notifications/admin doc (admin feed only) ─────────────────────────
  // This is the PROFESSOR's notification feed. Students read their own
  // notifications/{studentId} doc directly in StudentLayout, so they don't need
  // this at all. Listen to the single 'admin' doc instead of scanning the whole
  // notifications collection (which held every user's feed) to find one doc.
  if (onAdminNotifUpdate) {
    const u6 = onSnapshot(
      doc(db, 'notifications', 'admin'),
      snap => onAdminNotifUpdate(snap.exists() ? (snap.data().items || []) : []),
      e => console.error('[Firebase] notifications listener error:', e.message)
    );
    _unsub.push(u6);
  }

  // ── quizzes collection ────────────────────────────────────────────────
  if (onQuizzesUpdate) {
    const u7 = onSnapshot(
      collection(db, 'quizzes'),
      snap => {
        const quizzes = [];
        snap.forEach(d => quizzes.push(d.data()));
        onQuizzesUpdate(quizzes);
      },
      e => console.error('[Firebase] quizzes listener error:', e.message)
    );
    _unsub.push(u7);
  }

  // ── announcements collection ──────────────────────────────────────────
  if (onAnnouncementsUpdate) {
    const u8 = onSnapshot(
      collection(db, 'announcements'),
      snap => {
        const anns = [];
        snap.forEach(d => anns.push(d.data()));
        onAnnouncementsUpdate(anns);
      },
      e => console.error('[Firebase] announcements listener error:', e.message)
    );
    _unsub.push(u8);
  }

  // ── onlineMeetings collection ─────────────────────────────────────────
  if (onMeetingsUpdate) {
    const u9 = onSnapshot(
      collection(db, 'onlineMeetings'),
      snap => {
        const meetings = [];
        snap.forEach(d => meetings.push(d.data()));
        onMeetingsUpdate(meetings);
      },
      e => console.error('[Firebase] onlineMeetings listener error:', e.message)
    );
    _unsub.push(u9);
  }

  // ── attendanceSessions collection (live check-in) ─────────────────────
  // Scoped to OPEN sessions only. Every consumer (student + admin AttendanceTab,
  // StudentLayout check-in prompt) filters to `status === 'open'`; closed-session
  // history lives on the student docs (_att Sets), never here. Without this the
  // listener streamed every session ever created (classes x school-days = the
  // most unbounded collection in the app). When a session closes, its status flips
  // and it drops out of the result automatically.
  if (onAttendanceSessionsUpdate) {
    const uA = onSnapshot(
      query(collection(db, 'attendanceSessions'), where('status', '==', 'open')),
      snap => {
        const sessions = [];
        snap.forEach(d => sessions.push(d.data()));
        onAttendanceSessionsUpdate(sessions);
      },
      e => console.error('[Firebase] attendanceSessions listener error:', e.message)
    );
    _unsub.push(uA);
  }

  // ── excuseRequests collection ─────────────────────────────────────────
  // Admin manages all requests; a student only ever needs their own, so scope
  // the student listener to where(studentId == me) instead of the whole
  // collection. (A student with no derivable id simply skips it.)
  if (onExcuseRequestsUpdate) {
    const exRef = isAdmin
      ? collection(db, 'excuseRequests')
      : (studentId ? query(collection(db, 'excuseRequests'), where('studentId', '==', studentId)) : null);
    if (exRef) {
      const uE = onSnapshot(
        exRef,
        snap => {
          const reqs = [];
          snap.forEach(d => reqs.push(d.data()));
          onExcuseRequestsUpdate(reqs);
        },
        e => console.error('[Firebase] excuseRequests listener error:', e.message)
      );
      _unsub.push(uE);
    }
  }

  // ── studentFeedback collection ────────────────────────────────────────
  // Same pattern: admin reads the whole Feedback Hub; a student reads only their
  // own submissions.
  if (onStudentFeedbackUpdate) {
    const fbRef = isAdmin
      ? collection(db, 'studentFeedback')
      : (studentId ? query(collection(db, 'studentFeedback'), where('studentId', '==', studentId)) : null);
    if (fbRef) {
      const uFb = onSnapshot(
        fbRef,
        snap => {
          const fb = [];
          snap.forEach(d => fb.push(d.data()));
          onStudentFeedbackUpdate(fb);
        },
        e => console.error('[Firebase] studentFeedback listener error:', e.message)
      );
      _unsub.push(uFb);
    }
  }

  // ── auditLog collection (admin action history) ────────────────────────
  // Capped to the most recent 500 entries so the listener never grows into an
  // unbounded read as the log accumulates over time.
  if (onAuditLogUpdate) {
    const auditQ = query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(500));
    const uAudit = onSnapshot(
      auditQ,
      snap => {
        const logs = [];
        snap.forEach(d => logs.push(d.data()));
        onAuditLogUpdate(logs);
      },
      e => console.error('[Firebase] auditLog listener error:', e.message)
    );
    _unsub.push(uAudit);
  }

  // ── portal/settings (equiv scale, grade weights) ──────────────────────
  const u5 = onSnapshot(
    doc(db, 'portal', 'settings'),
    snap => {
      if (!snap.exists()) return;
      onSettingsUpdate(snap.data());
    },
    e => console.error('[Firebase] settings listener error:', e.message)
  );
  _unsub.push(u5);

  // ── portal/rubricLibrary (reusable grading rubrics) ──────────────────────
  if (onRubricLibraryUpdate) {
    const uRub = onSnapshot(
      doc(db, 'portal', 'rubricLibrary'),
      snap => {
        if (!snap.exists()) { onRubricLibraryUpdate([]); return; }
        const list = snap.data()?.rubrics;
        onRubricLibraryUpdate(Array.isArray(list) ? list : []);
      },
      e => console.error('[Firebase] rubricLibrary listener error:', e.message)
    );
    _unsub.push(uRub);
  }

  console.log('[Firebase] ✅ All listeners active.');

  // NOTE: there is intentionally NO eager getDocs() of the collections here.
  // Each onSnapshot above already fires an initial snapshot with the full current
  // data, so a parallel getDocs would just double-bill every read on cold start.
  // On revisit, persistentLocalCache serves that initial snapshot from disk
  // instantly (zero reads) before reconciling with the server. Only the single
  // portal/config doc keeps an eager fetch (below), since it gates the EJS
  // credential bootstrap and has warm-up retry logic.
}

export function stopListening() {
  _unsub.forEach(u => { try { u(); } catch (e) {} });
  _unsub = [];
}

// Admin-only paginated messages listener: the `limitN` most-recently-active
// threads, ordered by lastActivityAt (descending). Returns an unsubscribe; the
// callback receives (msgs, count) so the caller can tell whether a full page came
// back (more may exist). Kept separate from fbStartListening so DataContext can
// grow the window for "load older" without tearing down every other listener.
export function subscribeAdminMessages(db, onUpdate, limitN = 100) {
  const q = query(collection(db, 'messages'), orderBy('lastActivityAt', 'desc'), limit(limitN));
  return onSnapshot(
    q,
    snap => {
      const msgs = [];
      snap.forEach(d => msgs.push(d.data()));
      onUpdate(msgs, snap.size);
    },
    e => console.error('[Firebase] admin messages listener error:', e.message)
  );
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
