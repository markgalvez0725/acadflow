# AcadFlow

**Academic Management System** for admins (teachers/staff) and students - built with React, Vite, and Firebase Firestore.

**Version 2.1.1**

---

## Overview

AcadFlow is a web-based school portal that provides a unified platform to manage grades, attendance, activities, and messaging in real time.

## Features

### Admin Portal
- **Dashboard** - class-wide KPIs, GWA/attendance charts, at-risk student monitoring
- **Students** - roster management with grades and attendance overview; account verification (none → pending → active)
- **Classes** - class and subject definitions (active vs. archived/past-semester)
- **Grades** - fast spreadsheet-style entry (keyboard grid nav, search-as-you-type jump, undo/redo + autosave, speed-grading mode), missing/invalid-grade detector, and a single color-coded Excel template that computes grades in-sheet exactly as the app does. Imported "+ Activity / + Quiz" columns are **additive** (never overwrite app activities/quizzes), and a popup preview runs on-device AI verification of imported grades.
- **Grade Integrity** - auditor that recomputes each stored grade from live components and flags mismatches (e.g. tampering or stale imports)
- **Attendance** - calendar-based daily attendance tracking (Present / Absent / Excuse); excuse-request triage; import from file
- **Activities** - post assignments with deadlines, rubric builder + reusable rubric library, and grade submissions; students are notified when graded
- **Quiz** - create and manage quizzes; AI-generated questions; answer-key manager with fuzzy text auto-scoring and partial credit; quiz→gradebook auto-post; suspicious-submission flagging; distractor-quality auditor; clone quiz
- **Stream** - Instagram-style feed (announcements, grades, activities, quizzes, attendance) that auto-loads on scroll (no pagination) with a reveal animation. Rich-text announcements with media, inline comments, replies, and @mentions; optional Google Drive attachments (photos/files) uploaded browser-side and previewed in-feed
- **Calendar** - monthly calendar view of activities, quizzes, and announcements
- **Online Classes** - schedule and manage Google Meet sessions; start/end/cancel meetings
- **Resources** - share lesson files and links per class
- **Messages** - one-on-one and broadcast messaging with @mentions, smart-lock for sensitive messages, and screenshot logging
- **Feedback Hub** - collect and review student feedback submissions
- **Audit Log** - chronological record of sensitive admin/account actions
- **Notifications** - system-wide alerts and activity updates
- **Settings** - admin credentials + recovery PIN, equivalence scale, semester, late-penalty policy, notifications, backup/restore, Firebase config

### Student Portal
- **Overview** - personal GWA, attendance rate, active announcements (with meeting and module links), recent activity, and per-subject Final Grade / Attendance charts
- **Grades** - view grades per subject with assessment breakdowns and what-if projection
- **Attendance** - personal attendance calendar and summary; submit excuse requests
- **Activities / Assignments** - view and submit assignments; edit submission link before deadline
- **Quiz** - take quizzes with auto-grading
- **Stream** - Instagram-style feed that auto-loads on scroll (no pagination); like and save posts, full-screen media lightbox, inline announcement comments, replies, and @mentions
- **Calendar** - personal calendar view of upcoming events; export to `.ics`
- **Online Classes** - view and join scheduled Google Meet sessions
- **Resources** - browse class lesson files and links
- **Enrollment** - manage class enrollment
- **Messages** - direct messaging with admin/teacher (smart-lock + screenshot guard)
- **Feedback** - submit feedback to the teacher/staff
- **Notifications** - personal notification feed with badge for unread items

### General
- Real-time sync via Firebase Firestore
- Push notifications (Firebase Cloud Messaging) on grade posts, activity grading, announcements, and deadline reminders - fired both client-side (while open) and via a Vercel Cron job (while closed)
- On-device AI ($0, no data leaves the browser): grade-import verification, distractor auditing, excuse triage, identity/impersonation checks, and answer-key improvement, with optional Gemini-backed server endpoints that degrade gracefully when unconfigured
- Biometric quick sign-in (Face ID / fingerprint via WebAuthn) as an opt-in convenience layer; password always remains the fallback
- Guided account verification: after first sign-in, a step-by-step flow inside Settings walks the student through setting their own password, enrolling Face ID, and adding a profile photo. The photo's face is computed on-device and matched server-side against the enrolled Face ID signature before it is accepted, so an account's photo is provably the real student. Completing all steps grants a verified badge and unlocks grades, quizzes, and activities. On-device guidance (deterministic, no external AI) narrates each step.
- Teacher-coordinated student password reset (no plaintext password leaves the student's device), self-service Face ID password reset (the student's live face is matched server-side against an on-device-computed signature, with liveness; no temporary password), and admin recovery-PIN reset
- Excel (.xlsx) and PDF export for grades, attendance, and report cards
- Installable PWA with offline app shell; mobile Settings opens full-screen with a drag-down-to-dismiss handle
- Light and dark mode
- 30-minute inactivity session timeout with tab-focus expiry check

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 19 + Vite 6 |
| Routing | Role-based state routing (no URL router - tab state in `UIContext`) |
| Styling | Tailwind CSS v4 |
| Data | Firebase Firestore (modular SDK v10, long-poll) |
| Server | Vercel serverless functions in `api/` (Node built-ins only) - AI, web push, password reset, cron reminders |
| Exports | SheetJS + ExcelJS (Excel), jsPDF + AutoTable (PDF) via CDN |

