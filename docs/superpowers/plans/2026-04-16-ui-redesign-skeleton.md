# UI Redesign + Skeleton Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current blue/navy palette with a calm teal/academic palette, convert admin sidebar and student bottom nav to floating toggleable navigation, refine shared component styles, and add shimmer skeleton loading to every data tab.

**Architecture:** CSS-variable-first approach — swap the design tokens in `globals.css` so all existing components inherit the new palette automatically, then layer on structural nav changes and skeleton guards. No routing, Firebase, or context changes.

**Tech Stack:** React 19, Tailwind CSS v4, plain CSS custom properties in `globals.css`, lucide-react icons, existing `.sk-*` shimmer CSS.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/styles/globals.css` | Modify | Swap all CSS variables to teal/academic palette; refine card, table, button, input, topbar styles; add floating nav CSS; update skeleton dark-mode override |
| `src/components/primitives/SkeletonLoader.jsx` | Modify | Add `SkeletonTable` and `SkeletonDashboard` exports |
| `src/components/admin/AdminSidebar.jsx` | Modify | Convert to floating collapsible sidebar (icon-only ↔ expanded) |
| `src/components/admin/AdminLayout.jsx` | Modify | Wire sidebar collapsed state; swap Suspense fallback to `<SkeletonRows />` |
| `src/components/student/StudentLayout.jsx` | Modify | Convert bottom nav to floating pill; swap Suspense + `!student` fallbacks to skeletons |
| `src/components/admin/tabs/DashboardTab.jsx` | Modify | Add `!fbReady` → `<SkeletonDashboard />` guard |
| `src/components/admin/tabs/StudentsTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/admin/tabs/GradesTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/admin/tabs/AttendanceTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/admin/tabs/ActivitiesTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/admin/tabs/QuizTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/admin/tabs/NotificationsTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |
| `src/components/admin/tabs/CalendarTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |
| `src/components/admin/tabs/ClassesTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/student/tabs/OverviewTab.jsx` | Modify | Add `!fbReady` → `<SkeletonDashboard />` guard |
| `src/components/student/tabs/GradesTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/student/tabs/AttendanceTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/student/tabs/ActivitiesTab.jsx` | Modify | Add `!fbReady` → `<SkeletonTable />` guard |
| `src/components/student/tabs/QuizTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |
| `src/components/student/tabs/NotificationsTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |
| `src/components/student/tabs/CalendarTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |
| `src/components/student/tabs/StreamTab.jsx` | Modify | Add `!fbReady` → `<SkeletonRows />` guard |

---

## Task 1: Swap CSS Design Tokens (Palette + Typography)

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Replace `:root` color variables**

In `globals.css`, find the `:root` block. Replace all existing color/shadow/font variables with:

```css
:root {
  /* Palette — calm academic teal */
  --bg:        #f8faf9;
  --bg2:       #eef2f0;
  --surface:   #ffffff;
  --surface2:  #f3f7f5;
  --ink:       #1a2e25;
  --ink2:      #4a6358;
  --ink3:      #7a9e8e;
  --accent:    #0d9488;
  --accent-l:  #ccfbf1;
  --accent-m:  #0f766e;
  --border:    #d1e0db;
  --border2:   #b8d0c8;

  /* Status */
  --red:       #dc2626;
  --red-l:     #fef2f2;
  --green:     #16a34a;
  --green-l:   #f0fdf4;
  --yellow:    #d97706;
  --yellow-l:  #fffbeb;
  --purple:    #7c3aed;
  --purple-l:  #f5f3ff;
  --gold-var:  #b45309;
  --gold-l:    #fffbeb;

  /* Layout */
  --sidebar-w: 220px;
  --sidebar-collapsed-w: 60px;
  --radius:    10px;
  --radius-lg: 16px;
  --shadow:    0 1px 3px rgba(13,47,37,.06), 0 4px 14px rgba(13,47,37,.08);
  --shadow-lg: 0 8px 28px rgba(13,47,37,.14);

  /* Typography */
  --font-display: 'DM Serif Display', Georgia, serif;
  --font-body:    'Inter', system-ui, sans-serif;
}
```

