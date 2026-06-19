// ── Attendance serialization ──────────────────────────────────────────────
// Converts Set objects ↔ plain arrays for JSON / Firestore storage.
// IMPORTANT: React state must never hold raw Sets (not detectable by React).
// Always call deserializeStudents() before setStudents().

export function serializeStudents(arr) {
  return arr.map(s => {
    const _att = {}, _exc = {};
    Object.keys(s.attendance || {}).forEach(sub => {
      _att[sub] = [...(s.attendance[sub] || new Set())];
    });
    Object.keys(s.excuse || {}).forEach(sub => {
      _exc[sub] = [...(s.excuse[sub] || new Set())];
    });
    const out = { ...s };
    delete out.attendance;
    delete out.excuse;
    out._att = _att;
    out._exc = _exc;
    return out;
  });
}

export function deserializeStudents(arr) {
  return arr.map(s => {
    const attendance = {}, excuse = {};
    Object.keys(s._att || {}).forEach(sub => { attendance[sub] = new Set(s._att[sub] || []); });
    Object.keys(s._exc || {}).forEach(sub => { excuse[sub]     = new Set(s._exc[sub] || []); });
    const out = { ...s, attendance, excuse };
    delete out._att;
    delete out._exc;
    if (out.account?._tempPass) out.forceChangePassword = true;
    return out;
  });
}
