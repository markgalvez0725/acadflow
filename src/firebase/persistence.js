// ── Firestore persistence helpers ─────────────────────────────────────────
import { doc, setDoc, deleteDoc, arrayUnion, runTransaction, collection, getDocs, query, where, updateDoc, deleteField } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import { fbWithTimeout } from './firebaseInit'
import { serializeStudents } from '@/utils/attendance'
import { setFbWriting } from './listeners'
import { annClassIds, annIsBroadcast } from '@/utils/announce'

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

// ── Cascade purge of EVERY trace of a student across Firestore ──────────────
// The student's own grades/attendance/account live on students/{id} (already
// removed by fbDeleteStudent). This wipes the references that survive in OTHER
// collections, so re-enrolling the same student number can never inherit stale
// data. Runs with the professor's (admin) privileges. Server-only bits (the
// Firebase Auth account, faceSignatures, resetSessions) are NOT reachable here -
// the api/delete-student endpoint handles those. Each collection is independent
// and best-effort; one failure never aborts the rest. Returns { ok[], failed[] }.
export async function fbPurgeStudentData(db, id) {
  if (!db || !id) return { ok: [], failed: ['no-db'] };
  const ok = [], failed = [];
  const step = async (label, fn) => {
    try { await fn(); ok.push(label); }
    catch (e) { failed.push(label); console.warn('[FB] purge ' + label + ':', e.message); }
  };

  setFbWriting(true);
  try {
    // Per-student feed doc (notifications/{studentId}).
    await step('notifications', () => deleteDoc(doc(db, 'notifications', id)));

    // Maps keyed by studentId: drop just that key, keep everyone else's data.
    const dropMapKey = (coll, mapField) => async () => {
      const snap = await getDocs(collection(db, coll));
      await Promise.all(snap.docs
        .filter(d => d.data()?.[mapField] && Object.prototype.hasOwnProperty.call(d.data()[mapField], id))
        .map(d => updateDoc(d.ref, { [mapField + '.' + id]: deleteField() })));
    };
    await step('quizzes', dropMapKey('quizzes', 'submissions'));
    await step('activities', dropMapKey('activities', 'submissions'));
    await step('attendanceSessions', dropMapKey('attendanceSessions', 'checkedIn'));

    // Announcements: pull the student out of read/likes/followers and drop the
    // comments (and nested replies) they authored.
    await step('announcements', async () => {
      const snap = await getDocs(collection(db, 'announcements'));
      await Promise.all(snap.docs.map(async d => {
        const a = d.data() || {};
        const patch = {};
        for (const f of ['read', 'likes', 'followers']) {
          if (Array.isArray(a[f]) && a[f].includes(id)) patch[f] = a[f].filter(x => x !== id);
        }
        if (Array.isArray(a.comments)) {
          const cleaned = a.comments
            .filter(c => c.author !== id)
            .map(c => Array.isArray(c.replies) ? { ...c, replies: c.replies.filter(r => r.author !== id) } : c);
          if (JSON.stringify(cleaned) !== JSON.stringify(a.comments)) patch.comments = cleaned;
        }
        if (Object.keys(patch).length) await updateDoc(d.ref, patch);
      }));
    });

    // Whole docs owned by the student.
    const deleteWhere = (coll, field) => async () => {
      const snap = await getDocs(query(collection(db, coll), where(field, '==', id)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    };
    await step('excuseRequests', deleteWhere('excuseRequests', 'studentId'));
    await step('studentFeedback', deleteWhere('studentFeedback', 'studentId'));
    await step('pushTokens', deleteWhere('pushTokens', 'ownerId'));

    // Messages: delete direct threads to/from the student outright; for group
    // chats, pull them out of read/readAt/hiddenFor and drop their replies.
    await step('messages', async () => {
      const snap = await getDocs(collection(db, 'messages'));
      await Promise.all(snap.docs.map(async d => {
        const m = d.data() || {};
        if (m.to === id || m.from === id) { await deleteDoc(d.ref); return; }
        const patch = {};
        if (Array.isArray(m.read) && m.read.includes(id)) patch.read = m.read.filter(x => x !== id);
        if (Array.isArray(m.hiddenFor) && m.hiddenFor.includes(id)) patch.hiddenFor = m.hiddenFor.filter(x => x !== id);
        if (m.readAt && Object.prototype.hasOwnProperty.call(m.readAt, id)) {
          const next = { ...m.readAt }; delete next[id]; patch.readAt = next;
        }
        if (Array.isArray(m.replies) && m.replies.some(r => r.from === id)) {
          patch.replies = m.replies.filter(r => r.from !== id);
        }
        if (Object.keys(patch).length) await updateDoc(d.ref, patch);
      }));
    });
  } finally {
    setFbWriting(false);
  }

  return { ok, failed };
}

// ── Batch student sync ────────────────────────────────────────────────────
// `opts.strict` rethrows on failure so the caller can surface the error and
// roll back optimistic UI. WITHOUT it (default), a failed write is swallowed -
// fine for fire-and-forget saves, but for enrollment that silently dropped the
// write, leaving the student "enrolled" locally yet absent in Firestore until a
// reload reverted them. Critical writes (enroll/unenroll) must pass strict:true.
export async function persistStudentsSync(db, students, changedStudentIds, opts = {}) {
  if (!db) {
    if (opts.strict) throw new Error('Not connected. Check your internet and try again.');
    return;
  }
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
    if (opts.strict) throw e;
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
    throw new Error('SECURITY: Invalid VITE_ADMIN_CRYPTO_KEY - must be at least 16 characters.')
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

// ── Rubric library (reusable grading rubrics - singleton portal doc) ─────────
export async function fbSaveRubricLibrary(db, rubrics) {
  const { doc: fbDoc, setDoc } = await import('firebase/firestore')
  return fbWithTimeout(setDoc(fbDoc(db, 'portal', 'rubricLibrary'), { rubrics }, { merge: true }))
}

// ── Message delete (professor-side hard delete of a message document) ───────────
// Removes the whole message doc (and its nested replies). Used by the admin
// Messages tab. Student-side "delete" hides locally instead - students must not
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

// Toggle a student's like on an announcement (atomic). `liked` is the desired
// end state; reading inside the transaction means concurrent likers from
// different devices never clobber each other's entry.
export async function fbToggleAnnouncementLike(db, announcementId, studentId, liked) {
  if (!db || !announcementId || !studentId) return
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'announcements', announcementId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Announcement not found')
    const cur = Array.isArray(snap.data().likes) ? snap.data().likes : []
    const next = liked ? [...new Set([...cur, studentId])] : cur.filter(id => id !== studentId)
    transaction.update(ref, { likes: next })
  }))
}

