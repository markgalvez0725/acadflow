# AcadFlow — Agent Guide

## Stack

React 19 + Vite 6 + Tailwind CSS v4 + Firebase Firestore (modular SDK v10).
**Not Next.js.** There is no App Router, no server components, no `pages/` directory.

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

- Initialized lazily in `DataContext._bootstrap()`. Config comes from env vars (`VITE_FB_*`) or AES-encrypted `localStorage`.
- Firestore uses long-poll mode (`experimentalAutoDetectLongPolling: true`).
- All writes go through helpers in `src/firebase/persistence.js` and `src/firebase/settings.js`, wrapped with `fbWithTimeout()` (20 s hard timeout).
- Collections: `students`, `classes`, `messages`, `activities`, `adminNotifs`, `admin`, `config`.

## Path Alias

`@` resolves to `src/`. Always use `@/...` imports, never relative `../../`.

## Styling

Tailwind CSS v4. Base and component styles must be wrapped in `@layer base` / `@layer components` blocks. Do not use v3 `@apply` patterns that conflict with v4's engine.

## Exports

SheetJS and jsPDF are loaded via CDN in `index.html` and accessed as `window.XLSX` and `window.jspdf`. Do not `import` them as npm modules.

## Security

- Passwords: SHA-256 + salt via `hashPassword()` / `verifyPassword()` in `src/utils/crypto.js`. Never store plaintext.
- Firebase config and EmailJS credentials: AES-encrypted with `encryptFbConfig()` / `encryptEJS()` before writing to `localStorage`.
- Login lockout: `recordFailedAttempt()` / `isLockedOut()` in `src/utils/validate.js`.

## Adding Features

- New admin tab → add component in `src/components/admin/tabs/`, register in `AdminLayout`.
- New student tab → add component in `src/components/student/tabs/`, register in `StudentLayout`.
- New Firestore collection → add listener in `src/firebase/listeners.js`, add state + save helper in `DataContext`.

## Development Workflow

- **Start dev server:** `npm run dev` (runs on `http://localhost:5173`)
- **Build for production:** `npm run build` (output in `dist/`)
- **Preview production build locally:** `npm run preview`
- All changes hot-reload in dev mode.

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
