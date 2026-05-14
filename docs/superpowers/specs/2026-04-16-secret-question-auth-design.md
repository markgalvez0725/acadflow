# Secret Question Auth — Design Spec

**Date:** 2026-04-16  
**Status:** Approved  

---

## Overview

Replace the OTP/EmailJS-based registration verification and forgot password flow with a secret question system. Students pick one predefined security question and provide an answer (stored as a hash) during registration. This answer is used as the sole key for self-service password reset. If they cannot answer it, they contact their teacher to reset via the existing admin reset flow.

---

## Data Model

Two new fields added to the existing `account` object on each student document in Firestore:

```js
account: {
  registered: true,
  activated: true,
  pass: "<hashed>",
  email: "...",
  securityQuestion: "mothers_maiden_name",  // key from SECURITY_QUESTIONS list
  securityAnswer: "<SHA-256 + salt hash>",  // hashed with hashPassword(), lowercased before hashing
}
```

- `securityQuestion` stores a key string (not the display label)
- `securityAnswer` stores a hash produced by `hashPassword(answer.trim().toLowerCase())`
- Verification uses `verifyPassword(input.trim().toLowerCase(), storedHash)`
- Plaintext answer is never persisted anywhere

---

## Constants: `src/utils/securityQuestions.js`

New file exporting a predefined list:

```js
export const SECURITY_QUESTIONS = [
  { key: 'mothers_maiden_name',  label: "What is your mother's maiden name?" },
  { key: 'first_pet',            label: "What was the name of your first pet?" },
  { key: 'elementary_school',    label: "What elementary school did you attend?" },
  { key: 'childhood_nickname',   label: "What was your childhood nickname?" },
  { key: 'birth_city',           label: "What city were you born in?" },
  { key: 'favorite_teacher',     label: "What is the last name of your favorite teacher?" },
  { key: 'parents_met',          label: "In what city did your parents meet?" },
  { key: 'oldest_sibling',       label: "What is the middle name of your oldest sibling?" },
]
```

Used in all three entry points: registration, ForceChangePasswordModal, forgot password.

---

## Registration Flow (`src/components/auth/LoginScreen.jsx`)

**Before:** student number → name → email → password → OTP verify → account created  
**After:** student number → name → email → password → secret question setup → account created

### Changes

- Remove `reg-otp` mode entirely
- Remove `_sendOTP`, `createOTP`, `checkOTP`, `clearOTP` calls from LoginScreen
- Remove `ejs` from `useData()` destructure in LoginScreen
- Remove `OTPBoxes` import and all OTP-related state (`otpValue`, `regPending`, `fpPending`, `otpEmailDisplay`)
- Remove `@emailjs/browser` dynamic import
- Add `reg-sq` mode: after step 1 validation passes, set `regPending` and switch to `reg-sq`
- `reg-sq` form: `<select>` populated from `SECURITY_QUESTIONS` + text input for answer
- Validation: question must be selected (not default), answer must not be empty
- On submit: hash the answer → build account object with `securityQuestion` + `securityAnswer` → call `saveStudents` → show success → redirect to sign in

### Mode flow

```
student → register → reg-sq → (success) → student
```

---

## Forgot Password Flow (`src/components/auth/LoginScreen.jsx`)

**Before:** student number → email → OTP → new password  
**After:** student number → (question displayed) → answer + new password

### Changes

- Remove `fp-otp` mode entirely
- Add `fp-sq` mode (replaces `fp-otp`)
- `forgot` mode: single field — student number only. On submit:
  - Look up student (case-insensitive ID match)
  - If no account or no `securityQuestion`: show "No account found or security question not set. Please contact your teacher."
  - If found: store canonical student ID in `fpPending`, switch to `fp-sq`
- `fp-sq` mode: displays the question label as read-only text, answer input, new password + confirm password
- On submit:
  - Validate: answer not empty, new password ≥ 8 chars, has uppercase + number, passwords match
  - Verify answer: `verifyPassword(answer.trim().toLowerCase(), student.account.securityAnswer)`
  - If wrong: "Incorrect answer. If you cannot remember, please contact your teacher to reset your password."
  - If correct: hash new password → save to Firestore → redirect to sign in

### Mode flow

```
student → forgot → fp-sq → (success) → student
```

---

## ForceChangePasswordModal (`src/components/student/modals/ForceChangePasswordModal.jsx`)

Triggered when `forceChangePassword` flag is true (student logged in with default/temp password after teacher reset, or on first login with no registered account).

**Before:** single step — new password + confirm → save → close  
**After:** two steps — (1) new password, (2) secret question setup

### Changes

- Add `step` state: `'password' | 'security-question'`
- Step 1 (unchanged UI): new password + confirm → validate → hash → save `account.pass` → advance to step 2 (do NOT close modal)
- Step 2 (new UI): `<select>` from `SECURITY_QUESTIONS` + answer text input → validate → hash answer → save `account.securityQuestion` + `account.securityAnswer` → close modal
- Step 2 is always shown, even if the student already has a security question (allows updating after teacher reset)
- Both steps save to Firestore via existing `saveStudents` helper

---

## What Is Removed

| Item | Location | Action |
|------|----------|--------|
| OTP generation/verification in LoginScreen | `LoginScreen.jsx` | Remove |
| `reg-otp` mode | `LoginScreen.jsx` | Remove |
| `fp-otp` mode | `LoginScreen.jsx` | Remove |
| `OTPBoxes` component usage | `LoginScreen.jsx` | Remove import + usage |
| `_sendOTP` function | `LoginScreen.jsx` | Remove |
| `ejs` from `useData()` | `LoginScreen.jsx` | Remove |
| `@emailjs/browser` dynamic import | `LoginScreen.jsx` | Remove |
| OTP state vars (`otpValue`, `otpEmailDisplay`, `regPending` OTP path, `fpPending` OTP path) | `LoginScreen.jsx` | Remove |
| EmailJS setup UI (if any in admin settings) | Admin settings tab | Out of scope — not touched |

> `createOTP`, `checkOTP`, `clearOTP` in `AuthContext` are **kept** — they may serve admin flows. They are simply not called from `LoginScreen` anymore.

---

## Error States

| Scenario | Message |
|----------|---------|
| Student not found on forgot password | "No account found or security question not set. Please contact your teacher." |
| Wrong secret answer | "Incorrect answer. If you cannot remember, please contact your teacher to reset your password." |
| Answer field empty | "Please enter your answer." |
| No question selected | "Please select a security question." |

---

## Files Changed

| File | Change |
|------|--------|
| `src/utils/securityQuestions.js` | **New** — predefined question list |
| `src/components/auth/LoginScreen.jsx` | Replace OTP flow with secret question flow |
| `src/components/student/modals/ForceChangePasswordModal.jsx` | Add step 2 for secret question setup |