## Getting Started

### Prerequisites

- Node.js 18+
- A Firebase project with Firestore enabled

### Install

```bash
npm install
```

### Configure

Create a `.env` file in the project root:

```bash
# Required
VITE_FB_API_KEY=
VITE_FB_PROJECT_ID=

# Optional - defaults are derived from projectId if omitted
VITE_FB_AUTH_DOMAIN=
VITE_FB_STORAGE_BUCKET=
VITE_FB_MESSAGING_SENDER_ID=
VITE_FB_APP_ID=

# Optional - crypto key overrides (safe defaults apply for new installs)
VITE_PASS_SALT=
VITE_EJS_SECRET=
VITE_EJS_SALT=
VITE_FB_SECRET=
VITE_FB_SALT=

# Optional - Google Drive uploads (Stream attachments + student activity
# submissions). A public OAuth Web client id with the drive.file scope; add your
# deployed origin to the client's Authorized JavaScript origins. When unset, the
# Drive uploader is hidden and submissions fall back to link-paste only.
VITE_GOOGLE_CLIENT_ID=
```

> If env vars are absent, Firebase config can also be entered in-app via **Admin Settings → Firebase**. It is AES-encrypted before being stored in `localStorage`.

### Run

```bash
npm run dev      # development server (http://localhost:5173)
npm run build    # production build
npm run preview  # preview production build
```

### Admin Access

Navigate to `/admin` for the admin login screen.

Default credentials (**change after first login** via Settings → Credentials):

```
Username: admin
Password: Admin@1234
```

### Student Access

The root path `/` shows the student login screen. Students log in with their Student ID and password.

## Project Structure

```
api/                 # Vercel serverless functions (Node built-ins only)
  _guard.js          # CORS allowlist + per-IP rate limiting
  _fbadmin.js        # Firebase Admin via service-account OAuth + Firestore/Identity REST
  generate-quiz.js   # Gemini-backed AI quiz generation (gated by GEMINI_API_KEY)
  send-push.js       # FCM HTTP v1 web push
  cron-reminders.js  # Vercel Cron: deadline reminders for the closed app
  verify-account.js  # Server-side account verification
  verify-claim.js    # Server-side first-login password-hash check (reads studentSecrets)
  admin-open-reset-session.js / claim-reset.js  # Teacher-coordinated password reset
src/
  components/
    admin/           # Admin layout, sidebar, tabs, modals
    auth/            # Login screens, recovery-PIN reset, biometric quick-unlock
    canvas/          # Animated background scenes
    charts/          # BarChart, DonutChart
    primitives/      # Shared UI: Badge, Modal, Dialog, Toast, CommandPalette, Pagination, etc.
    student/         # Student layout, tabs, modals
  context/
    AuthContext.jsx  # Session management, login/logout, OTP helpers
    DataContext.jsx  # Firebase bootstrap, real-time listeners, persistence
    UIContext.jsx    # Toast, theme, UI state
  export/
    excelExport.js   # Shared Excel helpers (SheetJS) + master grading report
    gradingSheet.js  # Color-coded teacher grading template (ExcelJS) + import parser
    pdfExport.js     # jsPDF PDF export
    reportCard.js    # Per-student PDF report card
  firebase/
    firebaseInit.js  # App/Firestore init, write-timeout wrapper
    listeners.js     # Real-time Firestore listeners (owns the _fbWriting echo guard)
    persistence.js   # Firestore write helpers
    settings.js      # Settings and EJS config sync
    attendanceExtras.js / pushTokens.js  # Attendance/excuse writes, web-push tokens
  hooks/             # usePushNotifications, useReminders, useScreenshotGuard, useInstallPrompt, useInfiniteFeed, …
  pwa/               # Service-worker registration + web push client
  utils/             # grades, gradeEngine, attendance, crypto, mentions, biometric, on-device AI helpers, …
  App.jsx            # Context provider tree
  AppRouter.jsx      # Role-based routing
  main.jsx           # Vite entry point
public/
  sw.js              # Hand-rolled service worker (PWA shell cache + background push)
  manifest.webmanifest
index.html           # CDN scripts: SheetJS, ExcelJS, jsPDF, jspdf-autotable
```

## Firestore Data Model

Two storage patterns coexist:

