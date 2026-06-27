// ── Grade computation utilities ────────────────────────────────────────────
// Pure functions — no DOM, no React. All globals (eqScale, classes, students)
// are passed as arguments instead of being read from module scope.

// CSS color token for a 0–100 percentage by the standard pass thresholds
// (≥85 good / ≥75 warn / below fail; muted when there's no value).
export function pctColor(p) {
  if (p == null) return 'var(--ink3)';
  return p >= 85 ? 'var(--green)' : p >= 75 ? 'var(--yellow)' : 'var(--red)';
}

export const DEFAULT_EQ_SCALE = [
  { minScore: 99, maxScore: 100, eq: '1.00', ltr: 'A+', rem: 'Passed' },
  { minScore: 96, maxScore: 98,  eq: '1.25', ltr: 'A+', rem: 'Passed' },
  { minScore: 93, maxScore: 95,  eq: '1.50', ltr: 'A',  rem: 'Passed' },
  { minScore: 90, maxScore: 92,  eq: '1.75', ltr: 'A-', rem: 'Passed' },
  { minScore: 87, maxScore: 89,  eq: '2.00', ltr: 'B+', rem: 'Passed' },
  { minScore: 84, maxScore: 86,  eq: '2.25', ltr: 'B+', rem: 'Passed' },
  { minScore: 81, maxScore: 83,  eq: '2.50', ltr: 'B',  rem: 'Passed' },
  { minScore: 78, maxScore: 80,  eq: '2.75', ltr: 'B-', rem: 'Passed' },
  { minScore: 75, maxScore: 77,  eq: '3.00', ltr: 'C',  rem: 'Passed' },
  { minScore: 72, maxScore: 74,  eq: '4.00', ltr: 'D',  rem: 'Conditional' },
];

// ── Grade percentage → equivalency lookup ─────────────────────────────────
// eqScale defaults to DEFAULT_EQ_SCALE when not provided.
// Uses threshold-only matching (g >= minScore) sorted highest-first so there
// are no gaps between tiers when scores land on decimal values.
export function gradeInfo(g, eqScale = DEFAULT_EQ_SCALE) {
  if (g === null || g === undefined) return { eq: '—', ltr: '—', rem: 'No Grade' };
  const sorted = [...eqScale].sort((a, b) => b.minScore - a.minScore);
  for (const tier of sorted) {
    if (g >= tier.minScore) return { eq: tier.eq, ltr: tier.ltr, rem: tier.rem };
  }
  return { eq: '5.00', ltr: 'F', rem: 'Failed' };
}

// ── Equivalency-scale validator (connected to the grading engine) ─────────────
// Lives next to gradeInfo and validates a candidate scale with the SAME threshold
// model the grade computation uses, so the settings "smart check" stays in sync
// with how grades are actually computed. Returns a FieldCheck-compatible
// { state: 'ok'|'warn'|'error', msg } the settings panel can gate the save on.
//   • every tier minimum must be a number within 0–100
//   • minimums must be strictly descending (highest equivalent first)
//   • the scale must round-trip through gradeInfo at the passing boundary, so the
//     grade engine reads the same Passed/Failed cut the teacher intends
export function validateEqScale(scale = []) {
  if (!Array.isArray(scale) || !scale.length) return { state: 'error', msg: 'Scale is empty' };
  for (const t of scale) {
    const n = Number(t.minScore);
    if (isNaN(n)) return { state: 'error', msg: 'Every tier needs a numeric minimum score' };
    if (n < 0 || n > 100) return { state: 'error', msg: 'Scores must be between 0 and 100' };
  }
  for (let i = 1; i < scale.length; i++) {
    if (!(Number(scale[i].minScore) < Number(scale[i - 1].minScore))) {
      const a = scale[i].eq || `tier ${i + 1}`, b = scale[i - 1].eq || `tier ${i}`;
      return { state: 'error', msg: `${a} must be lower than ${b}` };
    }
  }
  // Passing boundary must agree with the grading engine (gradeInfo).
  const passes = scale.filter(t => t.rem === 'Passed');
  if (!passes.length) return { state: 'warn', msg: 'No passing tier — every grade would fail' };
  const passMin = Math.min(...passes.map(t => Number(t.minScore)));
  if (gradeInfo(passMin, scale).rem !== 'Passed' || gradeInfo(passMin - 0.01, scale).rem === 'Passed') {
    return { state: 'warn', msg: 'Passing boundary doesn’t line up with the grading engine' };
  }
  return { state: 'ok', msg: `In sync with grading — passing at ${passMin}% and above` };
}

