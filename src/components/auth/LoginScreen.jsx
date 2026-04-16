import React, { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { hashPassword, verifyPassword } from '@/utils/crypto'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import { SECURITY_QUESTIONS } from '@/utils/securityQuestions'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'

const EyeIcon = ({ visible }) => visible
  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>

// Modes: 'student' | 'register' | 'reg-sq' | 'forgot' | 'fp-set-sq' | 'fp-sq'
export default function LoginScreen() {
  const { loginStudent } = useAuth()
  const { students, saveStudents, fbReady } = useData()
  const { theme } = useUI()

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

  // Register secret question step
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

  // Forgot — set security question (for legacy accounts without one)
  const [fpSetSqKey,    setFpSetSqKey]    = useState('')
  const [fpSetSqAnswer, setFpSetSqAnswer] = useState('')

  // Show/hide password toggles
  const [showPass,     setShowPass]     = useState(false)
  const [showRegPass,  setShowRegPass]  = useState(false)
  const [showRegPass2, setShowRegPass2] = useState(false)
  const [showFpPass,   setShowFpPass]   = useState(false)
  const [showFpPass2,  setShowFpPass2]  = useState(false)

  const clearMessages = () => { setErr(''); setOkMsg('') }

  // ── Student login ────────────────────────────────────────────────────────
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

  // ── Register Step 1 — validate fields, advance to secret question ────────
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

  // ── Register Step 2 — save account with secret question ─────────────────
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

  // ── Forgot Step 1 — look up student, display security question ───────────
  async function handleFpStep1(e) {
    e.preventDefault()
    clearMessages()
    if (!fbReady || students.length === 0) {
      return setErr('Student data is still loading. Please wait a moment and try again.')
    }
    setLoading(true)
    try {
      const s = students.find(x => x.id.toLowerCase() === fpSnum.trim().toLowerCase())
      if (!s) {
        return setErr('No account found for that student number. Please contact your teacher.')
      }
      if (!s.account?.registered) {
        return setErr('This account has not been registered yet. Please register first.')
      }
      setFpPending({ snum: s.id })
      if (!s.account?.securityQuestion) {
        // Legacy account — let them set a security question first
        setFpSetSqKey('')
        setFpSetSqAnswer('')
        setMode('fp-set-sq')
      } else {
        setFpAnswer('')
        setFpNewPass('')
        setFpNewPass2('')
        setMode('fp-sq')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Step 1b — set security question for legacy accounts ──────────
  async function handleFpSetSq(e) {
    e.preventDefault()
    clearMessages()
    if (!fpSetSqKey) return setErr('Please select a security question.')
    if (!fpSetSqAnswer.trim()) return setErr('Please enter your answer.')
    if (!fpPending) return setErr('Session expired. Please start again.')
    setLoading(true)
    try {
      const hashedAnswer = await hashPassword(fpSetSqAnswer.trim().toLowerCase())
      const updatedStudents = students.map(x =>
        x.id !== fpPending.snum ? x : {
          ...x,
          account: { ...x.account, securityQuestion: fpSetSqKey, securityAnswer: hashedAnswer },
        }
      )
      await saveStudents(updatedStudents, [fpPending.snum])
      setFpAnswer('')
      setFpNewPass('')
      setFpNewPass2('')
      setMode('fp-sq')
    } catch (e) {
      setErr('Failed to save security question: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Step 2 — verify answer, save new password ────────────────────
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
          {err   && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
          {okMsg && <div className="ok-msg"  style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Student Login ─────────────────────────────────────────── */}
          {mode === 'student' && (
            <form onSubmit={handleStudentLogin}>
              <div className="field-float">
                <input
                  type="text"
                  placeholder=" "
                  value={snum}
                  onChange={e => setSnum(sanitizeSnum(e.target.value))}
                  autoComplete="username"
                />
                <label>Student Number</label>
              </div>
              <div className="field-float">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder=" "
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                  <EyeIcon visible={showPass} />
                </button>
                <label>Password</label>
              </div>
              <LoadingButton loading={loading} loadingText="Signing in…" className="btn btn-primary btn-full mt-2">
                Sign In
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { setMode('forgot'); clearMessages() }}>
                Forgot Password?
              </button>
            </form>
          )}

          {/* ── Register Step 1 ──────────────────────────────────────── */}
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
                <input
                  type={showRegPass ? 'text' : 'password'}
                  placeholder=" "
                  value={regPass}
                  onChange={e => setRegPass(e.target.value)}
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass(v => !v)} tabIndex={-1}>
                  <EyeIcon visible={showRegPass} />
                </button>
                <label>Password</label>
              </div>
              <div className="field-float">
                <input
                  type={showRegPass2 ? 'text' : 'password'}
                  placeholder=" "
                  value={regPass2}
                  onChange={e => setRegPass2(e.target.value)}
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass2(v => !v)} tabIndex={-1}>
                  <EyeIcon visible={showRegPass2} />
                </button>
                <label>Confirm Password</label>
              </div>
              <LoadingButton loading={loading} loadingText="Next…" className="btn btn-primary btn-full mt-2">
                Next →
              </LoadingButton>
            </form>
          )}

          {/* ── Register Step 2 — Secret Question ────────────────────── */}
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
                <input
                  type="text"
                  placeholder=" "
                  value={regSqAnswer}
                  onChange={e => setRegSqAnswer(e.target.value)}
                  autoComplete="off"
                />
                <label>Your Answer</label>
              </div>
              <LoadingButton loading={loading} loadingText="Creating account…" className="btn btn-primary btn-full mt-2">
                Create Account
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('register'); clearMessages() }}>
                ← Back
              </button>
            </form>
          )}

          {/* ── Forgot Password Step 1 ───────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleFpStep1}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Forgot Password</h3>
              <p className="text-xs text-ink2 mb-4">Enter your student number to retrieve your security question.</p>
              <div className="field-float">
                <input
                  type="text"
                  placeholder=" "
                  value={fpSnum}
                  onChange={e => setFpSnum(sanitizeSnum(e.target.value))}
                />
                <label>Student Number</label>
              </div>
              <LoadingButton loading={loading} loadingText="Looking up…" className="btn btn-primary btn-full mt-2">
                Continue →
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('student'); clearMessages() }}>
                ← Back to Sign In
              </button>
            </form>
          )}

          {/* ── Forgot Password Step 1b — Set Security Question ─────── */}
          {mode === 'fp-set-sq' && (
            <form onSubmit={handleFpSetSq}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Set Security Question</h3>
              <p className="text-xs text-ink2 mb-4">Your account doesn't have a security question yet. Set one to continue resetting your password.</p>
              <div className="field-float">
                <select
                  value={fpSetSqKey}
                  onChange={e => setFpSetSqKey(e.target.value)}
                  className="w-full"
                >
                  <option value="">Select a question…</option>
                  {SECURITY_QUESTIONS.map(q => (
                    <option key={q.key} value={q.key}>{q.label}</option>
                  ))}
                </select>
                <label>Security Question</label>
              </div>
              <div className="field-float">
                <input
                  type="text"
                  placeholder=" "
                  value={fpSetSqAnswer}
                  onChange={e => setFpSetSqAnswer(e.target.value)}
                  autoComplete="off"
                />
                <label>Your Answer</label>
              </div>
              <LoadingButton loading={loading} loadingText="Saving…" className="btn btn-primary btn-full mt-2">
                Continue →
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('forgot'); clearMessages() }}>
                ← Back
              </button>
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
                <div className="mb-4 p-3 rounded-xl bg-bg2 text-sm text-ink font-medium">
                  {q?.label ?? 'Security question not found.'}
                </div>
                <div className="field-float">
                  <input
                    type="text"
                    placeholder=" "
                    value={fpAnswer}
                    onChange={e => setFpAnswer(e.target.value)}
                    autoComplete="off"
                  />
                  <label>Your Answer</label>
                </div>
                <div className="field-float" style={{ marginTop: 10 }}>
                  <input
                    type={showFpPass ? 'text' : 'password'}
                    placeholder=" "
                    value={fpNewPass}
                    onChange={e => setFpNewPass(e.target.value)}
                    style={{ paddingRight: 38 }}
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass(v => !v)} tabIndex={-1}>
                    <EyeIcon visible={showFpPass} />
                  </button>
                  <label>New Password</label>
                </div>
                <div className="field-float">
                  <input
                    type={showFpPass2 ? 'text' : 'password'}
                    placeholder=" "
                    value={fpNewPass2}
                    onChange={e => setFpNewPass2(e.target.value)}
                    style={{ paddingRight: 38 }}
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass2(v => !v)} tabIndex={-1}>
                    <EyeIcon visible={showFpPass2} />
                  </button>
                  <label>Confirm New Password</label>
                </div>
                <LoadingButton loading={loading} loadingText="Saving…" className="btn btn-primary btn-full mt-2">
                  Set New Password
                </LoadingButton>
                <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('forgot'); clearMessages() }}>
                  ← Back
                </button>
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
