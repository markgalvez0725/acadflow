# Grade Scale & Computation Fix

**Date:** 2026-04-16  
**File affected:** `src/utils/grades.js`

## Problem

`DEFAULT_EQ_SCALE` uses off-by-one `minScore` thresholds that don't match the school's official grading table. The `gradeInfo()` lookup also uses a waterfall (`score >= minScore`) instead of strict min/max ranges.

## Correct Grading Table

| Equiv | Min Score | Max Score |
|-------|-----------|-----------|
| 1.00  | 99        | 100       |
| 1.25  | 96        | 98        |
| 1.50  | 93        | 95        |
| 1.75  | 90        | 92        |
| 2.00  | 87        | 89        |
| 2.25  | 84        | 86        |
| 2.50  | 81        | 83        |
| 2.75  | 78        | 80        |
| 3.00  | 75        | 77        |
| 4.00  | 72        | 74        |
| 5.00  | ≤ 71 (Failed) |       |

## Grade Computation Formula (confirmed correct, no change needed)

```
Midterm Class Standing = AVERAGE(activities, quizzes, attendance)  — nulls skipped
Midterm               = AVERAGE(Midterm Class Standing, Midterm Exam)

Final Class Standing  = AVERAGE(activities, quizzes, attendance)   — nulls skipped
Finals                = AVERAGE(Final Class Standing, Final Exam)

Final Grade           = AVERAGE(Midterm, Finals)
```

`computeGrade()` already implements this correctly.

## Changes

1. **`DEFAULT_EQ_SCALE`** — update `minScore` values and add `maxScore` to each tier.
2. **`gradeInfo()`** — change lookup from waterfall (`g >= tier.minScore`) to strict range (`g >= tier.minScore && g <= tier.maxScore`).