- [ ] **Step 2: Replace dark theme variables**

Find `[data-theme="dark"]` block. Replace with:

```css
[data-theme="dark"] {
  --bg:        #0f1a17;
  --bg2:       #162420;
  --surface:   #1a2e28;
  --surface2:  #1e3530;
  --ink:       #e8f5f0;
  --ink2:      #9dbfb3;
  --ink3:      #5a8c7e;
  --accent:    #14b8a6;
  --accent-l:  rgba(20,184,166,.15);
  --accent-m:  #0d9488;
  --border:    rgba(255,255,255,.09);
  --border2:   rgba(255,255,255,.15);
  --red-l:     rgba(220,38,38,.15);
  --green-l:   rgba(22,163,74,.15);
  --yellow-l:  rgba(217,119,6,.15);
  --purple-l:  rgba(124,58,237,.15);
  --gold-l:    rgba(180,83,9,.15);
}
```

- [ ] **Step 3: Update dark skeleton override**

Find `[data-theme="dark"] .sk` rule. Update to use new dark vars:

```css
[data-theme="dark"] .sk {
  background: linear-gradient(
    90deg,
    var(--bg2) 0px,
    var(--surface2) 40px,
    var(--bg2) 80px
  );
  background-size: 600px 100%;
  animation: sk-shimmer 1.4s infinite linear;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: swap CSS palette to calm teal/academic theme"
```

---

## Task 2: Refine Shared Component Styles

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Update base body/font styles**

Find the `body` rule in `@layer base`. Update:

```css
body {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
  background: var(--bg);
  font-feature-settings: 'cv11', 'ss01';
}
```

- [ ] **Step 2: Update card component styles**

Find `.card` in `@layer components`. Update (or add if missing):

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
  transition: box-shadow 150ms ease, transform 150ms ease;
}
.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: Update stat-card styles**

Find `.stat-card` (or `.stat-box`). Update:

```css
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-card .stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.1;
}
.stat-card .stat-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--ink3);
}
```

- [ ] **Step 4: Update table styles**

Find `.data-table` (or `table`). Update:

```css
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th {
  background: var(--bg2);
  color: var(--ink2);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--ink);
}
.data-table tbody tr:hover td {
  background: var(--accent-l);
}
```

- [ ] **Step 5: Update button styles**

Find `.btn`, `.btn-primary`, `.btn-secondary`:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease, transform 80ms ease;
  border: none;
  outline: none;
}
.btn:active { transform: scale(.97); }

.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover { background: var(--accent-m); }

.btn-secondary {
  background: transparent;
  color: var(--ink2);
  border: 1.5px solid var(--border2);
}
.btn-secondary:hover {
  background: var(--bg2);
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 6: Update input/select styles**

Find `input`, `select`, `textarea` rules:

```css
input, select, textarea {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 13px;
  padding: 8px 12px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-l);
}
```

- [ ] **Step 7: Update admin topbar**

Find `.admin-topbar`:

```css
.admin-topbar {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 20;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: refine shared component styles (cards, tables, buttons, inputs, topbar)"
```

---

## Task 3: Floating Admin Sidebar

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/components/admin/AdminSidebar.jsx`
- Modify: `src/components/admin/AdminLayout.jsx`

- [ ] **Step 1: Add floating sidebar CSS**

In `globals.css` inside `@layer components`, find `.sidebar-wrap` and replace with:

```css
/* Admin sidebar — floating collapsible */
.sidebar-wrap {
  position: fixed;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  transition: width 200ms ease;
  width: var(--sidebar-collapsed-w);
}
.sidebar-wrap.expanded {
  width: var(--sidebar-w);
}

/* Mobile: hidden by default, slide in as overlay */
@media (max-width: 767px) {
  .sidebar-wrap {
    left: 0;
    top: 0;
    transform: none;
    height: 100%;
    width: var(--sidebar-w);
    border-radius: 0;
    translate: -100%;
    transition: translate 200ms ease;
  }
  .sidebar-wrap.open {
    translate: 0;
  }
}

.sidebar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  height: 80vh;
  max-height: 640px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: width 200ms ease;
  width: 100%;
}

