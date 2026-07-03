// ── Attendance serialization ──────────────────────────────────────────────
// Converts Set objects ↔ plain arrays for JSON / Firestore storage.
// IMPORTANT: React state must never hold raw Sets (not detectable by React).
// Always call deserializeStudents() before setStudents().
//
// Three sets per subject:
//   attendance - dates the student attended (on time OR late)
//   late       - subset of attendance: dates the student arrived late.
//                Late still counts as attended for rates/grades; this set only
//                marks which attended days were tardy.
//   excuse     - dates excused (counted separately from absent)

export function serializeStudents(arr) {
  return arr.map(s => {
    const _att = {}, _exc = {}, _late = {};
    Object.keys(s.attendance || {}).forEach(sub => {
      _att[sub] = [...(s.attendance[sub] || new Set())];
    });
    Object.keys(s.excuse || {}).forEach(sub => {
      _exc[sub] = [...(s.excuse[sub] || new Set())];
    });
    Object.keys(s.late || {}).forEach(sub => {
      _late[sub] = [...(s.late[sub] || new Set())];
    });
    const out = { ...s };
    delete out.attendance;
    delete out.excuse;
    delete out.late;
    out._att = _att;
    out._exc = _exc;
    out._late = _late;
    return out;
  });
}

// Late threshold for live-class attendance (minutes after the scheduled
// start). The in-meeting viewer and the end-of-class sheet SHARE this
// preference so what the professor watches during class is exactly what the
// sheet prefills. 15 minutes is the default late cap.
export const LATE_THR_OPTIONS = [5, 10, 15]
export const LATE_THR_DEFAULT = 15

export function getLateThreshold() {
  try {
    const v = parseInt(localStorage.getItem('acadflow_late_thr'), 10)
    if (LATE_THR_OPTIONS.includes(v)) return v
  } catch { /* default */ }
  return LATE_THR_DEFAULT
}

export function setLateThreshold(v) {
  try { localStorage.setItem('acadflow_late_thr', String(v)) } catch { /* session only */ }
}

export function deserializeStudents(arr) {
  return arr.map(s => {
    const attendance = {}, excuse = {}, late = {};
    Object.keys(s._att || {}).forEach(sub => { attendance[sub] = new Set(s._att[sub] || []); });
    Object.keys(s._exc || {}).forEach(sub => { excuse[sub]     = new Set(s._exc[sub] || []); });
    Object.keys(s._late || {}).forEach(sub => { late[sub]      = new Set(s._late[sub] || []); });
    const out = { ...s, attendance, excuse, late };
    delete out._att;
    delete out._exc;
    delete out._late;
    // Student names are shown UPPERCASE everywhere - normalize at the single
    // point every student record enters memory, so all reads/exports follow.
    if (out.name != null) out.name = String(out.name).toUpperCase();
    if (out.account?._tempPass) out.forceChangePassword = true;
    return out;
  });
}
