# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AcadFlow is a React-based academic management system with two portals: Teacher/Admin and Student. It uses Firebase Firestore as its real-time database and is built with Vite + Tailwind CSS.

## Commands

```bash
npm run dev       # Start dev server (Vite)
npm run build     # Production build
npm run preview   # Preview production build
```

After any code change, run:
```bash
mix format
mix check
```

`mix format` formats the code. `mix check` verifies there are no compilation errors and flags any improvements to make.

## Critical command
| Action | Command | Purpose |
| :--- | :--- | :--- |
| **Full Audit** | `npm run check` | Runs Types, Lint, and Build tests |
| **Auto-Format** | `npm run format` | Fixes Tailwind and JS formatting |

## Environment Setup

Copy `.env.example` to `.env` and fill in the secrets before running:
- `VITE_EJS_SECRET` / `VITE_EJS_SALT` — EmailJS credential encryption
- `VITE_FB_SECRET` / `VITE_FB_SALT` — Firebase config encryption
- `VITE_PASS_SALT` — SHA-256 password hashing salt

## Architecture

### Entry point
`src/main.jsx` → `src/App.jsx` wraps three context providers → `src/AppRouter.jsx` routes by `sessionRole`.

### Context layer (`src/context/`)
- **`AuthContext`** — session state (`sessionRole`, `currentStudent`), login/logout, OTP helpers, 30-minute inactivity timeout persisted in `localStorage`
- **`DataContext`** — bootstraps Firebase on mount, owns all Firestore data (`students`, `classes`, `messages`, `activities`, `adminNotifs`), admin credentials, EmailJS settings, and equivalency scale
- **`UIContext`** — theme toggle and global toast/dialog state

### Routing
`AppRouter` renders one of four lazy-loaded screens based on `sessionRole`:
- `null` → `LoginScreen` (student) or `AdminLoginScreen`
- `'admin'` → `AdminLayout`
- `'student'` → `StudentLayout`

### Component structure
```
src/components/
  primitives/     # Reusable UI atoms (Dialog, Modal, Toast, Badge, Pagination, etc.)
  auth/           # Login screens
  admin/          # AdminLayout, AdminSidebar, tabs/, modals/
  student/        # StudentLayout, tabs/, modals/
  charts/         # BarChart, DonutChart (canvas-based)
  canvas/         # StarCanvas, WeatherScene decorative backgrounds
```

### Firebase layer (`src/firebase/`)
- **`firebaseInit.js`** — singleton Firebase app named `'cp'`; long-polling enabled; `fbWithTimeout()` wraps writes with 20s timeout
- **`listeners.js`** — real-time Firestore `onSnapshot` subscriptions
- **`persistence.js`** — read/write helpers for students and classes
- **`settings.js`** — portal settings and admin credential sync

### Utilities (`src/utils/`)
- **`crypto.js`** — AES-GCM encrypt/decrypt for credentials stored in `localStorage`; SHA-256 password hashing; Firebase config loading
- **`grades.js`** — grade computation and the default equivalency scale (`DEFAULT_EQ_SCALE`)
- **`otp.js`** — 6-digit OTP generation and verification
- **`validate.js`** — login lockout logic
- **`attendance.js`** — attendance calculations
- **`format.js`** — display formatting helpers
- **`cn.ts`** — Tailwind class merging utility

### Theming
Dark mode is implemented via CSS custom properties on `[data-theme="dark"]`, **not** Tailwind's `dark:` prefix (which is disabled). All Tailwind color tokens (e.g., `bg`, `surface`, `ink`, `accent`) map to CSS variables defined in `src/styles/globals.css`. Always use these semantic tokens rather than raw Tailwind colors.

### Firestore data model
| Collection | Purpose |
|---|---|
| `portal/{doc}` | Admin credentials (SHA-256 hashed), EmailJS settings (AES-GCM encrypted), grade weights, equivalency scale |
| `students/{id}` | Student records: grades, attendance, SHA-256 hashed passwords |
| `messages/{id}` | Direct messages and announcements |
| `notifications/{userId}` | Per-user notification feeds |
| `activities/{id}` | Activity definitions and submissions |

### Security model
- Passwords hashed with SHA-256 client-side before storing
- EmailJS and Firebase credentials encrypted with AES-GCM in `localStorage`
- OTP: 6-digit codes, 10-minute expiry, lockout after repeated failures
- Default admin credentials: `admin` / `Admin@1234`; default student password: `Welcome@2026`

## Conversation compaction

1. **Check first** — at the start of each session, assess whether the conversation needs to be compacted now.
2. **Compact at 15%** — when the context reaches 15% remaining capacity, stop the current session and run `/compact` immediately.
3. **Compact last two sessions** — before compacting, always compact the last two sessions of the conversation so their context is preserved in the summary.