# Stream Tab — Pagination, Grouping & Skeleton Loading

**Date:** 2026-04-16  
**Scope:** Admin and Student `StreamTab.jsx` components

---

## Problem

Both Stream tabs render all data in a single flat list with no limit. With many students, subjects, activities, and attendance records, this can produce hundreds of cards at once — causing slow renders and a poor UX.

---

## Solution Overview

- **Client-side pagination** — 10 items per page, sliced from the already-loaded in-memory arrays
- **Date grouping** — cosmetic group headers (Today / Yesterday / This Week / Earlier) between cards in the stream feed
- **Skeleton loading** — shimmer placeholder cards shown while `fbReady` is `false`
- Applies to **both** admin and student `StreamTab.jsx`

---

## Pagination

### Page size
`PAGE_SIZE = 10` — constant defined at the top of each file.

### Announcements section (admin StreamTab only)
- New state: `const [annPage, setAnnPage] = useState(0)`
- Displayed slice: `sortedAnnouncements.slice(annPage * PAGE_SIZE, (annPage + 1) * PAGE_SIZE)`
- Reset `annPage` to `0` whenever `filterClass` changes (via `useEffect` or inline on filter change handler)
- Pagination controls rendered below the announcements list

### Stream feed (both tabs)
- New state: `const [streamPage, setStreamPage] = useState(0)`
- Displayed slice: `streamItems.slice(streamPage * PAGE_SIZE, (streamPage + 1) * PAGE_SIZE)`
- Reset `streamPage` to `0` whenever `filterClass` or `filterType` changes
- Pagination controls rendered below the stream feed

### Pagination controls component
A shared `Pagination` component rendered inline (not extracted to a separate file — used only in these two files):

```
[← Prev]   Showing 1–10 of 47   [Next →]
```

Props: `{ page, total, pageSize, onPrev, onNext }`  
- "Showing X–Y of Z" label where X = `page * pageSize + 1`, Y = `min((page+1) * pageSize, total)`
- Prev disabled when `page === 0`
- Next disabled when `(page + 1) * PAGE_SIZE >= total`
- Styled with existing `btn btn-ghost btn-sm` classes

---

## Date Grouping

Groups are computed from `item.ts` at render time — no change to data structure.

### Group labels
| Condition | Label |
|-----------|-------|
| Same calendar day as today | `Today` |
| Yesterday | `Yesterday` |
| Within last 7 days | Day name, e.g. `Monday` |
| Older | `MMM D, YYYY` e.g. `Apr 10, 2026` |

### Rendering
The paginated slice is iterated. Before rendering each card, compare its group label to the previous card's group label. If different, insert a `<div className="stream-date-group">` header before the card.

A `getGroupLabel(ts)` helper function is added to each file.

Grouping applies to the **stream feed only** (not the announcements section, which already has date metadata on each card).

---

## Skeleton Loading

### Trigger
Show skeletons when `fbReady === false` (from `useData()`).

### `StreamSkeleton` component
Renders 3 placeholder cards with shimmer animation. Defined inline in each StreamTab file.

Each skeleton card mimics the real card layout:
- Header row: short shimmer block (badge) + right-aligned time shimmer
- Title row: wider shimmer block
- Body row: two small shimmer blocks side by side
- Footer row: narrow shimmer block

### CSS
Shimmer animation added via a `<style>` tag injected once per file or via existing global CSS if a shimmer class already exists:

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.shimmer {
  background: linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
  border-radius: 6px;
}
```

### Placement
- In **admin StreamTab**: replace the entire tab body (both sections) with `<StreamSkeleton />` when `!fbReady`
- In **student StreamTab**: replace the stream feed section with `<StreamSkeleton />` when `!fbReady`

---

## Files Changed

| File | Changes |
|------|---------|
| `src/components/admin/tabs/StreamTab.jsx` | Add `PAGE_SIZE`, `annPage`/`streamPage` state, `Pagination` component, `StreamSkeleton`, `getGroupLabel`, date group headers, shimmer CSS |
| `src/components/student/tabs/StreamTab.jsx` | Add `PAGE_SIZE`, `streamPage` state, `Pagination` component, `StreamSkeleton`, `getGroupLabel`, date group headers, shimmer CSS |

No new files. No changes to DataContext, Firebase, or other components.

---

## Out of Scope

- URL-based pagination (AcadFlow uses tab-state navigation only)
- Infinite scroll / virtualization
- Server-side pagination
- Changing page size dynamically
