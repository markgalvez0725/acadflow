# AcadFlow

**Academic Management System** for admins (teachers/staff) and students — built with React, Vite, and Firebase Firestore.

---

## Overview

AcadFlow is a web-based school portal that provides a unified platform to manage grades, attendance, activities, and messaging in real time.

## Features

### Admin Portal
- **Dashboard** — class-wide KPIs, GWA/attendance charts, at-risk student monitoring
- **Students** — roster management with grades and attendance overview
- **Classes** — class and subject definitions
- **Grades** — input and manage grades per subject and assessment type; Save All Grades button for bulk updates
- **Attendance** — calendar-based daily attendance tracking (Present / Absent / Excuse); import from file
- **Activities** — post assignments with deadlines, rubric builder, and grade submissions; students are notified when graded
- **Quiz** — create and manage quizzes; export template with optional AI prompt for question generation
- **Announcements** — post "No Class", "Online Class", or "Meeting Topics" notices targeting a specific class or all classes at once; optional meeting link and module link; students are notified instantly
- **Messages** — one-on-one and broadcast messaging to students
- **Notifications** — system-wide alerts and activity updates
- **Settings** — admin credentials, EmailJS config, equivalence scale, Firebase config

### Student Portal
- **Overview** — personal GWA, attendance rate, active announcements (with meeting and module links), and recent activity
- **Grades** — view grades per subject with assessment breakdowns
- **Attendance** — personal attendance calendar and summary
- **Activities** — view and submit assignments; edit submission link before deadline
- **Messages** — direct messaging with admin/teacher
- **Notifications** — personal notification feed with badge for unread items

### General
- Real-time sync via Firebase Firestore
- Push notifications to students on grade posts, activity grading, and announcements
- EmailJS OTP for password resets
- Excel (.xlsx) and PDF export for grades and attendance
- Light and dark mode
- 30-minute inactivity session timeout with tab-focus expiry check

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 19 + Vite 6 |
| Routing | React Router v6 (role-based, no URL routes) |
| Styling | Tailwind CSS v4 |
| Backend | Firebase Firestore (modular SDK v10, long-poll) |
| Email | EmailJS (`@emailjs/browser`) |
| Exports | SheetJS (Excel), jsPDF + AutoTable (PDF) via CDN |

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

# Optional — defaults are derived from projectId if omitted
VITE_FB_AUTH_DOMAIN=
VITE_FB_STORAGE_BUCKET=
VITE_FB_MESSAGING_SENDER_ID=
VITE_FB_APP_ID=

# Optional — crypto key overrides (safe defaults apply for new installs)
VITE_PASS_SALT=
VITE_EJS_SECRET=
VITE_EJS_SALT=
VITE_FB_SECRET=
VITE_FB_SALT=
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
src/
  components/
    admin/           # Admin layout, sidebar, tabs, modals
    auth/            # Login screens, PIN/OTP modals
    canvas/          # Animated background scenes
    charts/          # BarChart, DonutChart
    primitives/      # Shared UI: Badge, Modal, Dialog, Toast, etc.
    student/         # Student layout, tabs, modals
  context/
    AuthContext.jsx  # Session management, login/logout, OTP helpers
    DataContext.jsx  # Firebase bootstrap, real-time listeners, persistence
    UIContext.jsx    # Toast, theme, UI state
  export/
    excelExport.js   # SheetJS Excel export
    pdfExport.js     # jsPDF PDF export
  firebase/
    firebaseInit.js  # App/Firestore init, write-timeout wrapper
    listeners.js     # Real-time Firestore listeners
    persistence.js   # Firestore write helpers
    settings.js      # Settings and EJS config sync
  hooks/
    usePagination.js
    useSession.js
    useTheme.js
  utils/
    attendance.js    # Attendance calculation and serialization
    crypto.js        # SHA-256 hashing, AES encryption (EJS config, FB config)
    format.js        # Display formatting helpers
    grades.js        # GWA computation, equivalence scale
    otp.js           # OTP generation and verification
    validate.js      # Login lockout logic
  App.jsx            # Context provider tree
  AppRouter.jsx      # Role-based routing
  main.jsx           # Vite entry point
index.html           # CDN scripts: SheetJS, jsPDF, jspdf-autotable
```

## Firestore Collections

| Collection | Purpose |
|---|---|
| `students` | One document per student (doc ID = student ID) |
| `classes` | Class/subject definitions with grade records |
| `messages` | In-app messaging |
| `activities` | Assignments with deadlines, rubrics, and submissions |
| `announcements` | No-class / online-class notices with optional meeting and module links |
| `notifications` | Per-student notification feed (doc ID = student ID) |
| `adminNotifs` | Admin-side notifications |
| `admin` | Admin credentials (hashed password, email, reset PIN) |
| `config` | EmailJS config (encrypted), portal settings |

## Security Notes

- Passwords are SHA-256 hashed with a salt before storage — never stored in plaintext.
- Firebase config and EmailJS credentials are AES-encrypted in `localStorage`.
- Plaintext Firebase config is removed from `localStorage` 3 seconds after init.
- Login has per-key brute-force lockout tracked in `sessionStorage`.
- Sessions expire after 30 minutes of inactivity; expiry is also checked on tab focus.

---

Built by **Mark Arnold Galvez**.
AI assistance provided by [Claude](https://claude.ai) (Anthropic) during development.