// ── Equivalency string → letter/remark ───────────────────────────────────
export function equivInfo(eq) {
  if (!eq || eq === '—') return { ltr: '—', rem: 'No Grade' };
  const n = parseFloat(eq);
  if (isNaN(n)) return { ltr: '—', rem: 'No Grade' };
  if (n <= 1.00) return { ltr: 'A+', rem: 'Passed' };
  if (n <= 1.25) return { ltr: 'A+', rem: 'Passed' };
  if (n <= 1.50) return { ltr: 'A',  rem: 'Passed' };
  if (n <= 1.75) return { ltr: 'A-', rem: 'Passed' };
  if (n <= 2.00) return { ltr: 'B+', rem: 'Passed' };
  if (n <= 2.25) return { ltr: 'B+', rem: 'Passed' };
  if (n <= 2.50) return { ltr: 'B',  rem: 'Passed' };
  if (n <= 2.75) return { ltr: 'B-', rem: 'Passed' };
  if (n <= 3.00) return { ltr: 'C',  rem: 'Passed' };
  if (n <= 4.00) return { ltr: 'D',  rem: 'Conditional' };
  return { ltr: 'F', rem: 'Failed' };
}

// ── School combination table: midterm equiv × finals equiv → final grade ──
const EQUIV_COMBINE_TABLE = {
  '1.00':{'1.00':'1.00','1.25':'1.25','1.50':'1.25','1.75':'1.50','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.25':{'1.00':'1.00','1.25':'1.25','1.50':'1.50','1.75':'1.50','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.50':{'1.00':'1.25','1.25':'1.25','1.50':'1.50','1.75':'1.75','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.75':{'1.00':'1.25','1.25':'1.50','1.50':'1.50','1.75':'1.50','2.00':'2.00','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.50','4.00':'3.00','5.00':'5.00'},
  '2.00':{'1.00':'1.25','1.25':'1.50','1.50':'1.75','1.75':'1.75','2.00':'2.00','2.25':'2.25','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'4.00'},
  '2.25':{'1.00':'1.50','1.25':'1.50','1.50':'1.75','1.75':'2.00','2.00':'2.00','2.25':'2.25','2.50':'2.50','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '2.50':{'1.00':'1.50','1.25':'1.75','1.50':'1.75','1.75':'2.00','2.00':'2.25','2.25':'2.25','2.50':'2.50','2.75':'2.75','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '2.75':{'1.00':'1.50','1.25':'1.75','1.50':'2.00','1.75':'2.00','2.00':'2.25','2.25':'2.50','2.50':'2.50','2.75':'2.75','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '3.00':{'1.00':'1.75','1.25':'1.75','1.50':'2.00','1.75':'2.25','2.00':'2.25','2.25':'2.50','2.50':'2.75','2.75':'2.75','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '4.00':{'1.00':'2.00','1.25':'2.25','1.50':'2.25','1.75':'2.50','2.00':'2.75','2.25':'2.75','2.50':'3.00','2.75':'3.00','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '5.00':{'1.00':'2.25','1.25':'2.50','1.50':'2.75','1.75':'2.75','2.00':'3.00','2.25':'3.00','2.50':'3.00','2.75':'5.00','3.00':'5.00','4.00':'5.00','5.00':'5.00'},
};

export function combineEquiv(midEq, finEq) {
  if (!midEq || midEq === '—') {
    if (!finEq || finEq === '—') return { eq: '—', ltr: '—', rem: 'No Grade' };
    return { eq: finEq, ...equivInfo(finEq) };
  }
  if (!finEq || finEq === '—') {
    return { eq: midEq, ...equivInfo(midEq) };
  }
  const row = EQUIV_COMBINE_TABLE[midEq];
  if (!row) {
    const avg = ((parseFloat(midEq) || 0) + (parseFloat(finEq) || 0)) / 2;
    const rounded = (Math.round(avg * 4) / 4).toFixed(2);
    return { eq: rounded, ...equivInfo(rounded) };
  }
  const combined = row[finEq];
  if (!combined) {
    const finN = parseFloat(finEq);
    const keys = Object.keys(row).map(parseFloat).sort((a, b) => a - b);
    const closest = keys.reduce((p, c) => Math.abs(c - finN) < Math.abs(p - finN) ? c : p).toFixed(2);
    const result = row[closest] || finEq;
    return { eq: result, ...equivInfo(result) };
  }
  return { eq: combined, ...equivInfo(combined) };
}

export function gradeInfoForStudent(s, sub, eqScale = DEFAULT_EQ_SCALE) {
  const comp = s.gradeComponents?.[sub] || {};
  const midG = comp.midterm ?? null;
  const finG = comp.finals  ?? null;
  const ts   = s.gradeUploadedAt?.[sub];
  if (midG != null && finG != null && ts)
    return combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq);
  return { eq: '—', ltr: '—', rem: 'Pending' };
}

// ── Grade % computation ────────────────────────────────────────────────────
// Rounding policy: intermediate values (Class Standing, Midterm Term, Finals
// Term) are kept at FULL precision; only the final grade % is rounded to 2 dp.
// Component values fed in (activities, quizzes, attendance, attitude, exams)
// must already be percentages (0–100).

export const round2 = n => (n === null || n === undefined || isNaN(n)) ? null : parseFloat(Number(n).toFixed(2));

const _num = x => (x !== null && x !== undefined && !isNaN(x)) ? Number(x) : null;
const _mean = arr => { const v = arr.filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// Mean percentage from raw scored items [{ score, maxScore }]. Each item is
// normalized to (score / maxScore) * 100 so activities/quizzes graded out of a
// max other than 100 (e.g. rubric totals) count correctly. Full precision;
// null when there are no scored items.
export function scoredPercent(items = []) {
  const pcts = (items || [])
    .filter(it => it && it.score != null && !isNaN(it.score) && Number(it.maxScore) > 0)
    .map(it => (Number(it.score) / Number(it.maxScore)) * 100);
  return pcts.length ? pcts.reduce((s, x) => s + x, 0) / pcts.length : null;
}

export function computeFinalGradeFromTerms(midtermTerm, finalsTerm) {
  const term = _mean([_num(midtermTerm), _num(finalsTerm)]);
  if (term === null) return null;
  return Math.min(100, Math.max(0, round2(term)));
}

// Canonical subject computation used by every grade path (activity grading,
// grade entry, import, exports). Returns full-precision cs/midterm/finals and
// the rounded final %, so all screens agree to the last decimal.
export function computeTerms({ activities = null, quizzes = null, attendance = null, attitude = null, midtermExam = null, finalsExam = null } = {}) {
  const cs = _mean([_num(activities), _num(quizzes), _num(attendance), _num(attitude)]);
  const midE = _num(midtermExam), finE = _num(finalsExam);
  const midterm = midE !== null ? _mean([cs, midE]) : null;
  const finals  = finE !== null ? _mean([cs, finE]) : null;
  return { cs, midterm, finals, final: computeFinalGradeFromTerms(midterm, finals) };
}

// ── GWA (General Weighted Average) ────────────────────────────────────────
// classes array is passed in — no global read.
export function getGWA(s, classes = []) {
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []);
  const allSubs = enrolledIds.length
    ? [...new Set(enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || []))]
    : Object.keys(s.grades || {});
  const vals = allSubs.map(sub => {
    // Prefer the authoritative saved final (computed at full precision on save,
    // or a manual override); fall back to deriving it from stored terms.
    const stored = s.grades?.[sub];
    if (stored !== null && stored !== undefined) return stored;
    const comp = s.gradeComponents?.[sub] || {};
    return computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null);
  }).filter(g => g !== null && g !== undefined);
  if (!vals.length) return null;
  return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

// ── Attendance rate % ─────────────────────────────────────────────────────
// students and classes arrays are passed in — no global read.
export function getAttRate(s, students = [], classes = []) {
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []);
  const allSubs = enrolledIds.length
    ? [...new Set(enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || []))]
    : Object.keys(s.attendance || {});
  if (!allSubs.length) return null;
  let totalPresent = 0, totalExpected = 0;
  allSubs.forEach(sub => {
    const classIdsForSub = enrolledIds.filter(id => {
      const cls = classes.find(c => c.id === id);
      return cls?.subjects?.includes(sub);
    });
    const classMates = classIdsForSub.length
      ? students.filter(x => x.id !== s.id && classIdsForSub.some(id =>
          (x.classIds?.includes(id)) || x.classId === id
        ))
      : [];
    const held = [...classMates, s].reduce((mx, x) => {
      const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size;
      return Math.max(mx, sz);
    }, 0);
    totalPresent  += (s.attendance?.[sub] || new Set()).size;
    totalExpected += held;
  });
  if (!totalExpected) return null;
  return parseFloat(((totalPresent / totalExpected) * 100).toFixed(1));
}

// ── Sessions held for a subject in a class ────────────────────────────────
// Counts the most attendance/excuse records any enrolled student has for the
// subject. Includes students enrolled via classIds (not just their primary
// class) so sections with cross-enrolled students don't under-count held days.
export function getHeldDays(classId, sub, students = []) {
  const classStudents = students.filter(s => s.classId === classId || s.classIds?.includes(classId));
  if (!classStudents.length) return 0;
  return classStudents.reduce((mx, x) => {
    const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size;
    return Math.max(mx, sz);
  }, 0);
}

// ── Grade scale label for export headers ─────────────────────────────────
export function getGradeScaleLabel(eqScale = DEFAULT_EQ_SCALE) {
  return eqScale.map(t => `≥${t.minScore}→${t.eq}`).join(' · ')
    + ` · <${eqScale[eqScale.length - 1].minScore}→5.00 (Failed)`;
}
