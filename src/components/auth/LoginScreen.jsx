import React, { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import OTPBoxes from '@/components/primitives/OTPBoxes'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'

const EyeIcon = ({ visible }) => visible
  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>

// Modes: 'student' | 'register' | 'reg-otp' | 'forgot' | 'fp-otp'
export default function LoginScreen() {
  const { loginStudent, createOTP, checkOTP, clearOTP, hashPassword } = useAuth()
  const { students, saveStudents, ejs } = useData()
  const { toast, theme } = useUI()

  const [mode, setMode]         = useState('student')
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')
  const [otpValue, setOtpValue] = useState('')

  // Login form
  const [snum, setSnum]   = useState('')
  const [pass, setPass]   = useState('')

  // Register form
  const [regSnum, setRegSnum]   = useState('')
  const [regName, setRegName]   = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPass, setRegPass]   = useState('')
  const [regPass2, setRegPass2] = useState('')

  // Forgot form
  const [fpSnum, setFpSnum]   = useState('')
  const [fpEmail, setFpEmail] = useState('')
  const [fpNewPass, setFpNewPass]   = useState('')
  const [fpNewPass2, setFpNewPass2] = useState('')

  // Show/hide password toggles
  const [showPass, setShowPass]       = useState(false)
  const [showRegPass, setShowRegPass] = useState(false)
  const [showRegPass2, setShowRegPass2] = useState(false)
  const [showFpPass, setShowFpPass]   = useState(false)
  const [showFpPass2, setShowFpPass2] = useState(false)

  // Pending OTP context stored in ref-like state
  const [regPending, setRegPending] = useState(null)
  const [fpPending, setFpPending]   = useState(null)
  const [otpEmailDisplay, setOtpEmailDisplay] = useState('')

  const clearMessages = () => { setErr(''); setOkMsg('') }

  async function _sendOTP(ctx, email, name) {
    const code = createOTP(ctx, email)
    if (!ejs.configured) {
      if (import.meta.env.DEV) {
        console.warn('[OTP] EJS not configured — showing code in console (dev mode):', code)
      }
      return code
    }
    try {
      const { send } = await import('@emailjs/browser')
      await send(ejs.serviceId, ejs.templateId, {
        to_email: email,
        to_name: name,
        otp_code: code,
        reason: ctx,
      }, ejs.publicKey)
    } catch (e) {
      console.warn('[OTP] Email send failed:', e.message)
    }
    return code
  }

  // ── Student login ───────────────────────────────────────────────────────
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
        // Persist firstLoginAt if it was just set for the first time
        const original = students.find(s => s.id === result.student?.id)
        if (
          result.student?.account?.firstLoginAt &&
          !original?.account?.firstLoginAt
        ) {
          saveStudents(
            students.map(s => s.id === result.student.id ? result.student : s),
            [result.student.id]
          )
        }
      }
      // On success, AuthContext sets sessionRole → AppRouter renders StudentLayout
    } finally {
      setLoading(false)
    }
  }

  // ── Register Step 1 ─────────────────────────────────────────────────────
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
      s.account?.registered &&
      s.id !== regSnum
    )
    if (nameDup)
      return setErr('⛔ An account with this name already exists. Please check your student number.')

    const emailDup = students.find(s => s.account?.registered && s.account?.email?.toLowerCase() === regEmail.toLowerCase())
    if (emailDup)
      return setErr('⛔ This email is already linked to another account.')

    setLoading(true)
    try {
      const displayName = existing?.name || regName
      await _sendOTP('reg', regEmail, displayName)
      setRegPending({ snum: regSnum, name: regName, email: regEmail, pass: regPass })
      setOtpEmailDisplay(regEmail)
      setOtpValue('')
      setMode('reg-otp')
    } catch (e) {
      setErr('Failed to send OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Register Step 2 (OTP verify) ────────────────────────────────────────
  async function handleRegStep2(e) {
    e.preventDefault()
    clearMessages()
    if (otpValue.length < 6) return setErr('Please enter the full 6-digit OTP.')
    if (!regPending) return setErr('Session expired. Please start registration again.')

    const result = checkOTP('reg', otpValue)
    if (!result.ok) return setErr(result.msg)

    setLoading(true)
    try {
      const updatedStudents = [...students]
      const idx = updatedStudents.findIndex(s => s.id === regPending.snum)
      const hashedPass = await hashPassword(regPending.pass)

      if (idx >= 0) {
        updatedStudents[idx] = {
          ...updatedStudents[idx],
          account: { registered: true, pass: hashedPass, email: regPending.email },
          name: updatedStudents[idx].name || regPending.name,
        }
      } else {
        updatedStudents.push({
          id: regPending.snum,
          name: regPending.name,
          course: '', year: '', mobile: '', dob: '',
          classId: null, grades: {}, attendance: {}, excuse: {}, gradeComponents: {},
          account: { registered: true, pass: hashedPass, email: regPending.email },
        })
      }

      await saveStudents(updatedStudents, [regPending.snum])
      clearOTP('reg')
      setOkMsg('✅ Account created successfully! Redirecting to sign in…')
      setTimeout(() => { setMode('student'); setOkMsg(''); setRegPending(null) }, 1800)
    } catch (e) {
      setErr('Failed to save account: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Step 1 ───────────────────────────────────────────────────────
  async function handleFpStep1(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const s = students.find(x => x.id === fpSnum)
      if (!s?.account?.registered) return setErr('No account found for that student number.')
      if (s.account.email.toLowerCase() !== fpEmail.toLowerCase())
        return setErr('Email does not match the registered email for this account.')

      await _sendOTP('fp', fpEmail, s.name)
      setFpPending({ snum: fpSnum, email: fpEmail })
      setOtpEmailDisplay(fpEmail)
      setOtpValue('')
      setMode('fp-otp')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Step 2 (OTP verify + new password) ──────────────────────────
  async function handleFpStep2(e) {
    e.preventDefault()
    clearMessages()
    if (otpValue.length < 6) return setErr('Please enter the full 6-digit OTP.')
    if (!fpPending) return setErr('Session expired. Please request a new OTP.')
    if (fpNewPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(fpNewPass) || !/[0-9]/.test(fpNewPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (fpNewPass !== fpNewPass2) return setErr('Passwords do not match.')

    const result = checkOTP('fp', otpValue)
    if (!result.ok) return setErr(result.msg)

    const s = students.find(x => x.id === fpPending.snum)
    if (!s) return setErr('Student account not found.')

    setLoading(true)
    try {
      const hashed = await hashPassword(fpNewPass)
      const updatedStudents = students.map(x => x.id === s.id
        ? { ...x, account: { ...x.account, pass: hashed } }
        : x
      )
      await saveStudents(updatedStudents, [s.id])
      clearOTP('fp')
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

      {/* Login card */}
      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Logo / branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/logo.png" alt="AcadFlow" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="font-display text-3xl font-bold text-ink">AcadFlow</h1>
          <p className="text-xs text-ink3 mt-1">Academic Management System</p>
        </div>

        {/* Mode tabs */}
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
          {/* Error / OK messages */}
          {err && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
          {okMsg && <div className="ok-msg" style={{ display: 'block' }}>{okMsg}</div>}

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

          {/* ── Register ──────────────────────────────────────────────── */}
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
              <LoadingButton loading={loading} loadingText="Sending OTP…" className="btn btn-primary btn-full mt-2">
                Send OTP to My Email →
              </LoadingButton>
            </form>
          )}

          {/* ── Register OTP ──────────────────────────────────────────── */}
          {mode === 'reg-otp' && (
            <form onSubmit={handleRegStep2}>
              <p className="text-sm text-ink2 mb-2 text-center">
                Enter the 6-digit OTP sent to <strong>{otpEmailDisplay}</strong>
              </p>
              <OTPBoxes value={otpValue} onChange={setOtpValue} disabled={loading} />
              <LoadingButton loading={loading} loadingText="Verifying…" className="btn btn-primary btn-full mt-2">
                Verify & Create Account
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('register'); clearMessages() }}>
                ← Back
              </button>
            </form>
          )}

          {/* ── Forgot Password ───────────────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleFpStep1}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Forgot Password</h3>
              <p className="text-xs text-ink2 mb-4">Enter your student number and registered email.</p>
              <div className="field-float">
                <input type="text" placeholder=" " value={fpSnum} onChange={e => setFpSnum(sanitizeSnum(e.target.value))} />
                <label>Student Number</label>
              </div>
              <div className="field-float">
                <input type="email" placeholder=" " value={fpEmail} onChange={e => setFpEmail(e.target.value)} />
                <label>Registered Email</label>
              </div>
              <LoadingButton loading={loading} loadingText="Sending OTP…" className="btn btn-primary btn-full mt-2">
                Send OTP →
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('student'); clearMessages() }}>
                ← Back to Sign In
              </button>
            </form>
          )}

          {/* ── Forgot OTP ────────────────────────────────────────────── */}
          {mode === 'fp-otp' && (
            <form onSubmit={handleFpStep2}>
              <p className="text-sm text-ink2 mb-2 text-center">
                Enter the 6-digit OTP sent to <strong>{otpEmailDisplay}</strong>
              </p>
              <OTPBoxes value={otpValue} onChange={setOtpValue} disabled={loading} />
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
          )}
        </div>

        {/* Switch to admin login */}
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
