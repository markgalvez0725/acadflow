---
name: UI Redesign + Skeleton Loading
description: Full Option B redesign — new calm/academic teal palette, floating toggleable nav, polished shared components, skeleton loading across all tabs
type: project
---

# UI Redesign + Skeleton Loading

## Goal

Two parallel improvements delivered together:
1. **Visual redesign** — new color system, floating toggleable navigation, refined cards/tables/buttons
2. **Skeleton loading** — shimmer screens across every data tab replacing "Loading…" text

## Part 1 — Visual Redesign (Option B)

### Color System

Full palette refresh via CSS custom properties in `globals.css`. Calm & academic tone, teal/sage accent.

**Light mode:**
```css
--bg:      #f8faf9   /* warm off-white */
--bg2:     #eef2f0   /* subtle card bg */
--bg3:     #e2ebe6   /* borders, dividers */
--ink:     #1a2e25   /* primary text */
--ink2:    #4a6358   /* secondary text */
--ink3:    #7a9e8e   /* muted/placeholder */
--accent:  #0d9488   /* teal-600 */
--accent2: #0f766e   /* teal-700, hover */
--accent3: #ccfbf1   /* teal-100, subtle bg */
--danger:  #dc2626
--warn:    #d97706
--ok:      #16a34a
```

**Dark mode** (`[data-theme="dark"]`):
```css
--bg:      #0f1a17
--bg2:     #162420
--bg3:     #1e332c
--ink:     #e8f5f0
--ink2:    #9dbfb3
--ink3:    #5a8c7e
--accent:  #14b8a6   /* teal-500, brighter on dark */
--accent2: #0d9488
--accent3: #134e4a
```

### Typography

- Base font: `Inter` (already loaded or add via Google Fonts)
- Scale tightened: heading sizes reduced 1 step, body line-height `1.6`
- `font-feature-settings: 'cv11', 'ss01'` on body for cleaner numerals

### Floating Navigation

**Admin — floating sidebar:**
- Default state: icon-only (48px wide), pill-shaped, floating left with `position: fixed`, `top: 50%`, `transform: translateY(-50%)`
- Expanded state: 200px wide, shows icon + label, triggered by hover or toggle button
- Toggle button: chevron pill at bottom of sidebar
- Mobile: becomes a bottom floating action bar (same as student)
- CSS classes: `.admin-sidenav`, `.admin-sidenav.expanded`

**Student — floating bottom nav:**
- Current bottom nav becomes floating pill: `position: fixed`, `bottom: 16px`, `left: 50%`, `transform: translateX(-50%)`
- Pill shape: `border-radius: 24px`, backdrop blur, subtle shadow
- Active item: teal background pill indicator
- Toggle: tap avatar to collapse to icon-only mini pill
- CSS classes: `.student-bottom-nav` refactored to `.student-floatnav`

### Shared Component Refinements

**Cards** (`.card`, `.stat-card`):
- `border-radius: 12px`, `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`
- Border: `1px solid var(--bg3)`
- Hover: subtle lift `translateY(-1px)`, shadow increase

**Tables** (`.data-table`):
- Header: `background: var(--bg2)`, `font-weight: 600`, `font-size: 0.75rem`, uppercase tracking
- Row hover: `background: var(--accent3)` at 40% opacity
- Zebra striping removed — rely on hover instead

**Buttons**:
- Primary: `background: var(--accent)`, `border-radius: 8px`, `font-weight: 600`
- Secondary: `border: 1.5px solid var(--bg3)`, transparent bg
- Hover transitions: `120ms ease`

**Inputs / Selects**:
- `border: 1.5px solid var(--bg3)`, `border-radius: 8px`
- Focus: `border-color: var(--accent)`, `box-shadow: 0 0 0 3px var(--accent3)`

**Topbar** (admin + student):
- Height reduced to `52px`
- Background: `var(--bg2)` with `backdrop-filter: blur(8px)`
- Subtle bottom border `var(--bg3)`

---

## Part 2 — Skeleton Loading

### Pattern

Single consistent guard in every tab:
```jsx
if (!fbReady) return <SkeletonXxx />
```
Follows existing `StreamTab` reference implementation.

### Extend `SkeletonLoader.jsx`

Add to `src/components/primitives/SkeletonLoader.jsx`:
- `SkeletonTable` — thead row + 5 body rows, 4 columns
- `SkeletonDashboard` — 4 stat cards + bar placeholder + 5 table rows

### Admin Tabs

| Tab | Skeleton |
|-----|---------|
| `DashboardTab` | `SkeletonDashboard` |
| `StudentsTab` | `SkeletonTable` |
| `GradesTab` | `SkeletonTable` |
| `AttendanceTab` | `SkeletonTable` |
| `ActivitiesTab` | `SkeletonTable` |
| `QuizTab` | `SkeletonTable` |
| `NotificationsTab` | `SkeletonRows` |
| `CalendarTab` | `SkeletonRows` |
| `StreamTab` | already done |

### Student Tabs

| Tab | Skeleton |
|-----|---------|
| `OverviewTab` | `SkeletonDashboard` |
| `GradesTab` | `SkeletonTable` |
| `AttendanceTab` | `SkeletonTable` |
| `ActivitiesTab` | `SkeletonTable` |
| `QuizTab` | `SkeletonRows` |
| `NotificationsTab` | `SkeletonRows` |
| `CalendarTab` | `SkeletonRows` |
| `StreamTab` | `SkeletonRows` |

### Layout Suspense Fallbacks

- `AdminLayout`: text → `<SkeletonRows />`
- `StudentLayout`: text → `<SkeletonRows />`; `!student` spinner → `<SkeletonDashboard />`

---

## What's Not Changing

- Routing, tab structure, Firebase logic — untouched
- `DataContext`, `AuthContext`, `UIContext` — untouched
- Tab component logic — only the loading guard is added
- Admin `StreamTab` skeleton — already correct, left as-is

## Implementation Order

1. CSS variables + typography (globals.css)
2. Floating nav — AdminSidebar refactor
3. Floating nav — StudentLayout bottom nav refactor
4. Shared component styles (cards, tables, buttons, inputs, topbar)
5. SkeletonLoader.jsx — add SkeletonTable + SkeletonDashboard
6. Admin tabs — add skeleton guards
7. Student tabs — add skeleton guards
8. Layout Suspense fallbacks

## Success Criteria

1. New teal/academic palette renders correctly in light + dark mode
2. Admin sidebar floats, collapses to icon-only, expands on hover/toggle
3. Student bottom nav is a floating pill with active indicator
4. All shared components (cards, tables, buttons, inputs) use new styles
5. Every tab shows shimmer skeleton while `fbReady === false`
6. Suspense boundaries show skeleton, not text
7. No regressions in existing functionality
