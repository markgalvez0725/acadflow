# AcadFlow — Copilot Instructions

## Stack

React 19 + Vite 6 + Tailwind CSS v4 + Firebase Firestore (modular SDK v10). **Not Next.js** — no App Router, no `pages/` directory, no server components, no `next/*` imports.

## Commands

```bash
npm run dev      # dev server at http://localhost:5173 (hot reload)
npm run build    # production build → dist/
npm run preview  # preview production build locally
```

There is no test runner or linter script in `package.json`.

## Architecture

### Role-Based Routing (no URL routes)

`AppRouter.jsx` renders one of four lazy-loaded screens based on `sessionRole` from `AuthContext`:

- `null` + `/admin` path → `AdminLoginScreen`
- `null` + other path → `LoginScreen`
- `'admin'` → `AdminLayout`
- `'student'` → `StudentLayout`

Do **not** add `<Route>` components or `useNavigate`/`<Link>` — navigation between tabs is local state (`adminTab` / `studentTab`) inside `UIContext`.

### Context Provider Tree

```
UIProvider → DataProvider → AuthProvider → AppRouter
```

- **`UIContext`** — toast, theme (light/dark), `adminTab`, `studentTab`, dialog (replaces `alert`/`confirm`), loading bar
- **`DataContext`** — Firebase bootstrap (`_bootstrap()`), all real-time Firestore listeners, all app data (`students`, `classes`, `messages`, `activities`, `announcements`, `onlineMeetings`, `quizzes`, `resources`, `studentFeedback`, …), all write helpers
- **`AuthContext`** — session (`sessionRole`), login/logout, OTP helpers, inactivity timeout

**Never read Firestore directly from components.** All data flows through `DataContext`.

### Firebase Layer

- Initialized lazily in `DataContext._bootstrap()`. Config priority: hardcoded fallback in `firebaseInit.js` → env vars (`VITE_FB_*`) → AES-encrypted `localStorage`.
- Firestore uses long-poll mode (`experimentalAutoDetectLongPolling: true`).
- All writes go through helpers in `src/firebase/persistence.js` and `src/firebase/settings.js`, wrapped with `fbWithTimeout()` (20 s hard timeout).
- The `_fbWriting` flag in `listeners.js` (module-level, not React state) suppresses onSnapshot echoes during in-flight writes.
- Firestore collections: `students`, `classes`, `messages`, `activities`, `announcements`, `notifications`, `adminNotifs`, `admin`, `config`, `quizzes`.

### Adding Features

| Task | Where |
|---|---|
| New admin tab | `src/components/admin/tabs/` → register in `AdminLayout.jsx` (`TAB_TITLES` map + lazy import + render switch) |
| New student tab | `src/components/student/tabs/` → register in `StudentLayout.jsx` |
| New Firestore collection | Add listener in `src/firebase/listeners.js` (in `fbStartListening`) → add state + callback in `DataContext` |

## Key Conventions

### Path Alias

`@` resolves to `src/`. Always use `@/...` imports, never relative `../../`.

### CDN Globals (do not npm-import)

SheetJS and jsPDF are loaded via CDN in `index.html`:
- `window.XLSX` — Excel export (`src/export/excelExport.js`)
- `window.jspdf` — PDF export (`src/export/pdfExport.js`)

### Tailwind CSS v4

- Use `@layer base` / `@layer components` for custom styles.
- Do not use v3 `@apply` patterns that conflict with v4's engine.
- `cn()` utility in `src/utils/cn.ts` combines `clsx` + `tailwind-merge` for conditional class merging.

### Security — Non-Negotiable Rules

- **Passwords:** SHA-256 + salt via `hashPassword()` / `verifyPassword()` in `src/utils/crypto.js`. Never store plaintext.
- **Firebase config + EmailJS credentials:** AES-encrypted with `encryptFbConfig()` / `encryptEJS()` before writing to `localStorage`. Plaintext config is removed 3 s after init.
- **Login lockout:** `recordFailedAttempt()` / `isLockedOut()` in `src/utils/validate.js`.
- **User-generated HTML:** Always sanitize with DOMPurify before rendering. Safe tag whitelist: `b, i, u, em, strong, mark, p, br, ul, ol, li, h3, h4`.
- **Comment/reply IDs:** Use UUID v4 (`import { v4 as uuidv4 } from 'uuid'`) — never `Date.now()` or weak generation.
- **Concurrent Firestore writes:** Use `runTransaction` for comment operations to prevent lost updates.

### Session & Inactivity

Sessions expire after 30 minutes of inactivity. Expiry is also checked on tab focus. Managed in `AuthContext` via `useSession` hook.

### Utility Helpers

| Module | Purpose |
|---|---|
| `src/utils/attendance.js` | Attendance calculation, `serializeStudents` / `deserializeStudents` |
| `src/utils/grades.js` | GWA computation, equivalence scale (`DEFAULT_EQ_SCALE`) |
| `src/utils/crypto.js` | SHA-256 hashing, AES encryption/decryption |
| `src/utils/format.js` | Display formatting |
| `src/utils/otp.js` | OTP generation and verification |
| `src/utils/validate.js` | Login lockout logic |
