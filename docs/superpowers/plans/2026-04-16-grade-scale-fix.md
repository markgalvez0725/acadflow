# Grade Scale Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incorrect grade scale thresholds and `gradeInfo()` lookup with the school's official strict min/max range table, and propagate this fix to all places that embed the old thresholds: the Excel export formula (`equivIF`), the Excel instructions sheet text, and any inline badge-color comparisons that use hardcoded `75` / `71` pass/fail boundaries that are now `75` / `72`.

**Architecture:** Single source of truth is `src/utils/grades.js`. The `DEFAULT_EQ_SCALE` shape gains a `maxScore` field. `gradeInfo()` switches from waterfall (`g >= minScore`) to strict range (`g >= minScore && g <= maxScore`). The `equivIF()` formula in `excelExport.js` is rebuilt to match the new boundaries. The `computeGrade()` formula (CS → Midterm/Finals → average) is already correct and untouched.

**Tech Stack:** Vanilla JS/JSX, SheetJS (window.XLSX), React 19, Tailwind CSS v4, Firebase Firestore

---

## File Map

| File | Change |
|------|--------|
| `src/utils/grades.js` | Add `maxScore` to `DEFAULT_EQ_SCALE`; rewrite `gradeInfo()` range check |
| `src/export/excelExport.js` | Rewrite `equivIF()` to use new strict boundaries; update instructions sheet text |
| `src/components/admin/tabs/GradesTab.jsx` | Update hardcoded `>= 75` / `> 71` badge-color comparisons to match new scale |
| `src/components/student/tabs/GradesTab.jsx` | Same badge-color fixes |

---

## Task 1: Fix `DEFAULT_EQ_SCALE` and `gradeInfo()` in `src/utils/grades.js`

**Files:**
- Modify: `src/utils/grades.js:5-26`

- [ ] **Step 1: Replace `DEFAULT_EQ_SCALE` with strict min/max entries**

Open `src/utils/grades.js` and replace lines 5–16 with:

```js
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
```

- [ ] **Step 2: Rewrite `gradeInfo()` to use strict range check**

Replace lines 20–26 (the `gradeInfo` function) with:

```js
export function gradeInfo(g, eqScale = DEFAULT_EQ_SCALE) {
  if (g === null || g === undefined) return { eq: '—', ltr: '—', rem: 'No Grade' };
  for (const tier of eqScale) {
    if (g >= tier.minScore && g <= tier.maxScore) return { eq: tier.eq, ltr: tier.ltr, rem: tier.rem };
  }
  return { eq: '5.00', ltr: 'F', rem: 'Failed' };
}
```

- [ ] **Step 3: Verify `getGradeScaleLabel()` still works**

The function at line 192 uses `tier.minScore` only — it still works. No change needed.

- [ ] **Step 4: Manual smoke-test in browser console**

Start `npm run dev` and open the browser console. Run:

```js
import('@/utils/grades.js').then(m => {
  // Should print: 1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00, 4.00, 5.00, 5.00
  [100,97,94,91,88,85,82,79,76,73,71,0].forEach(n => console.log(n, m.gradeInfo(n).eq))
})
```

Expected output:
```
100 1.00
97  1.25
94  1.50
91  1.75
88  2.00
85  2.25
82  2.50
79  2.75
76  3.00
73  4.00
71  5.00
0   5.00
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/grades.js
git commit -m "fix: update grade scale to strict min/max ranges per school grading table"
```

---

## Task 2: Fix `equivIF()` formula in `src/export/excelExport.js`

**Files:**
- Modify: `src/export/excelExport.js:46-58` (equivIF function)
- Modify: `src/export/excelExport.js:396-418` (instructions sheet grade scale text)

The current `equivIF` uses `>99`, `>95`, `>92`… which are off-by-one. The new formula must use `>=99`, `>=96`, `>=93`, etc., and `>=72` for 4.00, otherwise 5.00.

- [ ] **Step 1: Replace `equivIF()` function**

Replace lines 46–59 in `src/export/excelExport.js` with:

```js
function equivIF(ref) {
  return (
    `IF(${ref}="","—",` +
    `IF(${ref}>=99,"1.00",` +
    `IF(${ref}>=96,"1.25",` +
    `IF(${ref}>=93,"1.50",` +
    `IF(${ref}>=90,"1.75",` +
    `IF(${ref}>=87,"2.00",` +
    `IF(${ref}>=84,"2.25",` +
    `IF(${ref}>=81,"2.50",` +
    `IF(${ref}>=78,"2.75",` +
    `IF(${ref}>=75,"3.00",` +
    `IF(${ref}>=72,"4.00","5.00")))))))))))`
  )
}
```

- [ ] **Step 2: Update instructions sheet grade scale text**

Find and replace the grade scale lines in `exportGradingSheet` (around line 401–403):

Old:
```js
    ['  >99 → 1.00 | >95 → 1.25 | >92 → 1.50 | >89 → 1.75 | >86 → 2.00'],
    ['  >83 → 2.25 | >80 → 2.50 | >77 → 2.75 | >74 → 3.00 | ≥71 → 4.00 | <71 → 5.00'],
```

