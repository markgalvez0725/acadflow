# Secret Question Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OTP/EmailJS-based registration and forgot-password flow with a secret question system, and add a secret question setup step to ForceChangePasswordModal.

**Architecture:** A new `src/utils/securityQuestions.js` constants file provides the predefined question list. `LoginScreen.jsx` is rewritten to remove all OTP state/modes and replace them with `reg-sq` and `fp-sq` modes. `ForceChangePasswordModal.jsx` gains a `security-question` step that runs after the password step.

**Tech Stack:** React 19, Tailwind CSS v4, Firebase Firestore (via existing `saveStudents` helper), `hashPassword`/`verifyPassword` from `src/utils/crypto.js`

---

### Task 1: Create `src/utils/securityQuestions.js`

**Files:**
- Create: `src/utils/securityQuestions.js`

- [ ] **Step 1: Create the constants file**

```js
// src/utils/securityQuestions.js
export const SECURITY_QUESTIONS = [
  { key: 'mothers_maiden_name', label: "What is your mother's maiden name?" },
  { key: 'first_pet',           label: "What was the name of your first pet?" },
  { key: 'elementary_school',   label: "What elementary school did you attend?" },
  { key: 'childhood_nickname',  label: "What was your childhood nickname?" },
  { key: 'birth_city',          label: "What city were you born in?" },
  { key: 'favorite_teacher',    label: "What is the last name of your favorite teacher?" },
  { key: 'parents_met',         label: "In what city did your parents meet?" },
  { key: 'oldest_sibling',      label: "What is the middle name of your oldest sibling?" },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/securityQuestions.js
git commit -m "feat: add predefined security questions list"
```

---

### Task 2: Rewrite `LoginScreen.jsx` — remove all OTP code, update imports and state

**Files:**
- Modify: `src/components/auth/LoginScreen.jsx`

- [ ] **Step 1: Replace the import block and remove OTP-related state**

Replace the top of the file (lines 1–55) with:

```jsx
import React, { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'
import { SECURITY_QUESTIONS } from '@/utils/securityQuestions'

const EyeIcon = ({ visible }) => visible
  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>

// Modes: 'student' | 'register' | 'reg-sq' | 'forgot' | 'fp-sq'
export default function LoginScreen() {
  const { loginStudent, hashPassword, verifyPassword } = useAuth()
  const { students, saveStudents } = useData()
  const { toast, theme } = useUI()

  const [mode, setMode]       = useState('student')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')
  const [okMsg, setOkMsg]     = useState('')

  // Login form
  const [snum, setSnum] = useState('')
  const [pass, setPass] = useState('')

  // Register form
  const [regSnum,  setRegSnum]  = useState('')
  const [regName,  setRegName]  = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPass,  setRegPass]  = useState('')
  const [regPass2, setRegPass2] = useState('')

  // Register secret question form
  const [regPending,  setRegPending]  = useState(null) // { snum, name, email, pass }
  const [regSqKey,    setRegSqKey]    = useState('')
  const [regSqAnswer, setRegSqAnswer] = useState('')

  // Forgot form
  const [fpSnum,    setFpSnum]    = useState('')
  const [fpPending, setFpPending] = useState(null) // { snum: canonical id }

  // Forgot secret question answer + new password
  const [fpAnswer,   setFpAnswer]   = useState('')
  const [fpNewPass,  setFpNewPass]  = useState('')
  const [fpNewPass2, setFpNewPass2] = useState('')

  // Show/hide password toggles
  const [showPass,     setShowPass]     = useState(false)
  const [showRegPass,  setShowRegPass]  = useState(false)
  const [showRegPass2, setShowRegPass2] = useState(false)
  const [showFpPass,   setShowFpPass]   = useState(false)
  const [showFpPass2,  setShowFpPass2]  = useState(false)

  const clearMessages = () => { setErr(''); setOkMsg('') }
```