**Per-document collections** (one doc per record):

| Collection | Purpose |
|---|---|
| `students` | One document per student (doc ID = student ID); holds grades, attendance, account |
| `activities` | Assignments with deadlines, rubrics, and submissions |
| `quizzes` | Quiz definitions and student submissions |
| `announcements` | Stream announcements with optional meeting and module links |
| `messages` | In-app messaging threads |
| `onlineMeetings` | Scheduled Google Meet sessions |
| `attendanceSessions` | Per-session attendance records |
| `excuseRequests` | Student excuse submissions for attendance |
| `resources` | Shared class lesson files and links |
| `studentFeedback` | Student feedback submissions |
| `notifications` | Per-user notification feed (`items` array; doc ID = user ID, `admin` for staff) |
| `auditLog` | Sensitive admin/account actions |
| `pushTokens` | Per-device FCM web-push tokens |

**Singleton documents under `portal/*`** (read-modify-write the whole doc):

| Document | Purpose |
|---|---|
| `portal/classes` | Class list (a `list` array - editing one class rewrites the array) |
| `portal/config` | Equivalence scale, semester, late-penalty policy, portal settings |
| `portal/settings` | Portal-wide settings |
| `portal/admin` | Admin credentials (hashed password, email, reset PIN) |

**Server-only collections** (Firestore rules deny all client reads; touched only by `api/` serverless functions):

| Collection | Purpose |
|---|---|
| `studentSecrets` | Per-student password hash, kept off the client-readable `students` doc |
| `faceSignatures` | Enrolled Face ID descriptors used for server-side identity matching |

## Security Notes

- Passwords are SHA-256 hashed with a salt before storage - never stored in plaintext.
- Password hashes live in a server-only `studentSecrets` collection (denied to all clients by Firestore rules), not on the broadly-readable `students` document, so no signed-in student can read another student's hash. First-login claim and account recovery verify the hash server-side via `api/verify-claim.js`.
- Firebase config is AES-encrypted in `localStorage`.
- Plaintext Firebase config is removed from `localStorage` 3 seconds after init.
- Login has per-key brute-force lockout tracked in `sessionStorage`.
- Sessions expire after 30 minutes of inactivity; expiry is also checked on tab focus.
- Face ID signatures live in a server-only `faceSignatures` collection (denied to all clients by Firestore rules); the browser never reads a stored descriptor, so it can't be replayed, and never writes one, so it can't be forged. Enrollment, login reset, and the profile-photo identity match all compare distances server-side at the same threshold.

## Enhancements

Additive features layered on top of the core portal (none change existing behavior):

### Progressive Web App (installable + offline)

AcadFlow is installable to the home screen and opens offline. A hand-rolled
service worker (`public/sw.js`, no build dependency) caches the app shell with a
network-first strategy for navigations and stale-while-revalidate for static
assets. It only intercepts same-origin GET requests, so Firestore real-time sync
is untouched. Registered in production builds only (`src/pwa/registerSW.js`),
never in the dev server. Icons and `manifest.webmanifest` live in `public/`.

### Web push notifications (Firebase Cloud Messaging)

Students can opt in per device from the account sheet ("Enable Notifications").
Push is fully self-gating: with no VAPID key it silently disables and in-app
notifications keep working unchanged.

- Client: `src/pwa/push.js`, `src/hooks/usePushNotifications.js`
- Tokens stored in a dedicated `pushTokens` collection (`src/firebase/pushTokens.js`)
- Background pushes handled in `public/sw.js`; foreground pushes raise a toast
- Server send endpoint: `api/send-push.js` (FCM HTTP v1, dependency-free)

Setup: set `VITE_FB_VAPID_KEY` (Web Push certificate) for the client, and
`FCM_SERVICE_ACCOUNT` (service-account JSON) in Vercel for the sender.

### Command palette (Ctrl / ⌘ + K)

Global quick-nav across every tab for both portals, plus fuzzy search over
students and classes for admins. Launch with the keyboard shortcut or the
**Search** button in the top bar. Component: `src/components/primitives/CommandPalette.jsx`.

### Analytics + calendar export

The student Overview shows per-subject **Final Grade** and **Attendance** bar
charts derived from existing data. The student Calendar adds **Add to Calendar**,
exporting deadlines, quiz closings, and announcements as a standard `.ics` file
(`src/utils/ics.js`) that subscribes into Google, Apple, or Outlook Calendar.

## Mobile App

AcadFlow installs as a PWA on iOS and Android today, and can be wrapped as a native app via Capacitor for the App Store / Play Store. See [MOBILE_APP_GUIDE.md](MOBILE_APP_GUIDE.md).

## License

Released under the [MIT License](LICENSE).

---

Built by **Mark Arnold Galvez**.
AI assistance provided by [Claude](https://claude.ai) (Anthropic) during development.