/* Desktop: adjust main content margin */
@media (min-width: 768px) {
  .admin-main {
    margin-left: calc(var(--sidebar-collapsed-w) + 24px);
    transition: margin-left 200ms ease;
  }
  .admin-main.sidebar-expanded {
    margin-left: calc(var(--sidebar-w) + 24px);
  }
}

/* Sidebar nav items — icon-only vs expanded */
.sb-nav .nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  margin: 2px 8px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  white-space: nowrap;
  overflow: hidden;
  color: var(--ink2);
  font-size: 13px;
  font-weight: 500;
}
.sb-nav .nav-item:hover {
  background: var(--bg2);
  color: var(--ink);
}
.sb-nav .nav-item.active {
  background: var(--accent-l);
  color: var(--accent);
  font-weight: 700;
}
.sb-nav .nav-item .nav-label {
  opacity: 0;
  transition: opacity 150ms ease;
  flex-shrink: 0;
}
.sidebar-wrap.expanded .sb-nav .nav-item .nav-label {
  opacity: 1;
}

/* Sidebar toggle button */
.sb-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg2);
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--ink2);
  margin: 8px auto;
  transition: background 120ms ease;
  flex-shrink: 0;
}
.sb-toggle:hover { background: var(--accent-l); color: var(--accent); }

/* Brand logo area */
.sb-brand {
  padding: 14px 12px 10px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  flex-shrink: 0;
}
.sb-brand .brand-label {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 150ms ease;
}
.sidebar-wrap.expanded .sb-brand .brand-label { opacity: 1; }

/* Nav group labels — hidden when collapsed */
.nav-group-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--ink3);
  padding: 8px 12px 4px;
  overflow: hidden;
  height: 0;
  opacity: 0;
  transition: height 150ms ease, opacity 150ms ease;
}
.sidebar-wrap.expanded .nav-group-label {
  height: auto;
  opacity: 1;
}

