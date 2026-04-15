# Stream Tab Pagination & Skeleton Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10-item client-side pagination, date grouping, and shimmer skeleton loading to both admin and student StreamTab components.

**Architecture:** All data is already in memory via DataContext real-time listeners. We slice the existing `streamItems` and `sortedAnnouncements` arrays using page state. Skeleton loading uses `fbReady` from DataContext. Date grouping is cosmetic — computed at render time from item timestamps.

**Tech Stack:** React 19, Tailwind CSS v4, existing DataContext (`fbReady`, stream data arrays)

---

### Task 1: Add skeleton loading + pagination to admin StreamTab

**Files:**
- Modify: `src/components/admin/tabs/StreamTab.jsx`

- [ ] **Step 1: Add shimmer CSS, StreamSkeleton component, PAGE_SIZE constant, and helper functions**

At the top of the file, after the existing imports, add:

```jsx
const PAGE_SIZE = 10

function getGroupLabel(ts) {
  if (!ts) return 'Earlier'
  const now = new Date()
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today - itemDay) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString('en-PH', { weekday: 'long' })
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const shimmerStyle = {
  background: 'linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%)',
  backgroundSize: '800px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
}

function StreamSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="stream-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ ...shimmerStyle, width: 80, height: 18 }} />
            <div style={{ ...shimmerStyle, width: 50, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: '70%', height: 18 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...shimmerStyle, width: 90, height: 14 }} />
            <div style={{ ...shimmerStyle, width: 70, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: 120, height: 12 }} />
        </div>
      ))}
    </>
  )
}

function Pagination({ page, total, pageSize, onPrev, onNext }) {
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'var(--ink2)' }}>
      <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={page === 0}>← Prev</button>
      <span>Showing {from}–{to} of {total}</span>
      <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={to >= total}>Next →</button>
    </div>
  )
}
```

- [ ] **Step 2: Add page state variables and reset logic in the StreamTab component**

Inside the `export default function StreamTab()` body, after existing state declarations, add:

```jsx
const [annPage, setAnnPage] = useState(0)
const [streamPage, setStreamPage] = useState(0)
```

Replace the existing `filterClass` and `filterType` onChange handlers so they also reset pages. Find:

```jsx
onChange={e => setFilterClass(e.target.value)}
```

Replace with:

```jsx
onChange={e => { setFilterClass(e.target.value); setAnnPage(0); setStreamPage(0) }}
```

Find:

```jsx
onChange={e => setFilterType(e.target.value)}
```

Replace with:

```jsx
onChange={e => { setFilterType(e.target.value); setStreamPage(0) }}
```

- [ ] **Step 3: Apply skeleton loading to the tab body**

At the top of the return statement, before the existing `<div style={{ maxWidth: 720 ... }}>`, add a guard:

```jsx
const { fbReady } = useData()   // add fbReady to the existing useData() destructure at the top of the component
```

Update the `useData()` destructure line from:

```jsx
const { classes, students, activities, quizzes, announcements, saveAnnouncement, deleteAnnouncement } = useData()
```

to:

```jsx
const { classes, students, activities, quizzes, announcements, saveAnnouncement, deleteAnnouncement, fbReady } = useData()
```

Then, as the first thing inside the return, before the announcements section `<div>`, add:

```jsx
if (!fbReady) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StreamSkeleton />
    </div>
  )
}
```

- [ ] **Step 4: Paginate the announcements section**

Find the announcements list render. Replace:

```jsx
{sortedAnnouncements.map(ann => {
```

with:

```jsx
{sortedAnnouncements.slice(annPage * PAGE_SIZE, (annPage + 1) * PAGE_SIZE).map(ann => {
```

After the closing `</div>` of the announcements list (just before the `{/* Divider */}` comment), add:

```jsx
<Pagination page={annPage} total={sortedAnnouncements.length} pageSize={PAGE_SIZE} onPrev={() => setAnnPage(p => p - 1)} onNext={() => setAnnPage(p => p + 1)} />
```

- [ ] **Step 5: Paginate the stream feed with date grouping**

Replace the stream feed render block:

```jsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
  {streamItems.map(item => {
    const classObj = getClassObj(item)
    if (item.type === 'announcement') return <AnnouncementCard key={item.id} item={item} classObj={classObj} />
    if (item.type === 'activity') return <ActivityCard key={item.id} item={item} classObj={classObj} students={students} />
    if (item.type === 'quiz') return <QuizCard key={item.id} item={item} classObj={classObj} students={students} />
    if (item.type === 'grade') return <GradeCard key={item.id} item={item} classObj={classObj} />
    if (item.type === 'attendance') return <AttendanceCard key={item.id} item={item} classObj={classObj} />
    return null
  })}
</div>
```

with:

```jsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
  {streamItems.slice(streamPage * PAGE_SIZE, (streamPage + 1) * PAGE_SIZE).map((item, idx, arr) => {
    const classObj = getClassObj(item)
    const label = getGroupLabel(item.ts)
    const prevLabel = idx > 0 ? getGroupLabel(arr[idx - 1].ts) : null
    const showGroup = label !== prevLabel
    return (
      <React.Fragment key={item.id}>
        {showGroup && (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: idx > 0 ? 8 : 0 }}>
            {label}
          </div>
        )}
        {item.type === 'announcement' && <AnnouncementCard item={item} classObj={classObj} />}
        {item.type === 'activity' && <ActivityCard item={item} classObj={classObj} students={students} />}
        {item.type === 'quiz' && <QuizCard item={item} classObj={classObj} students={students} />}
        {item.type === 'grade' && <GradeCard item={item} classObj={classObj} />}
        {item.type === 'attendance' && <AttendanceCard item={item} classObj={classObj} />}
      </React.Fragment>
    )
  })}
</div>
<Pagination page={streamPage} total={streamItems.length} pageSize={PAGE_SIZE} onPrev={() => setStreamPage(p => p - 1)} onNext={() => setStreamPage(p => p + 1)} />
```

