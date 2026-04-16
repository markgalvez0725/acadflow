---
name: UI Skeleton Loading & UX Enhancement
description: Add skeleton loading states across all admin and student tabs using fbReady gate; upgrade Suspense fallbacks; extend SkeletonLoader utility
type: project
---

# UI Skeleton Loading & UX Enhancement

## Goal

Replace all "Loading…" text placeholders with polished skeleton screens across every data view in AcadFlow. Use the existing shimmer CSS and SkeletonLoader utility (currently unused) as the foundation.

## Approach: Tab-by-Tab Skeleton Guards (Option A)

Single consistent pattern throughout the app:

```jsx
if (!fbReady) return <SkeletonXxx />
```

Applied to every tab that renders data. Follows the existing `StreamTab` pattern (only tab with a real skeleton today).

## Scope

### 1. Extend `SkeletonLoader.jsx`

Add two new exports to the existing file (`src/components/primitives/SkeletonLoader.jsx`):

- `SkeletonTable` — header row + 5 body rows using `.sk-row` + `.sk` cells
- `SkeletonDashboard` — 4 stat cards (`.sk-stat`) + bar placeholder + table rows

Existing exports (`SkeletonRows`, `SkeletonCard`, `SkeletonStatGrid`) remain unchanged.

### 2. Admin Tabs — add `!fbReady` guard

| Tab | Skeleton Variant |
|-----|-----------------|
| `DashboardTab` | `SkeletonDashboard` |
| `StudentsTab` | `SkeletonTable` |
| `GradesTab` | `SkeletonTable` |
| `AttendanceTab` | `SkeletonTable` |
| `ActivitiesTab` | `SkeletonTable` |
| `QuizTab` | `SkeletonTable` |
| `NotificationsTab` | `SkeletonRows` |
| `CalendarTab` | `SkeletonRows` |
| `StreamTab` | already done — no change |

### 3. Student Tabs — add `!fbReady` guard

| Tab | Skeleton Variant |
|-----|-----------------|
| `OverviewTab` | `SkeletonDashboard` |
| `GradesTab` | `SkeletonTable` |
| `AttendanceTab` | `SkeletonTable` |
| `ActivitiesTab` | `SkeletonTable` |
| `QuizTab` | `SkeletonRows` |
| `NotificationsTab` | `SkeletonRows` |
| `CalendarTab` | `SkeletonRows` |
| `StreamTab` | `SkeletonRows` |

### 4. Layout Suspense Fallbacks

- `AdminLayout`: replace `<div className="text-ink2 text-sm py-4">Loading…</div>` → `<SkeletonRows />`
- `StudentLayout`: replace text fallback → `<SkeletonRows />`; replace `!student` spinner → `<SkeletonDashboard />`

### 5. CSS (if needed)

Add `.sk-cell` and `.sk-thead` variants to `globals.css` inside `@layer components` if the table skeleton requires column-width fidelity beyond what `.sk-row` provides.

## What's Not Changing

- No routing changes
- No new Firebase collections or listeners
- No changes to existing skeleton CSS keyframes (`sk-shimmer`)
- Admin `StreamTab` skeleton left as-is (already correct)
- No changes to `DataContext`, `AuthContext`, or `UIContext`

## Success Criteria

1. Every tab shows a shimmer skeleton (not text) while `fbReady === false`
2. Skeleton shape roughly matches the real content layout for each tab type
3. `Suspense` lazy-load boundaries also show skeleton, not "Loading…" text
4. Dark mode skeletons render correctly (existing CSS already handles this)
5. No regressions in existing functionality
