# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AcadFlow is a real-time school portal with two roles — admin (teacher/staff) and student — covering grades, attendance, activities, quizzes, stream/announcements, online classes, and messaging. The React client is a single-page app; a small set of Vercel serverless functions in `api/` provides the only server-side logic (AI, web push, password reset, scheduled reminders).

## Stack

React 19 + Vite 6 + Tailwind CSS v4 + Firebase Firestore (modular SDK v10).
**Not Next.js.** There is no App Router, no server components, no `pages/` directory, no `next/*` imports.

## Routing

Role-based, not URL-based. `AppRouter.jsx` renders one of four lazy components based on `sessionRole` from `AuthContext`:

- `null` + `/admin` path → `AdminLoginScreen`
- `null` + other → `LoginScreen`
- `'admin'` → `AdminLayout`
- `'student'` → `StudentLayout`

Do not add URL routes or `<Route>` components. Navigation between tabs is handled inside each layout via local state.

## Context Tree

`UIProvider` → `DataProvider` → `AuthProvider` → `AppRouter`

- `UIContext` — toast, theme, UI state
- `DataContext` — Firebase init, real-time listeners, all data (students, classes, messages, activities, admin config)
- `AuthContext` — session, login/logout, OTP helpers

## Firebase

- Initialized lazily in `DataContext._bootstrap()`. Config priority: hardcoded fallback in `firebaseInit.js` → env vars (`VITE_FB_*`) → AES-encrypted `localStorage`.
- Firestore uses long-poll mode (`experimentalAutoDetectLongPolling: true`).
- All writes go through helpers in `src/firebase/persistence.js`, `src/firebase/settings.js`, and `src/firebase/attendanceExtras.js`, each wrapped with `fbWithTimeout()` (20 s hard timeout).
- Real-time listeners are registered in `src/firebase/listeners.js`. That module owns a module-level `_fbWriting` flag (`setFbWriting()`) that suppresses `onSnapshot` echoes during in-flight local writes — do not replace it with React state.

### Data shape (mixed model)

Two distinct storage patterns coexist; know which one you're touching:

- **Per-document collections** — one doc per record: `students`, `activities`, `quizzes`, `announcements`, `onlineMeetings`, `messages`, `notifications`, `auditLog`, `attendanceSessions`, `excuseRequests`, `resources`, `studentFeedback`, `pushTokens`.
- **Singleton docs under `portal/*`** — read-modify-write a whole document: `portal/classes` (holds the class list in a `list` array), `portal/config`, `portal/settings`, `portal/admin`. Editing one class means rewriting the `list` array.

Two serialization quirks to preserve:
- Attendance/excuse are `Set<dateStr>` in memory but stored as `_att` / `_exc` arrays — convert via `serializeStudents` / `deserializeStudents` in `src/utils/attendance.js`.
- "Active vs. archived/past-semester" filtering is centralized in `src/utils/active.js` (`activeClassIds` / `activeSubjects`); use it rather than reading `classIds` directly in student-facing views.

## Backend — `api/` (Vercel serverless)

The only server-side code. Functions are dependency-free (Node built-ins only) and degrade gracefully (e.g. AI endpoints return `501` when their key is unset so the client falls back to on-device behavior). Files prefixed `_` are shared helpers, not routes.

