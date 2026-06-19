# Session Info Chip & Back-Button Lock — Design Spec
Date: 2026-04-16

## Overview
Add a persistent session info chip to both the admin and student portal nav bars, save last-login timestamps per user, and prevent the browser back button from returning to the login screen after a successful login.

## Features

### 1. Session Storage (AuthContext)
- Before starting a new session, read the current `cp_session` timestamp and save it as `cp_lastlogin_admin` or `cp_lastlogin_<studentId>`.
- `cp_session` gains two new fields: `loginTime` (ms timestamp when this session started) and `lastLogin` (ms timestamp of the previous session start, or null on first login).
- Both fields are restored during `_attemptRestore()` so the chip shows correct data on page refresh.

### 2. SessionChip Component (`src/components/primitives/SessionChip.jsx`)
- Props: `{ role, name, loginTime, lastLogin }`
- Displays: name/role, login time, last login (or "First login"), live countdown (30:00 → 0:00)
- Countdown color: normal → amber at ≤5 min → red at ≤2 min
- Updates every second via `setInterval` in `useEffect`
- Styled: `bg-bg2 border border-border rounded-xl px-3 py-1.5` — display only, not interactive

### 3. Layout Integration
- `AdminLayout`: place `SessionChip` in the header, right side, left of logout button. Role = "Admin", name = "Admin".
- `StudentLayout`: place `SessionChip` in the header, right side, left of logout button. Role = "student", name = student's full name.
- Both layouts read `loginTime` and `lastLogin` from `AuthContext` (exposed via context value).

### 4. Back-Button Lock
- `_startSession()` already calls `history.replaceState(null, '', window.location.href)` which replaces the login page in browser history.
- Verify this works for both admin and student flows. No additional changes needed unless tested broken.

### 5. Default Password Display (StudentsTab)
- In `ImportStudentsModal`: add a visible info note after successful import confirming the default password students should use (`Welcome@2026`).
- In `AddStudentModal`: the info note already exists in the UI — verify it's clear enough.

## Data Flow
```
loginAdmin/loginStudent called
  → read cp_session.ts → save to cp_lastlogin_*
  → _startSession(role, student)
      → write cp_session { role, studentId, ts, loginTime, lastLogin }
      → setSessionRole, setCurrentStudent
          → AppRouter renders AdminLayout / StudentLayout
              → SessionChip reads loginTime, lastLogin from AuthContext
```

## Files Changed
- `src/context/AuthContext.jsx` — save last login, add loginTime/lastLogin to session + context
- `src/components/primitives/SessionChip.jsx` — new component
- `src/components/admin/AdminLayout.jsx` — add SessionChip to header
- `src/components/student/StudentLayout.jsx` — add SessionChip to header