/* Footer area */
.sb-footer {
  border-top: 1px solid var(--border);
  padding: 10px 12px;
  margin-top: auto;
  flex-shrink: 0;
}
.sb-user {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.sb-user-info {
  opacity: 0;
  transition: opacity 150ms ease;
  white-space: nowrap;
}
.sidebar-wrap.expanded .sb-user-info { opacity: 1; }
```

- [ ] **Step 2: Update AdminSidebar.jsx to accept and use `collapsed` prop**

Read the current file first, then replace the component signature and add toggle support:

```jsx
// At top of AdminSidebar.jsx, update the default export signature:
export default function AdminSidebar({ onSettingsOpen, collapsed, onToggle }) {
```

Wrap each nav item label in a `<span className="nav-label">` so CSS can hide/show it:

```jsx
// In the nav item render (inside NAV_GROUPS.map):
<button
  key={item.id}
  className={`nav-item${adminTab === item.id ? ' active' : ''}`}
  onClick={() => setAdminTab(item.id)}
  title={item.label}
>
  <item.Icon size={18} style={{ flexShrink: 0 }} />
  <span className="nav-label">{item.label}</span>
  {badge > 0 && (
    <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>
  )}
</button>
```

Add toggle button at the bottom of the sidebar (before `</div>` closing `.sidebar`):

```jsx
<button className="sb-toggle" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
  {collapsed
    ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
  }
</button>
```

Wrap brand label text in `.brand-label` span:

```jsx
<div className="sb-brand">
  <span style={{ fontSize: 22, color: 'var(--accent)' }}>🎓</span>
  <span className="brand-label">AcadFlow</span>
</div>
```

- [ ] **Step 3: Update AdminLayout.jsx to manage sidebar collapsed state**

```jsx
// Add collapsed state after existing useState declarations:
const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
```

Update sidebar-wrap div to include `expanded` class and pass props:

```jsx
<div className={`sidebar-wrap${sidebarOpen ? ' open' : ''}${!sidebarCollapsed ? ' expanded' : ''}`}>
  <AdminSidebar
    onSettingsOpen={() => setSettingsOpen(true)}
    collapsed={sidebarCollapsed}
    onToggle={() => setSidebarCollapsed(c => !c)}
  />
</div>
```

Update admin-main div to include `sidebar-expanded` class:

```jsx
<div className={`admin-main${!sidebarCollapsed ? ' sidebar-expanded' : ''}`}>
```

- [ ] **Step 4: Verify dev server — admin sidebar collapses/expands**

```bash
npm run dev
```

Open `http://localhost:5173/admin` and verify:
- Sidebar shows icons only by default (collapsed)
- Clicking toggle chevron expands to show labels
- Nav items highlight correctly on click
- Mobile hamburger still works

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/components/admin/AdminSidebar.jsx src/components/admin/AdminLayout.jsx
git commit -m "feat: convert admin sidebar to floating collapsible nav"
```

---

## Task 4: Floating Student Bottom Nav

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/components/student/StudentLayout.jsx`

- [ ] **Step 1: Update student nav CSS to floating pill**

In `globals.css`, find `.student-bottom-nav` and replace with:

```css
.student-floatnav {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 28px;
  box-shadow: var(--shadow-lg);
  padding: 6px 8px;
  backdrop-filter: blur(12px);
  transition: padding 200ms ease, gap 200ms ease;
}
.student-floatnav.collapsed {
  gap: 0;
  padding: 6px;
}

.student-floatnav .nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 22px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  color: var(--ink3);
  flex-shrink: 0;
  border: none;
  background: none;
}
.student-floatnav .nav-item:hover {
  color: var(--ink);
}
.student-floatnav .nav-item.active {
  background: var(--accent-l);
  color: var(--accent);
}
.student-floatnav .nav-label {
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  max-width: 40px;
  transition: max-width 200ms ease, opacity 200ms ease;
  opacity: 1;
}
.student-floatnav.collapsed .nav-label {
  max-width: 0;
  opacity: 0;
}

/* Give body room for floating nav */
.student-body {
  padding-bottom: 90px;
}

/* Desktop: convert to left sidebar */
@media (min-width: 1024px) {
  .student-floatnav {
    bottom: unset;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    flex-direction: column;
    border-radius: 16px;
    padding: 8px 6px;
    gap: 2px;
  }
  .student-floatnav .nav-item {
    width: 100%;
    flex-direction: row;
    justify-content: flex-start;
    padding: 8px 12px;
    gap: 8px;
    border-radius: 10px;
  }
  .student-floatnav .nav-label {
    font-size: 12px;
    max-width: 0;
    opacity: 0;
  }
  .student-body {
    padding-bottom: 24px;
    margin-left: calc(60px + 24px);
  }
}
```

- [ ] **Step 2: Update StudentLayout.jsx nav class and add collapse toggle**

In `StudentLayout.jsx`, add collapsed state:

```jsx
const [navCollapsed, setNavCollapsed] = useState(false)
```

Replace `<nav className="student-bottom-nav">` with:

```jsx
<nav className={`student-floatnav${navCollapsed ? ' collapsed' : ''}`}>
```

Add a toggle button inside the nav (after the last nav item):

```jsx
<button
  className="nav-item"
  onClick={() => setNavCollapsed(c => !c)}
  title={navCollapsed ? 'Expand nav' : 'Collapse nav'}
  style={{ color: 'var(--ink3)' }}
>
  <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {navCollapsed
      ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    }
  </span>
</button>
```

- [ ] **Step 3: Verify dev server — student nav floats as pill**

```bash
npm run dev
```

Open student view. Verify:
- Bottom nav renders as centered floating pill
- Active tab has teal highlight
- Collapse toggle hides labels
- All 8 nav items accessible

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css src/components/student/StudentLayout.jsx
git commit -m "feat: convert student bottom nav to floating pill with collapse toggle"
```

---

## Task 5: Extend SkeletonLoader with Table + Dashboard Variants

**Files:**
- Modify: `src/components/primitives/SkeletonLoader.jsx`

- [ ] **Step 1: Read current SkeletonLoader.jsx**

Read `src/components/primitives/SkeletonLoader.jsx` to see current exports.

- [ ] **Step 2: Add SkeletonTable and SkeletonDashboard exports**

Add after the existing `SkeletonCard` export:

```jsx
export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {/* thead placeholder */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="sk" style={{ height: 28, flex: i === 0 ? 2 : 1, borderRadius: 6 }} />
        ))}
      </div>
      {/* tbody rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="sk" style={{ height: 40, flex: j === 0 ? 2 : 1, borderRadius: 8 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div style={{ padding: '8px 0' }}>
      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sk sk-stat" />
        ))}
      </div>
      {/* Bar chart placeholder */}
      <div className="sk-bar-wrap" style={{ marginBottom: 20 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="sk-bar" style={{ height: `${40 + Math.floor(i * 15)}px` }} />
        ))}
      </div>
      {/* Table rows */}
      <SkeletonTable rows={4} cols={4} />
    </div>
  )
}
```

Also update the default export router to include the new variants:

```jsx
export default function SkeletonLoader({ variant = 'rows', count }) {
  if (variant === 'stat-grid') return <SkeletonStatGrid count={count} />
  if (variant === 'card')      return <SkeletonCard count={count} />
  if (variant === 'table')     return <SkeletonTable rows={count} />
  if (variant === 'dashboard') return <SkeletonDashboard />
  return <SkeletonRows count={count} />
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/primitives/SkeletonLoader.jsx
git commit -m "feat: add SkeletonTable and SkeletonDashboard to SkeletonLoader"
```

---

## Task 6: Skeleton Guards — Admin Tabs

**Files:**
- Modify: `src/components/admin/tabs/DashboardTab.jsx`
- Modify: `src/components/admin/tabs/StudentsTab.jsx`
- Modify: `src/components/admin/tabs/GradesTab.jsx`
- Modify: `src/components/admin/tabs/AttendanceTab.jsx`
- Modify: `src/components/admin/tabs/ActivitiesTab.jsx`
- Modify: `src/components/admin/tabs/QuizTab.jsx`
- Modify: `src/components/admin/tabs/ClassesTab.jsx`
- Modify: `src/components/admin/tabs/NotificationsTab.jsx`
- Modify: `src/components/admin/tabs/CalendarTab.jsx`

For each tab, the pattern is identical:

1. Add the import at the top of the file
2. Destructure `fbReady` from `useData()`
3. Add the guard as the first thing in the component body

- [ ] **Step 1: DashboardTab.jsx**

Add import:
```jsx
import { SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
```

In `useData()` destructure, add `fbReady`:
```jsx
const { students, classes, fbReady, /* existing fields */ } = useData()
```

Add guard as first line after all hooks:
```jsx
if (!fbReady) return <SkeletonDashboard />
```

- [ ] **Step 2: StudentsTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 3: GradesTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 4: AttendanceTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 5: ActivitiesTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 6: QuizTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 7: ClassesTab.jsx**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 8: NotificationsTab.jsx (admin)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 9: CalendarTab.jsx (admin)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 10: Commit**

```bash
git add src/components/admin/tabs/
git commit -m "feat: add fbReady skeleton guards to all admin tabs"
```

---

## Task 7: Skeleton Guards — Student Tabs

**Files:**
- Modify: `src/components/student/tabs/OverviewTab.jsx`
- Modify: `src/components/student/tabs/GradesTab.jsx`
- Modify: `src/components/student/tabs/AttendanceTab.jsx`
- Modify: `src/components/student/tabs/ActivitiesTab.jsx`
- Modify: `src/components/student/tabs/QuizTab.jsx`
- Modify: `src/components/student/tabs/NotificationsTab.jsx`
- Modify: `src/components/student/tabs/CalendarTab.jsx`
- Modify: `src/components/student/tabs/StreamTab.jsx`

- [ ] **Step 1: OverviewTab.jsx**

Add import:
```jsx
import { SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard as first line after all hooks:
```jsx
if (!fbReady) return <SkeletonDashboard />
```

- [ ] **Step 2: GradesTab.jsx (student)**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 3: AttendanceTab.jsx (student)**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 4: ActivitiesTab.jsx (student)**

Add import:
```jsx
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonTable />
```

- [ ] **Step 5: QuizTab.jsx (student)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 6: NotificationsTab.jsx (student)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 7: CalendarTab.jsx (student)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure.

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 8: StreamTab.jsx (student)**

Add import:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Add `fbReady` to `useData()` destructure (if not already present).

Add guard:
```jsx
if (!fbReady) return <SkeletonRows />
```

- [ ] **Step 9: Commit**

```bash
git add src/components/student/tabs/
git commit -m "feat: add fbReady skeleton guards to all student tabs"
```

---

## Task 8: Fix Layout Suspense Fallbacks

**Files:**
- Modify: `src/components/admin/AdminLayout.jsx`
- Modify: `src/components/student/StudentLayout.jsx`

- [ ] **Step 1: AdminLayout.jsx — add SkeletonRows import and swap fallback**

Add import at top:
```jsx
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
```

Find the Suspense fallback in the admin body:
```jsx
<Suspense fallback={<div className="text-ink2 text-sm py-4">Loading…</div>}>
```

Replace with:
```jsx
<Suspense fallback={<SkeletonRows />}>
```

- [ ] **Step 2: StudentLayout.jsx — swap both fallbacks**

Add import at top:
```jsx
import { SkeletonRows, SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
```

Replace the tab Suspense fallback:
```jsx
// Find:
<Suspense fallback={<div className="text-ink2 text-sm py-8 text-center">Loading…</div>}>
// Replace with:
<Suspense fallback={<SkeletonRows />}>
```

Replace the `!student` early return:
```jsx
// Find:
if (!student) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bg">
      <div className="text-ink2 text-sm">Loading…</div>
    </div>
  )
}
// Replace with:
if (!student) {
  return (
    <div style={{ padding: 24 }}>
      <SkeletonDashboard />
    </div>
  )
}
```

- [ ] **Step 3: Verify no regressions**

```bash
npm run dev
```

Check both admin and student views:
- Admin tabs load with shimmer while Firebase initializes
- Student tabs load with shimmer
- No "Loading…" text visible anywhere during load

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminLayout.jsx src/components/student/StudentLayout.jsx
git commit -m "feat: replace Suspense text fallbacks with skeleton components"
```

---

## Task 9: Final Polish + Push

**Files:**
- Modify: `src/styles/globals.css` (minor tweaks if needed)

- [ ] **Step 1: Add nav badge CSS for sidebar**

In `globals.css`, add inside `@layer components`:

```css
.nav-badge {
  margin-left: auto;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 10px;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
  line-height: 14px;
  opacity: 0;
  transition: opacity 150ms ease;
}
.sidebar-wrap.expanded .nav-badge { opacity: 1; }
```

- [ ] **Step 2: Ensure Google Font is loaded**

In `index.html`, verify or add in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build completes with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "feat: UI redesign — teal palette, floating nav, skeleton loading complete"
git push
```