// Toggle a student following a post for new-comment notifications (atomic).
// Stored on the announcement so any commenter can read the follower list and
// notify them. Allowed by the same signed-in announcement write rule as likes.
export async function fbToggleAnnouncementFollow(db, announcementId, studentId, following) {
  if (!db || !announcementId || !studentId) return
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'announcements', announcementId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Announcement not found')
    const cur = Array.isArray(snap.data().followers) ? snap.data().followers : []
    const next = following ? [...new Set([...cur, studentId])] : cur.filter(id => id !== studentId)
    transaction.update(ref, { followers: next })
  }))
}

// Toggle a saved/bookmarked post on the student's OWN doc (atomic). Touches
// only `savedPosts`, so gradeFieldsUntouched() in the Firestore rules still
// passes - students may write their own non-grade fields.
export async function fbToggleSavedPost(db, studentId, announcementId, saved) {
  if (!db || !studentId || !announcementId) return
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'students', studentId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Student not found')
    const cur = Array.isArray(snap.data().savedPosts) ? snap.data().savedPosts : []
    const next = saved ? [...new Set([...cur, announcementId])] : cur.filter(id => id !== announcementId)
    transaction.update(ref, { savedPosts: next })
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

// Edit / delete a comment or a reply. All transactional: they re-read the live
// comments array and apply the change by id, so concurrent comments from other
// devices are never clobbered. `editedAt` marks an edited entry.
async function commentsTxn(db, announcementId, apply) {
  const { doc: fbDoc } = await import('firebase/firestore')
  const ref = fbDoc(db, 'announcements', announcementId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Announcement not found')
    const comments = Array.isArray(snap.data().comments) ? snap.data().comments : []
    transaction.update(ref, { comments: apply(comments) })
  }))
}

export async function fbEditAnnouncementComment(db, announcementId, commentId, text) {
  if (!db || !announcementId || !commentId) return
  return commentsTxn(db, announcementId, comments =>
    comments.map(c => c.id === commentId ? { ...c, text, editedAt: Date.now() } : c))
}