> Note: `hashPassword` and `verifyPassword` are module-level exports from `@/utils/crypto` — they are NOT methods on `AuthContext`. The destructure from `useAuth()` should only include what AuthContext actually exposes. Update the destructure to:
> ```js
> const { loginStudent } = useAuth()
> ```
> And import crypto helpers directly:
> ```js
> import { hashPassword, verifyPassword } from '@/utils/crypto'
> ```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/LoginScreen.jsx
git commit -m "refactor: remove OTP state and imports from LoginScreen"
```

---

### Task 3: Add student login handler and register step 1 handler to LoginScreen

**Files:**
- Modify: `src/components/auth/LoginScreen.jsx`

- [ ] **Step 1: Add handlers after `clearMessages`**

Add these functions after `const clearMessages = ...`:

```jsx
  // ── Student login ──────────────────────────────────────────────────────
  async function handleStudentLogin(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const result = await loginStudent(snum.trim(), pass, students)
      if (!result.ok) {
        setErr(result.msg)
        setPass('')
      } else {
        const original = students.find(s => s.id === result.student?.id)
        if (result.student?.account?.firstLoginAt && !original?.account?.firstLoginAt) {
          saveStudents(
            students.map(s => s.id === result.student.id ? result.student : s),
            [result.student.id]
          )
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Register Step 1 ────────────────────────────────────────────────────
  async function handleRegStep1(e) {
    e.preventDefault()
    clearMessages()

    const snErr = validateSnum(regSnum)
    if (snErr) return setErr(snErr)
    if (!regName.trim()) return setErr('Please enter your full name.')
    if (!regEmail.includes('@')) return setErr('Please enter a valid email address.')
    if (regPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(regPass) || !/[0-9]/.test(regPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (regPass !== regPass2) return setErr('Passwords do not match.')

    const existing = students.find(s => s.id === regSnum)
    if (existing?.account?.registered)
      return setErr('⛔ An account already exists for this student number. Use "Forgot Password" if needed.')

    const nameDup = students.find(s =>
      s.name?.trim().toLowerCase() === regName.trim().toLowerCase() &&
      s.account?.registered && s.id !== regSnum
    )
    if (nameDup)
      return setErr('⛔ An account with this name already exists. Please check your student number.')

    const emailDup = students.find(s =>
      s.account?.registered && s.account?.email?.toLowerCase() === regEmail.toLowerCase()
    )
    if (emailDup)
      return setErr('⛔ This email is already linked to another account.')

    setRegPending({ snum: regSnum, name: regName, email: regEmail, pass: regPass })
    setRegSqKey('')
    setRegSqAnswer('')
    setMode('reg-sq')
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/LoginScreen.jsx
git commit -m "feat: add login and register step 1 handlers (no OTP)"
```

---

### Task 4: Add register secret question handler (reg-sq) to LoginScreen

**Files:**
- Modify: `src/components/auth/LoginScreen.jsx`

- [ ] **Step 1: Add the reg-sq submit handler**

Add after `handleRegStep1`:

```jsx
  // ── Register Step 2 — secret question ─────────────────────────────────
  async function handleRegSq(e) {
    e.preventDefault()
    clearMessages()
    if (!regSqKey) return setErr('Please select a security question.')
    if (!regSqAnswer.trim()) return setErr('Please enter your answer.')
    if (!regPending) return setErr('Session expired. Please start registration again.')

    setLoading(true)
    try {
      const hashedPass   = await hashPassword(regPending.pass)
      const hashedAnswer = await hashPassword(regSqAnswer.trim().toLowerCase())

      const updatedStudents = [...students]
      const idx = updatedStudents.findIndex(s => s.id === regPending.snum)
      if (idx >= 0) {
        updatedStudents[idx] = {
          ...updatedStudents[idx],
          account: {
            registered: true,
            activated: true,
            pass: hashedPass,
            email: regPending.email,
            securityQuestion: regSqKey,
            securityAnswer: hashedAnswer,
          },
          name: updatedStudents[idx].name || regPending.name,
        }
      } else {
        updatedStudents.push({
          id: regPending.snum,
          name: regPending.name,
          course: '', year: '', mobile: '', dob: '',
          classId: null, grades: {}, attendance: {}, excuse: {}, gradeComponents: {},
          account: {
            registered: true,
            activated: true,
            pass: hashedPass,
            email: regPending.email,
            securityQuestion: regSqKey,
            securityAnswer: hashedAnswer,
          },
        })
      }

      await saveStudents(updatedStudents, [regPending.snum])
      setOkMsg('✅ Account created successfully! Redirecting to sign in…')
      setTimeout(() => { setMode('student'); setOkMsg(''); setRegPending(null) }, 1800)
    } catch (e) {
      setErr('Failed to save account: ' + e.message)
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/LoginScreen.jsx
git commit -m "feat: add register secret question step handler"
```

---

### Task 5: Add forgot password handlers (forgot + fp-sq) to LoginScreen

**Files:**
- Modify: `src/components/auth/LoginScreen.jsx`

- [ ] **Step 1: Add both forgot handlers**

Add after `handleRegSq`:

```jsx
  // ── Forgot Step 1 — look up student ───────────────────────────────────
  async function handleFpStep1(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const s = students.find(x => x.id.toLowerCase() === fpSnum.trim().toLowerCase())
      if (!s?.account?.registered || !s.account?.securityQuestion) {
        return setErr('No account found or security question not set. Please contact your teacher.')
      }
      setFpPending({ snum: s.id })
      setFpAnswer('')
      setFpNewPass('')
      setFpNewPass2('')
      setMode('fp-sq')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Step 2 — verify answer + set new password ──────────────────
  async function handleFpStep2(e) {
    e.preventDefault()
    clearMessages()
    if (!fpAnswer.trim()) return setErr('Please enter your answer.')
    if (fpNewPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(fpNewPass) || !/[0-9]/.test(fpNewPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (fpNewPass !== fpNewPass2) return setErr('Passwords do not match.')
    if (!fpPending) return setErr('Session expired. Please start again.')

    const s = students.find(x => x.id === fpPending.snum)
    if (!s) return setErr('Student account not found.')

    const answerMatch = await verifyPassword(fpAnswer.trim().toLowerCase(), s.account.securityAnswer)
    if (!answerMatch)
      return setErr('Incorrect answer. If you cannot remember, please contact your teacher to reset your password.')

    setLoading(true)
    try {
      const hashed = await hashPassword(fpNewPass)
      const updatedStudents = students.map(x =>
        x.id === s.id ? { ...x, account: { ...x.account, pass: hashed } } : x
      )
      await saveStudents(updatedStudents, [s.id])
      setOkMsg('Password reset! Redirecting…')
      setTimeout(() => { setMode('student'); setOkMsg(''); setFpPending(null) }, 1800)
    } catch (e) {
      setErr('Failed to save: ' + e.message)
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/LoginScreen.jsx
git commit -m "feat: add forgot password secret question handlers"
```

---

### Task 6: Add JSX render for all modes in LoginScreen

**Files:**
- Modify: `src/components/auth/LoginScreen.jsx`

- [ ] **Step 1: Replace the entire return block**

Replace the `return (...)` at the bottom of LoginScreen with:

```jsx
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-bg" id="login-screen">
      <WeatherScene isDark={theme === 'dark'} showBadge style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <ThemeToggle />

      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/logo.png" alt="AcadFlow" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="font-display text-3xl font-bold text-ink">AcadFlow</h1>
          <p className="text-xs text-ink3 mt-1">Academic Management System</p>
        </div>

        {/* Mode tabs — only on sign-in / register screens */}
        {(mode === 'student' || mode === 'register') && (
          <div className="flex rounded-xl bg-bg2 p-1 mb-5">
            {[['student', 'Sign In'], ['register', 'Register']].map(([m, label]) => (
              <button
                key={m}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === m ? 'bg-surface text-ink shadow' : 'text-ink2 hover:text-ink'}`}
                onClick={() => { setMode(m); clearMessages() }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="card card-pad">
          {err  && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
          {okMsg && <div className="ok-msg" style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Student Login ───────────────────────────────────────── */}
          {mode === 'student' && (
            <form onSubmit={handleStudentLogin}>
              <div className="field-float">
                <input type="text" placeholder=" " value={snum} onChange={e => setSnum(sanitizeSnum(e.target.value))} autoComplete="username" />
                <label>Student Number</label>
              </div>
              <div className="field-float">
                <input type={showPass ? 'text' : 'password'} placeholder=" " value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" style={{ paddingRight: 38 }} />
                <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}><EyeIcon visible={showPass} /></button>
                <label>Password</label>
              </div>
              <LoadingButton loading={loading} loadingText="Signing in…" className="btn btn-primary btn-full mt-2">Sign In</LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { setMode('forgot'); clearMessages() }}>
                Forgot Password?
              </button>
            </form>
          )}

          {/* ── Register Step 1 ─────────────────────────────────────── */}
          {mode === 'register' && (
            <form onSubmit={handleRegStep1}>
              <div className="field-float">
                <input type="text" placeholder=" " value={regSnum} onChange={e => setRegSnum(sanitizeSnum(e.target.value))} />
                <label>Student Number</label>
              </div>
              <div className="field-float">
                <input type="text" placeholder=" " value={regName} onChange={e => setRegName(e.target.value)} />
                <label>Full Name</label>
              </div>
              <div className="field-float">
                <input type="email" placeholder=" " value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                <label>Email Address</label>
              </div>
              <div className="field-float">
                <input type={showRegPass ? 'text' : 'password'} placeholder=" " value={regPass} onChange={e => setRegPass(e.target.value)} style={{ paddingRight: 38 }} />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass(v => !v)} tabIndex={-1}><EyeIcon visible={showRegPass} /></button>
                <label>Password</label>
              </div>
              <div className="field-float">
                <input type={showRegPass2 ? 'text' : 'password'} placeholder=" " value={regPass2} onChange={e => setRegPass2(e.target.value)} style={{ paddingRight: 38 }} />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass2(v => !v)} tabIndex={-1}><EyeIcon visible={showRegPass2} /></button>
                <label>Confirm Password</label>
              </div>
              <LoadingButton loading={loading} loadingText="Next…" className="btn btn-primary btn-full mt-2">Next →</LoadingButton>
            </form>
          )}

          {/* ── Register Step 2 — Secret Question ──────────────────── */}
          {mode === 'reg-sq' && (
            <form onSubmit={handleRegSq}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Set Security Question</h3>
              <p className="text-xs text-ink2 mb-4">Choose a question and answer you will remember. This is used to reset your password if you forget it.</p>
              <div className="field-float">
                <select
                  value={regSqKey}
                  onChange={e => setRegSqKey(e.target.value)}
                  style={{ paddingTop: 18, paddingBottom: 6 }}
                >
                  <option value="" disabled>Select a question…</option>
                  {SECURITY_QUESTIONS.map(q => (
                    <option key={q.key} value={q.key}>{q.label}</option>
                  ))}
                </select>
                <label>Security Question</label>
              </div>
              <div className="field-float">
                <input type="text" placeholder=" " value={regSqAnswer} onChange={e => setRegSqAnswer(e.target.value)} autoComplete="off" />
                <label>Your Answer</label>
              </div>
              <LoadingButton loading={loading} loadingText="Creating account…" className="btn btn-primary btn-full mt-2">Create Account</LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('register'); clearMessages() }}>← Back</button>
            </form>
          )}

          {/* ── Forgot Password Step 1 ──────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleFpStep1}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Forgot Password</h3>
              <p className="text-xs text-ink2 mb-4">Enter your student number to retrieve your security question.</p>
              <div className="field-float">
                <input type="text" placeholder=" " value={fpSnum} onChange={e => setFpSnum(sanitizeSnum(e.target.value))} />
                <label>Student Number</label>
              </div>
              <LoadingButton loading={loading} loadingText="Looking up…" className="btn btn-primary btn-full mt-2">Continue →</LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('student'); clearMessages() }}>← Back to Sign In</button>
            </form>
          )}

          {/* ── Forgot Password Step 2 — Answer + New Password ──────── */}
          {mode === 'fp-sq' && (() => {
            const s = students.find(x => x.id === fpPending?.snum)
            const q = SECURITY_QUESTIONS.find(q => q.key === s?.account?.securityQuestion)
            return (
              <form onSubmit={handleFpStep2}>
                <h3 className="font-display text-lg font-bold text-ink mb-1">Reset Password</h3>
                <p className="text-xs text-ink2 mb-3">Answer your security question to set a new password.</p>
                <div className="mb-4 p-3 rounded-xl bg-bg2 text-sm text-ink font-medium">{q?.label ?? 'Security question not found.'}</div>
                <div className="field-float">
                  <input type="text" placeholder=" " value={fpAnswer} onChange={e => setFpAnswer(e.target.value)} autoComplete="off" />
                  <label>Your Answer</label>
                </div>
                <div className="field-float" style={{ marginTop: 10 }}>
                  <input type={showFpPass ? 'text' : 'password'} placeholder=" " value={fpNewPass} onChange={e => setFpNewPass(e.target.value)} style={{ paddingRight: 38 }} />
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass(v => !v)} tabIndex={-1}><EyeIcon visible={showFpPass} /></button>
                  <label>New Password</label>
                </div>
                <div className="field-float">
                  <input type={showFpPass2 ? 'text' : 'password'} placeholder=" " value={fpNewPass2} onChange={e => setFpNewPass2(e.target.value)} style={{ paddingRight: 38 }} />
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass2(v => !v)} tabIndex={-1}><EyeIcon visible={showFpPass2} /></button>
                  <label>Confirm New Password</label>
                </div>
                <LoadingButton loading={loading} loadingText="Saving…" className="btn btn-primary btn-full mt-2">Set New Password</LoadingButton>
                <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('forgot'); clearMessages() }}>← Back</button>
              </form>
            )
          })()}
        </div>

        {(mode === 'student' || mode === 'register') && (
          <p className="text-center text-xs text-ink3 mt-4">
            Are you a teacher?{' '}
            <a href="/admin" className="text-accent-m underline">Admin Login →</a>
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/LoginScreen.jsx
git commit -m "feat: replace OTP JSX with secret question modes in LoginScreen"
```

---

### Task 7: Update ForceChangePasswordModal — add security question step

**Files:**
- Modify: `src/components/student/modals/ForceChangePasswordModal.jsx`

The modal currently has steps: `'password'` and `'email'`. The `'email'` step must be replaced with `'security-question'`. After password is saved, always advance to the security question step (not email). The email step and `handleSubmitEmail`/`handleSkipEmail` are removed.

- [ ] **Step 1: Replace the entire file**

```jsx
import React, { useState, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { hashPassword, verifyPassword } from '@/utils/crypto'
import { SECURITY_QUESTIONS } from '@/utils/securityQuestions'
import { KeyRound, ShieldQuestion, AlertTriangle, Check, X } from 'lucide-react'

export default function ForceChangePasswordModal({ student: s, onClose, forced = false }) {
  const { students, saveStudents } = useData()
  const { setCurrentStudent } = useAuth()
  const { toast } = useUI()

  // step: 'password' | 'security-question'
  const [step, setStep] = useState('password')
  const [updatedStudent, setUpdatedStudent] = useState(null)

  // Password step
  const [oldPass, setOldPass] = useState('')
  const [pass,    setPass]    = useState('')
  const [pass2,   setPass2]   = useState('')
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)

  // Security question step
  const [sqKey,    setSqKey]    = useState('')
  const [sqAnswer, setSqAnswer] = useState('')
  const [sqError,  setSqError]  = useState('')

  const inputRef = useRef(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [step])

  async function handleSubmitPassword() {
    setError('')

    if (!forced) {
      if (!oldPass) { setError('Please enter your current password.'); return }
      const match = await verifyPassword(oldPass, s.account?.pass)
      if (!match) { setError('Current password is incorrect.'); return }
      if (oldPass === pass) { setError('New password must be different from your current password.'); return }
    }

    if (pass.length < 8)                             { setError('Password must be at least 8 characters.'); return }
    if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) { setError('Password must include at least one uppercase letter and one number.'); return }
    if (pass !== pass2)                              { setError('Passwords do not match.'); return }

    setSaving(true)
    try {
      const hashed = await hashPassword(pass)
      const updatedStudents = students.map(x => {
        if (x.id !== s.id) return x
        const updated = { ...x }
        if (!updated.account) updated.account = {}
        updated.account = { ...updated.account, pass: hashed, activated: true }
        delete updated.account._tempPass
        delete updated.forceChangePassword
        return updated
      })
      await saveStudents(updatedStudents, [s.id])
      const fresh = updatedStudents.find(x => x.id === s.id)
      if (fresh) {
        setCurrentStudent(fresh)
        setUpdatedStudent(fresh)
      }
      setSqKey('')
      setSqAnswer('')
      setStep('security-question')
    } catch (e) {
      setError('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmitSecurityQuestion() {
    setSqError('')
    if (!sqKey) { setSqError('Please select a security question.'); return }
    if (!sqAnswer.trim()) { setSqError('Please enter your answer.'); return }

    setSaving(true)
    try {
      const hashedAnswer = await hashPassword(sqAnswer.trim().toLowerCase())
      const base = updatedStudent || s
      const updatedStudents = students.map(x => {
        if (x.id !== base.id) return x
        return {
          ...x,
          account: {
            ...x.account,
            securityQuestion: sqKey,
            securityAnswer: hashedAnswer,
          },
        }
      })
      await saveStudents(updatedStudents, [base.id])
      const fresh = updatedStudents.find(x => x.id === base.id)
      if (fresh) setCurrentStudent(fresh)
      toast('Account set up successfully!', 'success')
      onClose()
    } catch (e) {
      setSqError('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Security question step ───────────────────────────────────────────────
  if (step === 'security-question') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>

          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ marginBottom: 8, color: 'var(--accent)' }}><ShieldQuestion size={40} style={{ display: 'inline-block' }} /></div>
            <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.2rem', marginBottom: 6 }}>Set Security Question</h3>
            <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
              Choose a question and answer you will remember. This is how you can reset your password if you forget it.
            </p>
          </div>

          <div style={{ background: 'var(--yellow-l)', border: '1px solid var(--yellow)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--yellow)', fontWeight: 600 }}>
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Remember your answer — you cannot change it without logging in first.
          </div>

          {sqError && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'var(--red-l)', borderRadius: 8, borderLeft: '3px solid var(--red)' }}>
              {sqError}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Security Question</label>
            <select
              className="input"
              value={sqKey}
              onChange={e => setSqKey(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="" disabled>Select a question…</option>
              {SECURITY_QUESTIONS.map(q => (
                <option key={q.key} value={q.key}>{q.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Your Answer</label>
            <input
              ref={inputRef}
              type="text"
              className="input"
              placeholder="Your answer (case-insensitive)"
              value={sqAnswer}
              onChange={e => setSqAnswer(e.target.value)}
              autoComplete="off"
              onKeyDown={e => e.key === 'Enter' && handleSubmitSecurityQuestion()}
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}
            onClick={handleSubmitSecurityQuestion}
            disabled={saving}
          >
            {saving ? 'Saving…' : <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Save & Finish</>}
          </button>
        </div>
      </div>
    )
  }

  // ── Password step ────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ marginBottom: 8, color: 'var(--accent)' }}><KeyRound size={40} style={{ display: 'inline-block' }} /></div>
          <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.2rem', marginBottom: 6 }}>Change Your Password</h3>
          <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
            {forced
              ? 'Your account was set up with a temporary password. Please choose a personal password before continuing.'
              : 'Enter your current password, then choose a new one.'}
          </p>
        </div>

        {forced && (
          <div style={{ background: 'var(--yellow-l)', border: '1px solid var(--yellow)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--yellow)', fontWeight: 600 }}>
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />You cannot skip this step. Your temporary password will be replaced.
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'var(--red-l)', borderRadius: 8, borderLeft: '3px solid var(--red)' }}>
            {error}
          </div>
        )}

        {!forced && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Current Password</label>
            <input
              ref={inputRef}
              type="password"
              className="input"
              placeholder="Your current password"
              value={oldPass}
              onChange={e => setOldPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>New Password</label>
          <input
            ref={forced ? inputRef : undefined}
            type="password"
            className="input"
            placeholder="Min. 8 chars, 1 uppercase, 1 number"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Confirm Password</label>
          <input
            type="password"
            className="input"
            placeholder="Repeat your new password"
            value={pass2}
            onChange={e => setPass2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}
          onClick={handleSubmitPassword}
          disabled={saving}
        >
          {saving ? 'Saving…' : <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Set My Password</>}
        </button>

        {!forced && (
          <button
            className="btn"
            style={{ width: '100%', padding: 10, fontSize: 14, marginTop: 8 }}
            onClick={onClose}
            disabled={saving}
          >
            <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Cancel
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/student/modals/ForceChangePasswordModal.jsx
git commit -m "feat: add security question step to ForceChangePasswordModal"
```

---

### Task 8: Build verification and push

**Files:** No file changes — verification only.

- [ ] **Step 1: Run the production build**

```bash
npm run build
```

Expected: build completes with no errors. Warnings about chunk size are acceptable.

- [ ] **Step 2: If build passes, push**

```bash
git push
```

- [ ] **Step 3: If build fails, fix errors then push**

Common issues to check:
- Unused import left in LoginScreen (e.g. `OTPBoxes`, `createOTP`)
- `ShieldQuestion` not available in the installed version of `lucide-react` — if so, replace with `Shield` or `HelpCircle`
- `verifyPassword` imported but not used in LoginScreen (it IS used in `handleFpStep2` — verify import is present)
