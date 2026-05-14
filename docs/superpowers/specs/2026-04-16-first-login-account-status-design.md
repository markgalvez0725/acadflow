# First Login Account Status — Design Spec

**Date:** 2026-04-16
**Status:** Approved

## Problem

When an admin adds a student, their account is immediately marked `registered: true` with a temp password. There is no way for the admin to distinguish between a student who has never logged in and one who has activated their account by completing the forced password change. There is also no record of when a student first logged in.

## Goal

1. Record when a student first logs in using the default/temp password (`firstLoginAt` timestamp).
2. Mark an account as fully activated only after the student completes the forced password change (`activated: true`).

## Approach: Additive fields (no breaking changes)

All changes are purely additive. Existing `account.registered` semantics are unchanged.

---

## Schema

Two new fields on `student.account`:

### `firstLoginAt` — number (Unix ms timestamp)
- Set the first time a student successfully logs in using the default password or any `_tempPass` credential.
- Never overwritten after it is first set.
- Absent on accounts that have not yet had a first login.

### `activated` — boolean `true`
- Set when the student successfully completes `ForceChangePasswordModal` (saves their personal password).
- Once set, never unset.
- Absent on accounts that have been provisioned but never activated.

---

## Implementation

### 1. `src/context/AuthContext.jsx` — `loginStudent()`

After a successful login (both normal and default-password paths), before calling `_startSession()`:

- If `student.account?._tempPass` is set and `student.account?.firstLoginAt` is not yet set, write `firstLoginAt: Date.now()` to Firestore via `fbSaveStudent()`.
- This is fire-and-forget (do not await in a blocking way that delays the session start).
- The updated student object (with `firstLoginAt`) is passed to `_startSession()` so `currentStudent` is immediately up to date.

**Condition:** Only write when `_tempPass` is present and `firstLoginAt` is absent. This prevents overwriting on subsequent logins.

### 2. `src/components/student/modals/ForceChangePasswordModal.jsx` — `handleSubmitPassword()`

In the existing `updatedStudents` map that already:
- Sets `updated.account.pass = hashed`
- Deletes `updated.account._tempPass`
- Deletes `updated.forceChangePassword`

Also add: `updated.account.activated = true`

No other changes to this file.

### 3. `src/components/admin/tabs/StudentsTab.jsx`

#### Student list rows
Replace the current two-tier status badge with three tiers:

| Condition | Badge color | Label |
|---|---|---|
| `!account?.registered` | gray | No Account |
| `registered && !account?.activated` | yellow/amber | Pending |
| `registered && activated` | green | Active |

#### Edit modal — Account Status field
- Same three-tier badge.
- When `firstLoginAt` is set, show a read-only "First Login" line below the badge: formatted date/time (e.g. `Apr 16, 2026, 2:34 PM`).

#### CSV export (`exportRosterCSV`)
Update the Account Status column values:
- `'No Account'` → unchanged
- `'Active'` → only when `activated`
- Add `'Pending'` for `registered && !activated`

#### Sort (`case 'account'`)
Three-way sort: `No Account (0) < Pending (1) < Active (2)`.

### 4. `src/components/admin/tabs/DashboardTab.jsx`

The existing `regCount` (students with `account?.registered`) remains unchanged — it counts provisioned accounts. No new count needed unless requested later.

### 5. No changes needed

- `MessagesTab`, `FloatingMessenger` — the `(no account)` label checks `account?.registered`, which is correct. No change.
- `AuthContext.loginAdmin()` — unaffected.
- `listeners.js`, `persistence.js` — no structural changes; `fbSaveStudent()` already handles arbitrary account fields.

---

## Data migration

None required. Existing students without `activated` simply show as "Pending" in the admin UI until they log in and complete setup. This is accurate — they haven't activated yet.

---

## Files changed

| File | Change |
|---|---|
| `src/context/AuthContext.jsx` | Write `firstLoginAt` on first temp-password login |
| `src/components/student/modals/ForceChangePasswordModal.jsx` | Set `activated: true` on password save |
| `src/components/admin/tabs/StudentsTab.jsx` | Three-tier status badge, CSV, sort, edit modal |