export async function fbDeleteAnnouncementComment(db, announcementId, commentId) {
  if (!db || !announcementId || !commentId) return
  return commentsTxn(db, announcementId, comments => comments.filter(c => c.id !== commentId))
}

export async function fbEditCommentReply(db, announcementId, commentId, replyId, text) {
  if (!db || !announcementId || !commentId || !replyId) return
  return commentsTxn(db, announcementId, comments =>
    comments.map(c => c.id === commentId
      ? { ...c, replies: (c.replies || []).map(r => r.id === replyId ? { ...r, text, editedAt: Date.now() } : r) }
      : c))
}

export async function fbDeleteCommentReply(db, announcementId, commentId, replyId) {
  if (!db || !announcementId || !commentId || !replyId) return
  return commentsTxn(db, announcementId, comments =>
    comments.map(c => c.id === commentId
      ? { ...c, replies: (c.replies || []).filter(r => r.id !== replyId) }
      : c))
}

// Atomically append a reply to a message thread. Reading the current replies
// inside a transaction prevents the lost-update race where professor and student
// reply near-simultaneously and one reply silently overwrites the other.
export async function fbAddMessageReply(db, msgId, reply, opts = {}) {
  if (!db || !msgId || !reply) return
  const ref = doc(db, 'messages', msgId)
  // Append-only fast path: arrayUnion is atomic and needs NO read, so it can't
  // lose a concurrent reply (the lost-update race the old transaction guarded
  // against) and never retries under group-chat contention. The read[]/adminRead
  // updates piggy-back on the same single write. arrayUnion dedupes by value, so
  // a repeated readerId is a no-op just like the old includes() check.
  const patch = { replies: arrayUnion(reply), lastActivityAt: reply.ts || Date.now() }
  if (opts.adminRead !== undefined) patch.adminRead = opts.adminRead
  if (opts.readerId) patch.read = arrayUnion(opts.readerId)
  return fbWithTimeout(updateDoc(ref, patch))
}

// Patch exactly the first reply that matches {ts, from}. Replies have no stable
// id, but ts (ms) + sender uniquely identifies a bubble in practice; the `done`
// guard makes sure an identical-ts collision never double-patches.
function patchReplyOnce(replies, target, patchFn) {
  let done = false
  return (Array.isArray(replies) ? replies : []).map(r => {
    if (!done && r.ts === target.ts && r.from === target.from) { done = true; return patchFn(r) }
    return r
  })
}

// Edit a single message entry's text. `target` selects which entry:
//   { main: true } → the top-level message body
//   { ts, from }   → the matching reply inside replies[]
// Stamps editedAt so the UI can show an "edited" tag. Messages are plain text
// (rendered via MessageText, never as raw HTML), so no HTML sanitizing is needed
// here - the caller trims; length is bounded at the composer.
export async function fbEditMessageEntry(db, msgId, target, newBody) {
  if (!db || !msgId || !target || newBody == null) return
  const ref = doc(db, 'messages', msgId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Message not found')
    const now = Date.now()
    if (target.main) {
      transaction.update(ref, { body: newBody, editedAt: now })
    } else {
      const replies = snap.data().replies
      transaction.update(ref, { replies: patchReplyOnce(replies, target, r => ({ ...r, body: newBody, editedAt: now })) })
    }
  }))
}

// Delete a single message entry. `mode`:
//   'everyone' → soft tombstone for everyone (deleted:true, deletedAt/By, body
//                and secure cleared so the text no longer lives in Firestore)
//   'me'       → hide the bubble only for actorId (append to hiddenFor[]); the
//                other party keeps seeing it
// Both are transactional so concurrent replies are never clobbered.
export async function fbDeleteMessageEntry(db, msgId, target, mode, actorId) {
  if (!db || !msgId || !target) return
  const ref = doc(db, 'messages', msgId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Message not found')
    const m = snap.data()
    const now = Date.now()
    const tombstone = obj => ({ ...obj, deleted: true, deletedAt: now, deletedBy: actorId || null, body: '', subject: '', secure: false })
    const hideForMe = obj => ({ ...obj, hiddenFor: [...new Set([...(Array.isArray(obj.hiddenFor) ? obj.hiddenFor : []), actorId].filter(Boolean))] })
    const apply = mode === 'everyone' ? tombstone : hideForMe
    if (target.main) {
      if (mode === 'everyone') transaction.update(ref, { deleted: true, deletedAt: now, deletedBy: actorId || null, body: '', subject: '', secure: false })
      else transaction.update(ref, { hiddenFor: [...new Set([...(Array.isArray(m.hiddenFor) ? m.hiddenFor : []), actorId].filter(Boolean))] })
    } else {
      transaction.update(ref, { replies: patchReplyOnce(m.replies, target, apply) })
    }
  }))
}

