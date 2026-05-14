# First Login Account Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record when a student first logs in with the default/temp password (`firstLoginAt`) and mark their account as fully activated only after they complete the forced password change (`activated: true`), giving admins a three-tier status: No Account / Pending / Active.

**Architecture:** Two additive fields on `student.account` — `firstLoginAt` written in `AuthContext.loginStudent()` on first temp-password login, `activated` written in `ForceChangePasswordModal` on password save. Admin UI in `StudentsTab` updated to display three-tier status everywhere accounts appear.

**Tech Stack:** React 19, Firebase Firestore (modular SDK v10), `fbSaveStudent()` from `src/firebase/persistence.js`

---

### Task 1: Write `firstLoginAt` on first temp-password login

**Files:**
- Modify: `src/context/AuthContext.jsx` — `loginStudent()` function (~line 134)

This task records the timestamp when a student first logs in using a temp/default password. The write is fire-and-forget so it never delays session start. The updated student object is used for `_startSession` so `currentStudent` is immediately current.

- [ ] **Step 1: Read the current `loginStudent` in AuthContext**

Open `src/context/AuthContext.jsx` and locate `loginStudent` (line 134). The function currently ends with:

```js
clearAttempts(key)
const needsPassSetup = notRegistered || student.forceChangePassword
_startSession('student', student)
return { ok: true, student, forceChange: needsPassSetup }
```

- [ ] **Step 2: Add `firstLoginAt` write before `_startSession`**

Replace the block above with:

```js
clearAttempts(key)
const needsPassSetup = notRegistered || student.forceChangePassword

// Record first login timestamp when student uses a temp/default password
// for the first time. Fire-and-forget — never blocks session start.
let sessionStudent = student
if (student.account?._tempPass && !student.account?.firstLoginAt) {
  const now = Date.now()
  sessionStudent = {
    ...student,
    account: { ...student.account, firstLoginAt: now },
  }
  // db is not available in AuthContext — caller (StudentLayout / LoginScreen)
  // will persist via DataContext. We surface the updated object so currentStudent
  // is immediately correct; persistence happens in the component layer.
}

_startSession('student', sessionStudent)
return { ok: true, student: sessionStudent, forceChange: needsPassSetup }
```

> **Note on persistence:** `AuthContext` does not have access to `db`. The updated student object is returned in the result so the calling component can persist it. We handle this in Task 2.

- [ ] **Step 3: Persist `firstLoginAt` in `LoginScreen` after successful student login**

Open `src/components/auth/LoginScreen.jsx`. Find the call to `loginStudent` and its success handler. It currently does something like:

```js
const res = await loginStudent(studentId, password, students)
if (res.ok) { ... }
```