- [ ] **Step 6: Verify dev server shows no errors**

Run: `npm run dev` and open `http://localhost:5173`. Log in as admin, go to Stream tab. Confirm:
- Skeleton shows briefly on load
- Announcements section shows max 10 items with Prev/Next controls
- Stream feed shows max 10 items with Prev/Next controls and date group headers
- Changing filters resets to page 1

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/tabs/StreamTab.jsx
git commit -m "feat: add pagination, date grouping, and skeleton loading to admin StreamTab"
```

---

### Task 2: Add skeleton loading + pagination to student StreamTab

**Files:**
- Modify: `src/components/student/tabs/StreamTab.jsx`

- [ ] **Step 1: Add shimmer CSS, StreamSkeleton, PAGE_SIZE, helpers, and Pagination to student StreamTab**

At the top of `src/components/student/tabs/StreamTab.jsx`, after the existing imports, add (identical to admin tab):

```jsx
const PAGE_SIZE = 10

function getGroupLabel(ts) {
  if (!ts) return 'Earlier'
  const now = new Date()
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today - itemDay) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString('en-PH', { weekday: 'long' })
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const shimmerStyle = {
  background: 'linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%)',
  backgroundSize: '800px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
}

function StreamSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="stream-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ ...shimmerStyle, width: 80, height: 18 }} />
            <div style={{ ...shimmerStyle, width: 50, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: '70%', height: 18 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...shimmerStyle, width: 90, height: 14 }} />
            <div style={{ ...shimmerStyle, width: 70, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: 120, height: 12 }} />
        </div>
      ))}
    </>
  )
}

function Pagination({ page, total, pageSize, onPrev, onNext }) {
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'var(--ink2)' }}>
      <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={page === 0}>← Prev</button>
      <span>Showing {from}–{to} of {total}</span>
      <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={to >= total}>Next →</button>
    </div>
  )
}
```

- [ ] **Step 2: Add page state and reset logic in student StreamTab**

Inside `export default function StreamTab({ student, viewClassId, classes })`, after existing state declarations, add:

```jsx
const [streamPage, setStreamPage] = useState(0)
```

Update the existing `useData()` destructure to include `fbReady`:

```jsx
const { activities, quizzes, announcements, fbReady } = useData()
```

Replace the filter onChange:

```jsx
onChange={e => setFilterType(e.target.value)}
```

with:

```jsx
onChange={e => { setFilterType(e.target.value); setStreamPage(0) }}
```

- [ ] **Step 3: Apply skeleton loading**

At the top of the return statement in student StreamTab, before the existing filter `<div>`, add:

```jsx
if (!fbReady) {
  return (
    <div style={{ paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StreamSkeleton />
    </div>
  )
}
```

- [ ] **Step 4: Paginate stream feed with date grouping**

Replace the stream feed render block:

```jsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
  {streamItems.map(item => {
    const classObj = getClassObj(item)
    if (item.type === 'announcement') return <AnnouncementCard key={item.id} item={item} classObj={classObj} />
    if (item.type === 'activity') return <ActivityCard key={item.id} item={item} classObj={classObj} student={student} />
    if (item.type === 'quiz') return <QuizCard key={item.id} item={item} classObj={classObj} student={student} />
    if (item.type === 'grade') return <GradeCard key={item.id} item={item} classObj={classObj} />
    if (item.type === 'attendance') return <AttendanceCard key={item.id} item={item} classObj={classObj} />
    return null
  })}
</div>
```

with:

```jsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
  {streamItems.slice(streamPage * PAGE_SIZE, (streamPage + 1) * PAGE_SIZE).map((item, idx, arr) => {
    const classObj = getClassObj(item)
    const label = getGroupLabel(item.ts)
    const prevLabel = idx > 0 ? getGroupLabel(arr[idx - 1].ts) : null
    const showGroup = label !== prevLabel
    return (
      <React.Fragment key={item.id}>
        {showGroup && (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: idx > 0 ? 8 : 0 }}>
            {label}
          </div>
        )}
        {item.type === 'announcement' && <AnnouncementCard item={item} classObj={classObj} />}
        {item.type === 'activity' && <ActivityCard item={item} classObj={classObj} student={student} />}
        {item.type === 'quiz' && <QuizCard item={item} classObj={classObj} student={student} />}
        {item.type === 'grade' && <GradeCard item={item} classObj={classObj} />}
        {item.type === 'attendance' && <AttendanceCard item={item} classObj={classObj} />}
      </React.Fragment>
    )
  })}
</div>
<Pagination page={streamPage} total={streamItems.length} pageSize={PAGE_SIZE} onPrev={() => setStreamPage(p => p - 1)} onNext={() => setStreamPage(p => p + 1)} />
```

- [ ] **Step 5: Verify dev server shows no errors**

Open `http://localhost:5173`. Log in as a student, go to Stream tab. Confirm:
- Skeleton shows briefly on load
- Stream feed shows max 10 items with Prev/Next controls and date group headers
- Changing filter resets to page 1

- [ ] **Step 6: Commit**

```bash
git add src/components/student/tabs/StreamTab.jsx
git commit -m "feat: add pagination, date grouping, and skeleton loading to student StreamTab"
```

---

### Task 3: Build and push

- [ ] **Step 1: Run production build**

```bash
npm run build
```

Expected: Build completes with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 2: Push to remote**

```bash
git push
```