// Toggle one reader's emoji reaction on a message entry. `target` selects the
// entry the same way edit/delete do ({ main: true } or { ts, from }). Reactions
// live as a map of emoji -> reader ids on the entry; the reader is added if
// absent and removed if present, dropping the emoji key once empty. Transactional
// so a reaction and a concurrent reply never clobber each other.
function applyReactionToggle(reactions, emoji, actorId) {
  const map = (reactions && typeof reactions === 'object') ? { ...reactions } : {}
  const cur = Array.isArray(map[emoji]) ? map[emoji] : []
  if (cur.includes(actorId)) {
    const next = cur.filter(id => id !== actorId)
    if (next.length) map[emoji] = next
    else delete map[emoji]
  } else {
    map[emoji] = [...cur, actorId]
  }
  return map
}

export async function fbToggleMessageReaction(db, msgId, target, emoji, actorId) {
  if (!db || !msgId || !target || !emoji || !actorId) return
  const ref = doc(db, 'messages', msgId)
  return fbWithTimeout(runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Message not found')
    const m = snap.data()
    if (target.main) {
      transaction.update(ref, { reactions: applyReactionToggle(m.reactions, emoji, actorId) })
    } else {
      transaction.update(ref, { replies: patchReplyOnce(m.replies, target, r => ({ ...r, reactions: applyReactionToggle(r.reactions, emoji, actorId) })) })
    }
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

// One-time backfill: stamp lastActivityAt on legacy message docs that predate the
// field, so an orderBy('lastActivityAt') admin query doesn't silently exclude
// them (Firestore omits docs missing the ordered field). Derives the value from
// max(message ts, newest reply ts). Idempotent - only patches docs missing it, so
// re-running is a no-op once complete. Returns { scanned, patched }.
export async function fbBackfillMessageActivity(db) {
  if (!db) return { scanned: 0, patched: 0 }
  const snap = await getDocs(collection(db, 'messages'))
  const writes = []
  snap.forEach(d => {
    const m = d.data() || {}
    if (m.lastActivityAt != null) return
    const replyTs = Array.isArray(m.replies) ? m.replies.reduce((mx, r) => Math.max(mx, r?.ts || 0), 0) : 0
    const last = Math.max(m.ts || 0, replyTs) || Date.now()
    writes.push(updateDoc(d.ref, { lastActivityAt: last }))
  })
  for (let i = 0; i < writes.length; i += 20) {
    await Promise.allSettled(writes.slice(i, i + 20))
  }
  return { scanned: snap.size, patched: writes.length }
}

// Fetch the COMPLETE messages collection (one read pass). Used by the admin
// backup export, which must include every thread even though the admin's live
// listener now holds only a paginated, most-recently-active window.
export async function fbFetchAllMessages(db) {
  if (!db) return null
  const snap = await getDocs(collection(db, 'messages'))
  const out = []
  snap.forEach(d => out.push(d.data()))
  return out
}

// ── Student secrets (server-only collection) ───────────────────────────────
// The temp-password hash lives in studentSecrets/{id} (never client-readable),
// not on the broadly-readable student doc. The professor (admin) writes it at
// provisioning. Throws on failure so the caller can fall back to the legacy
// on-doc pass (e.g. before the studentSecrets rules are published).
export async function fbWriteStudentSecret(db, studentId, passHash) {
  if (!db || !studentId || !passHash) return
  await fbWithTimeout(setDoc(doc(db, 'studentSecrets', studentId), { pass: passHash }, { merge: true }))
}

// One-time migration: move account.pass out of every student doc into
// studentSecrets, then strip the secret fields (pass + the now-removed
// security-question fields) from the student doc. Per-doc and ordered so the
// secret is safely stored BEFORE it's removed; if the studentSecrets write fails
// (e.g. rules not published) that doc is left intact and retried next run.
// Idempotent: docs with no secret fields are skipped. Returns { migrated, skipped }.
export async function fbMigrateStudentSecrets(db) {
  if (!db) return { migrated: 0, skipped: 0 }
  const snap = await getDocs(collection(db, 'students'))
  let migrated = 0, skipped = 0
  for (const d of snap.docs) {
    const acct = (d.data() || {}).account || {}
    if (acct.pass == null && acct.securityAnswer == null && acct.securityQuestion == null) continue
    try {
      if (acct.pass != null) {
        await fbWithTimeout(setDoc(doc(db, 'studentSecrets', d.id), { pass: acct.pass }, { merge: true }))
      }
      await fbWithTimeout(updateDoc(d.ref, {
        'account.pass': deleteField(),
        'account.securityAnswer': deleteField(),
        'account.securityQuestion': deleteField(),
      }))
      migrated++
    } catch (e) { skipped++ }
  }
  return { migrated, skipped }
}

// Student quiz submission: writes the authoritative submission to the quiz doc
// AND caches the student's own per-quiz result on their student doc. The student
// write is echo-suppressed (setFbWriting) so the students listener doesn't
// re-process mid-write and clobber the just-submitted optimistic state - the
// reason this one belongs in the data layer rather than as a raw component write.
export async function fbSubmitQuizResult(db, { quizId, studentId, submission, quizResults }) {
  if (!db || !quizId || !studentId) return
  const sp = `submissions.${studentId}`
  await fbWithTimeout(updateDoc(doc(db, 'quizzes', quizId), {
    [`${sp}.score`]: submission.score,
    [`${sp}.total`]: submission.total,
    [`${sp}.timeTaken`]: submission.timeTaken,
    [`${sp}.leftCount`]: submission.leftCount,
    [`${sp}.answers`]: submission.answers,
    [`${sp}.submittedAt`]: submission.submittedAt,
  }))
  setFbWriting(true)
  try {
    await fbWithTimeout(updateDoc(doc(db, 'students', studentId), { quizResults }))
  } finally {
    setTimeout(() => setFbWriting(false), 1500)
  }
}

export async function fbPushAnnouncementNotifs(db, announcement, students) {
  if (!db || !announcement || !students?.length) return
  const targetIds = annClassIds(announcement)
  const enrolled = annIsBroadcast(announcement)
    ? students
    : students.filter(s => {
        const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
        return ids.some(id => targetIds.includes(id))
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
  // Always written (even when empty) so clearing the name/photo persists.
  payload.name = admin.name || '';      // professor display name
  payload.photo = admin.photo || null;  // base64 PNG/JPG professor photo

  // 1. Write localStorage immediately - this is what the UI depends on
  try {
    const enc = await encryptAdmin(payload);
    if (enc) localStorage.setItem('cp_admin_enc', enc);
    localStorage.removeItem('cp_admin');
  } catch (e) {}

  // 2. Sync to Firebase in the background - non-blocking
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
    // Persist the subject so the live-meeting lookup matches after the snapshot
    // echo. Dropping it made liveMeetingFor() miss the live doc, so the "Go Live"
    // button reappeared and a second click created a duplicate live session.
    subject: meetingData.subject || null,
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

// ── Student feedback ───────────────────────────────────────────────────────
// One doc per submission in the `studentFeedback` collection. Students create;
// the professor reads them in the Feedback Hub and updates the status.
export async function fbSubmitStudentFeedback(db, feedback) {
  if (!db) throw new Error('Not connected.');
  const { doc: fbDoc, setDoc } = await import('firebase/firestore');
  const id = feedback.id || ('fb_' + Date.now() + Math.random().toString(36).slice(2, 6));
  const doc_ = {
    studentId: feedback.studentId || '',
    studentName: feedback.studentName || '',
    classId: feedback.classId || null,
    category: feedback.category || 'general', // 'enhancement' | 'bug' | 'request' | 'general'
    subject: (feedback.subject || '').slice(0, 120),
    message: (feedback.message || '').slice(0, 2000),
    status: 'new',                            // 'new' | 'reviewed' | 'archived'
    createdAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
    id,
  };
  await fbWithTimeout(setDoc(fbDoc(db, 'studentFeedback', id), doc_));
  return doc_;
}

export async function fbUpdateFeedbackStatus(db, feedbackId, status, reviewedBy) {
  if (!db || !feedbackId) return;
  const { doc: fbDoc, updateDoc } = await import('firebase/firestore');
  await fbWithTimeout(updateDoc(fbDoc(db, 'studentFeedback', feedbackId), {
    status,
    reviewedAt: Date.now(),
    reviewedBy: reviewedBy || null,
  }));
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
    link: `meeting:${meeting.id}`,
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
// Firestore. Restores durable academic data only - students, classes,
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
