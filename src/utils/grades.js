// ── Grade computation utilities ────────────────────────────────────────────
// Pure functions — no DOM, no React. All globals (eqScale, classes, students)
// are passed as arguments instead of being read from module scope.

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
export function gradeInfo(g, eqScale = DEFAULT_EQ_SCALE) {
  if (g === null || g === undefined) return { eq: '—', ltr: '—', rem: 'No Grade' };
  for (const tier of eqScale) {
    if (g >= tier.minScore && g <= tier.maxScore) return { eq: tier.eq, ltr: tier.ltr, rem: tier.rem };
  }
  return { eq: '5.00', ltr: 'F', rem: 'Failed' };
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

// ── Convenience shorthands ─────────────────────────────────────────────────
export function midEqStr(g, eqScale)    { return g != null ? gradeInfo(g, eqScale).eq : '—'; }
export function finRawEqStr(g, eqScale) { return g != null ? gradeInfo(g, eqScale).eq : '—'; }

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
export function computeFinalGradeFromTerms(midtermTerm, finalsTerm) {
  const v = x => (x !== null && x !== undefined && !isNaN(x)) ? x : null;
  const mt = v(midtermTerm), ft = v(finalsTerm);
  const terms = [mt, ft].filter(x => x !== null);
  if (!terms.length) return null;
  const raw = terms.reduce((s, x) => s + x, 0) / terms.length;
  return Math.min(100, Math.max(0, parseFloat(raw.toFixed(2))));
}

export function computeGrade(actV, qzV, attV, midExamV, finExamV) {
  const v   = x => (x !== null && x !== undefined && !isNaN(x)) ? x : null;
  const act = v(actV), qz = v(qzV), att = v(attV);
  const midE = v(midExamV), finE = v(finExamV);

  const csP = [act, qz, att].filter(x => x !== null);
  const cs  = csP.length ? csP.reduce((s, x) => s + x, 0) / csP.length : null;

  let midterm = null;
  if (midE !== null) {
    const p = [cs, midE].filter(x => x !== null);
    midterm = p.reduce((s, x) => s + x, 0) / p.length;
  }

  let finals = null;
  if (finE !== null) {
    const p = [cs, finE].filter(x => x !== null);
    finals = p.reduce((s, x) => s + x, 0) / p.length;
  }

  return computeFinalGradeFromTerms(midterm, finals);
}

// ── GWA (General Weighted Average) ────────────────────────────────────────
// classes array is passed in — no global read.
export function getGWA(s, classes = []) {
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []);
  const allSubs = enrolledIds.length
    ? [...new Set(enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || []))]
    : Object.keys(s.grades || {});
  const vals = allSubs.map(sub => {
    const comp = s.gradeComponents?.[sub] || {};
    const midG = comp.midterm ?? null;
    const finG = comp.finals  ?? null;
    const derived = computeFinalGradeFromTerms(midG, finG);
    return derived ?? s.grades?.[sub] ?? null;
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
      const sz = (x.attendance[sub] || new Set()).size + (x.excuse[sub] || new Set()).size;
      return Math.max(mx, sz);
    }, 0);
    totalPresent  += (s.attendance[sub] || new Set()).size;
    totalExpected += held;
  });
  if (!totalExpected) return null;
  return parseFloat(((totalPresent / totalExpected) * 100).toFixed(1));
}

// ── Sessions held for a subject in a class ────────────────────────────────
export function getHeldDays(classId, sub, students = []) {
  const classStudents = students.filter(s => s.classId === classId);
  if (!classStudents.length) return 0;
  return classStudents.reduce((mx, x) => {
    const sz = (x.attendance[sub] || new Set()).size + (x.excuse[sub] || new Set()).size;
    return Math.max(mx, sz);
  }, 0);
}

// ── Grade scale label for export headers ─────────────────────────────────
export function getGradeScaleLabel(eqScale = DEFAULT_EQ_SCALE) {
  return eqScale.map(t => `≥${t.minScore}→${t.eq}`).join(' · ')
    + ` · <${eqScale[eqScale.length - 1].minScore}→5.00 (Failed)`;
}