After a successful login where `res.student.account?.firstLoginAt` was just set (i.e., it wasn't on the original `students` entry), persist it:

```js
const res = await loginStudent(studentId, password, students)
if (!res.ok) { setErr(res.msg); return }

// Persist firstLoginAt if it was just set for the first time
const original = students.find(s => s.id === res.student?.id)
if (
  res.student?.account?.firstLoginAt &&
  !original?.account?.firstLoginAt
) {
  saveStudents(
    students.map(s => s.id === res.student.id ? res.student : s),
    [res.student.id]
  )
}
```

`saveStudents` is available via `useData()` in `LoginScreen`. Confirm the import is already there (`const { students, saveStudents } = useData()`).

- [ ] **Step 4: Verify manually in dev**

Run `npm run dev`. Log in as a student who has `_tempPass: true` and no `firstLoginAt`. After login, check Firestore (or `DataContext.students`) to confirm `account.firstLoginAt` is now set.

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.jsx src/components/auth/LoginScreen.jsx
git commit -m "feat: record firstLoginAt on first temp-password login"
```

---

### Task 2: Set `activated: true` on forced password change completion

**Files:**
- Modify: `src/components/student/modals/ForceChangePasswordModal.jsx` — `handleSubmitPassword()` (~line 49)

- [ ] **Step 1: Locate the account update map in `handleSubmitPassword`**

In `ForceChangePasswordModal.jsx`, find this block inside `handleSubmitPassword` (~line 49):

```js
const updatedStudents = students.map(x => {
  if (x.id !== s.id) return x
  const updated = { ...x }
  if (!updated.account) updated.account = {}
  updated.account = { ...updated.account, pass: hashed }
  delete updated.account._tempPass
  delete updated.forceChangePassword
  return updated
})
```

- [ ] **Step 2: Add `activated: true` to the account update**

Change the map to:

```js
const updatedStudents = students.map(x => {
  if (x.id !== s.id) return x
  const updated = { ...x }
  if (!updated.account) updated.account = {}
  updated.account = { ...updated.account, pass: hashed, activated: true }
  delete updated.account._tempPass
  delete updated.forceChangePassword
  return updated
})
```

- [ ] **Step 3: Verify manually in dev**

Log in as a student with `_tempPass`. Complete the forced password change. Check Firestore to confirm `account.activated === true` and `account._tempPass` is gone.

- [ ] **Step 4: Commit**

```bash
git add src/components/student/modals/ForceChangePasswordModal.jsx
git commit -m "feat: set account.activated on forced password change completion"
```

---

### Task 3: Three-tier status badge in StudentsTab student list

**Files:**
- Modify: `src/components/admin/tabs/StudentsTab.jsx` — student list rows (~line 683)

Currently the list row shows:
```jsx
{s.account?.registered
  ? <Badge variant="green" style={{ fontSize: 11 }}>✓ Active</Badge>
  : <Badge variant="gray" style={{ fontSize: 11 }}>No Account</Badge>}
```

- [ ] **Step 1: Replace with three-tier badge in list rows**

Replace the two-condition ternary at ~line 683 with:

```jsx
{!s.account?.registered
  ? <Badge variant="gray" style={{ fontSize: 11 }}>No Account</Badge>
  : s.account?.activated
    ? <Badge variant="green" style={{ fontSize: 11 }}>✓ Active</Badge>
    : <Badge variant="yellow" style={{ fontSize: 11 }}>⏳ Pending</Badge>}
```

> `variant="yellow"` — confirm this variant exists on the `Badge` primitive. If not, use `variant="orange"` or inline style with amber color. Check `src/components/primitives/Badge.jsx`.

- [ ] **Step 2: Verify `Badge` has a yellow/amber variant**

Open `src/components/primitives/Badge.jsx` and check available variants. If `yellow` is missing, add it:

```js
yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
```

(Match the pattern of existing variants in that file.)

- [ ] **Step 3: Verify visually in dev**

Run `npm run dev`, open the admin Students tab, confirm the three status badges render correctly for students in each state.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/tabs/StudentsTab.jsx src/components/primitives/Badge.jsx
git commit -m "feat: three-tier account status badge in student list"
```

---

### Task 4: Three-tier status in edit modal + firstLoginAt display

**Files:**
- Modify: `src/components/admin/tabs/StudentsTab.jsx` — edit modal Account Status field (~line 315)

Currently:
```jsx
{student.account?.registered
  ? <Badge variant="green">✅ Active Account ({student.account.email || '—'})</Badge>
  : <Badge variant="gray">No account yet</Badge>}
```

- [ ] **Step 1: Replace with three-tier badge and firstLoginAt display**

Replace the block (~lines 314–318) with:

```jsx
{!student.account?.registered
  ? <Badge variant="gray">No account yet</Badge>
  : student.account?.activated
    ? <Badge variant="green">✅ Active ({student.account.email || '—'})</Badge>
    : <Badge variant="yellow">⏳ Pending — not yet activated</Badge>}
{student.account?.firstLoginAt && (
  <div className="text-xs text-ink3 mt-1">
    First login: {new Date(student.account.firstLoginAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })}
  </div>
)}
```

- [ ] **Step 2: Verify in dev**

Open a student edit modal for a student who has `firstLoginAt` set. Confirm the timestamp renders correctly below the badge.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/tabs/StudentsTab.jsx
git commit -m "feat: show firstLoginAt and three-tier status in student edit modal"
```

---

### Task 5: Update CSV export and account sort

**Files:**
- Modify: `src/components/admin/tabs/StudentsTab.jsx` — `exportRosterCSV` (~line 336) and sort (~line 548)

- [ ] **Step 1: Update CSV status column**

At ~line 336, replace:
```js
s.account?.registered ? 'Active' : 'No Account'
```
with:
```js
!s.account?.registered ? 'No Account' : s.account?.activated ? 'Active' : 'Pending'
```

- [ ] **Step 2: Update account sort to three-way**

At ~line 548, replace:
```js
case 'account': va = a.account?.registered ? '1' : '0'; vb = b.account?.registered ? '1' : '0'; break
```
with:
```js
case 'account': {
  const rank = s => !s.account?.registered ? 0 : s.account?.activated ? 2 : 1
  va = String(rank(a)); vb = String(rank(b)); break
}
```

- [ ] **Step 3: Verify CSV export in dev**

Export the student roster CSV and open it. Confirm the Account Status column shows `Active`, `Pending`, or `No Account` correctly for each student.

- [ ] **Step 4: Verify sort in dev**

In the Students tab, click the Account Status column header to sort. Confirm order: No Account → Pending → Active (and reverse).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/tabs/StudentsTab.jsx
git commit -m "feat: update CSV export and sort for three-tier account status"
```

---

## Self-Review

**Spec coverage:**
- ✅ `firstLoginAt` set on first temp-password login → Task 1
- ✅ `activated: true` set on forced password change → Task 2
- ✅ Three-tier status badge in student list → Task 3
- ✅ Three-tier status + firstLoginAt in edit modal → Task 4
- ✅ CSV export and sort updated → Task 5
- ✅ No breaking changes to `account.registered` — all changes additive

**Placeholders:** None.

**Type consistency:** `firstLoginAt` (number), `activated` (boolean `true`) — consistent across Tasks 1, 2, 3, 4, 5.