- `_guard.js` — CORS allowlist + per-IP rate limiting; `_fbadmin.js` — Firebase Admin via service-account OAuth + Firestore/Identity Toolkit REST; `_identity.js` — Identity Toolkit helpers.
- `generate-quiz.js` — Gemini-backed AI quiz generation (gated by `GEMINI_API_KEY`; returns `501` when unset so the client falls back to on-device generation).
- `send-push.js` — FCM HTTP v1 web push; `cron-reminders.js` — Vercel Cron (see `vercel.json` `crons`) that web-pushes deadline reminders for activities due within 24h, marking each with `reminderSentAt` to avoid repeats.
- `verify-account.js` — server-side account verification (the `verified` flag is only ever set here).
- `admin-open-reset-session.js` / `claim-reset.js` — teacher-coordinated student password reset (no plaintext password leaves the student's own device).

## Path Alias

`@` resolves to `src/`. Always use `@/...` imports, never relative `../../`.

## Notifications & reminders

- In-app notifications live in `notifications/{userId}` as an `items` array (newest-first, capped). Many writers append to it (`fbPush*` / `fbNotify*` in `persistence.js`, `attendanceExtras.js`, `reminders.js`); the admin's feed uses the `admin` doc id.
- Filtering by category is applied once at display/badge time via `src/utils/notifPrefs.js` (`isNotifAllowed`) — when adding a new notification `type`, map it there so mute preferences apply.
- Web push (FCM) is opt-in per device: tokens via `src/firebase/pushTokens.js`, sent through `api/send-push.js`. Treat push as best-effort, always alongside the in-app write.
- Deadline reminders exist on both sides: client `src/hooks/useReminders.js` (fires while the app is open; pure logic in `src/utils/reminders.js`, idempotent writer dedups by `remKey`) and server `api/cron-reminders.js` (fires when the app is closed).

## Styling

Tailwind CSS v4. Base and component styles must be wrapped in `@layer base` / `@layer components` blocks. Do not use v3 `@apply` patterns that conflict with v4's engine. Use the `cn()` helper in `src/utils/cn.ts` to merge conditional classes. Many components also style with CSS variables (`var(--ink)`, `var(--accent)`, `var(--border)`, …) defined in `src/styles/globals.css`.

## Exports

SheetJS and jsPDF are loaded via CDN in `index.html` and accessed as `window.XLSX` and `window.jspdf`. Do not `import` them as npm modules.

## Security

- Passwords: SHA-256 + salt via `hashPassword()` / `verifyPassword()` in `src/utils/crypto.js`. Never store plaintext.
- Firebase config: AES-encrypted with `encryptFbConfig()` before writing to `localStorage`.
- Login lockout: `recordFailedAttempt()` / `isLockedOut()` in `src/utils/validate.js`.

## Adding Features

- New admin tab → add component in `src/components/admin/tabs/`, then register in `AdminLayout.jsx` (lazy import + `TAB_TITLES` map + render switch). Student tabs mirror this in `StudentLayout.jsx`. The `⌘K` command palette tab lists in `CommandPalette.jsx` are kept in sync manually.
- New Firestore collection → add a listener in `src/firebase/listeners.js` (`fbStartListening`), then add state + a write helper in `DataContext` and expose it on the context value. Components consume via `useData()` — never via direct Firestore calls.
- Editing a class → it is **not** its own document; mutate the `list` array in `portal/classes` (read-modify-write) through the existing `DataContext` helpers.

## Development Workflow

- **Start dev server:** `npm run dev` (runs on `http://localhost:5173`)
- **Build for production:** `npm run build` (output in `dist/`)
- **Preview production build locally:** `npm run preview`
- All changes hot-reload in dev mode.

There is **no test runner and no lint script** in `package.json` (the only scripts are `dev`, `build`, `preview`). Verify changes with `npm run build` plus manual checks in `npm run dev` — don't go looking for a test command.

## Recent Security Hardening (Stream Tab)

Announcement and comment management now includes:
- **XSS Prevention:** DOMPurify sanitizes all user-generated HTML with a whitelist of safe tags (b, i, u, em, strong, mark, p, br, ul, ol, li, h3, h4). Applied at editor input and render points.
- **ID Generation:** Comment and reply IDs use UUID v4 (cryptographically secure) instead of weak generation. Prevents ID collisions under concurrent load.
- **Atomic Writes:** Firebase comment operations (`fbAddAnnouncementComment`, `fbAddCommentReply`) use transactions to ensure atomicity. Prevents lost updates when multiple clients write concurrently.

## Common Mistakes to Avoid

- Do not read Firebase directly from components — go through `DataContext` helpers.
- Do not add URL navigation (`useNavigate`, `<Link>`) — AcadFlow uses tab-state navigation only.
- Do not import SheetJS or jsPDF via npm — they are CDN globals.
- Do not use `next/*` imports or APIs — this is not a Next.js project.
- When adding user-generated content (HTML, comments, etc.), always sanitize with DOMPurify before rendering.