New:
```js
    ['  99–100 → 1.00 | 96–98 → 1.25 | 93–95 → 1.50 | 90–92 → 1.75 | 87–89 → 2.00'],
    ['  84–86 → 2.25 | 81–83 → 2.50 | 78–80 → 2.75 | 75–77 → 3.00 | 72–74 → 4.00 | ≤71 → 5.00'],
```

- [ ] **Step 3: Commit**

```bash
git add src/export/excelExport.js
git commit -m "fix: update Excel equivIF formula and instructions to match corrected grade scale"
```

---

## Task 3: Fix badge-color thresholds in `src/components/admin/tabs/GradesTab.jsx`

**Files:**
- Modify: `src/components/admin/tabs/GradesTab.jsx`

The file has several inline comparisons that use old boundaries. The old logic was:
- Pass: `>= 75` ✓ (unchanged — 3.00 still starts at 75)
- Conditional: `> 71` → must become `>= 72` (4.00 now starts at 72)
- Fail: `<= 71` → now `< 72`

Search for these patterns and fix them:

- [ ] **Step 1: Fix midterm badge color (line ~774)**

Old:
```js
const midBadgeCls = midG != null ? (midG >= 75 ? 'green' : midG > 71 ? 'yellow' : 'red') : 'gray'
```

New:
```js
const midBadgeCls = midG != null ? (midG >= 75 ? 'green' : midG >= 72 ? 'yellow' : 'red') : 'gray'
```

- [ ] **Step 2: Fix finals badge color (line ~779)**

Old:
```js
const finBadgeCls = finG != null ? (finG >= 75 ? 'green' : finG > 71 ? 'yellow' : 'red') : 'gray'
```

New:
```js
const finBadgeCls = finG != null ? (finG >= 75 ? 'green' : finG >= 72 ? 'yellow' : 'red') : 'gray'
```

- [ ] **Step 3: Fix the passing/failing distribution stats (line ~634)**

Old:
```js
const passing = completeGrades.filter(s => s.grades?.[sub] != null && s.grades[sub] >= 75).length
const failing  = completeGrades.filter(s => s.grades?.[sub] != null && s.grades[sub] < 75).length
```

This uses `grades[sub]` which is the raw final grade **percentage** (e.g. 82.5), not the equivalency. The threshold of 75% corresponds to the lowest Passed score. No change needed here — 75 is still the boundary for 3.00 (Passed).

- [ ] **Step 4: Fix exam badge in student GradesTab (admin view, line ~299)**

In `src/components/admin/tabs/GradesTab.jsx` look for the inline badge in the exam section around line 299:

Old:
```js
<span className={`badge ${midG >= 75 ? 'badge-green' : midG > 71 ? 'badge-yellow' : 'badge-red'}`}>
```

This is actually in the **student** GradesTab. Check both files.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/tabs/GradesTab.jsx
git commit -m "fix: update badge-color thresholds to match new grade scale (Conditional starts at 72)"
```

---

## Task 4: Fix badge-color thresholds in `src/components/student/tabs/GradesTab.jsx`

**Files:**
- Modify: `src/components/student/tabs/GradesTab.jsx`

- [ ] **Step 1: Fix midterm exam badge color (line ~299)**

Old:
```js
<span className={`badge ${midG >= 75 ? 'badge-green' : midG > 71 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(midG, eqScale).eq}</span>
```

New:
```js
<span className={`badge ${midG >= 75 ? 'badge-green' : midG >= 72 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(midG, eqScale).eq}</span>
```

- [ ] **Step 2: Fix finals exam badge color (line ~307)**

Old:
```js
<span className={`badge ${finG >= 75 ? 'badge-green' : finG > 71 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(finG, eqScale).eq}</span>
```

New:
```js
<span className={`badge ${finG >= 75 ? 'badge-green' : finG >= 72 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(finG, eqScale).eq}</span>
```

- [ ] **Step 3: Fix Bar component color threshold (line ~54)**

Old:
```js
const color = pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'
```

The `Bar` component colors bars for Activities, Quizzes, Attendance, Midterm, Finals. These are raw percentage scores, not grade equivalencies. The school's passing percentage boundary is 75, so this is correct. No change needed.

- [ ] **Step 4: Commit**

```bash
git add src/components/student/tabs/GradesTab.jsx
git commit -m "fix: update student grade tab badge-color thresholds to match new grade scale"
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify grade scale lookup in Admin → Grades**

Log in as admin. Open Grades tab, select a class and subject. Open Edit Grades modal. Enter `72` in Finals Exam for a student — the Equiv preview should show `4.00`. Enter `71` — should show `5.00`. Enter `75` — should show `3.00`. Enter `99` — should show `1.00`. Enter `96` — should show `1.25`.

- [ ] **Step 3: Verify Excel export formula**

Click "Template" to export a blank grading sheet. Open the downloaded XLSX in Excel/LibreOffice. In the Grading Sheet tab, enter a score of `72` in the Midterm Term column for a student — the Midterm Equiv cell should compute to `4.00`. Enter `71` — should compute to `5.00`.

- [ ] **Step 4: Verify student view**

Log in as a student with a grade between 72–74. Open Grades tab. The badge should show yellow (Conditional), not red (Failed).

- [ ] **Step 5: Final commit**

```bash
git add -p
git commit -m "fix: complete grade scale propagation — scale, formula, badge colors all consistent"
```
