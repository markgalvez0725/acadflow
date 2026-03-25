import React, { useState, lazy, Suspense } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import OTPBoxes from '@/components/primitives/OTPBoxes'
import PinBoxes from '@/components/primitives/PinBoxes'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'

const ResetPinModal = lazy(() => import('@/components/auth/ResetPinModal'))

// Modes: 'login' | 'forgot' | 'af-otp'
export default function AdminLoginScreen() {
  const { loginAdmin, createOTP, checkOTP, clearOTP, hashPassword } = useAuth()
  const { admin, saveAdmin } = useData()
  const { toast, theme } = useUI()

  const [mode, setMode]           = useState('login')
  const [pinResetOpen, setPinResetOpen] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [afEmail, setAfEmail]   = useState('')
  const [otpValue, setOtpValue] = useState('')
  const [afNewPass, setAfNewPass]   = useState('')
  const [afNewPass2, setAfNewPass2] = useState('')
  const [otpEmailDisplay, setOtpEmailDisplay] = useState('')

  const clearMessages = () => { setErr(''); setOkMsg('') }

  async function _sendOTP(ctx, email, name) {
    const { ejs } = useData() // eslint-disable-line — workaround for hook inside fn
    // Note: ejs is accessed at call time, not at hook time
    const code = createOTP(ctx, email)
    return code
  }

  // ── Admin login ─────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const result = await loginAdmin(username.trim(), password, admin)
      if (!result.ok) {
        setErr(result.msg)
        setPassword('')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot step 1 ───────────────────────────────────────────────────────
  async function handleForgotStep1(e) {
    e.preventDefault()
    clearMessages()
    if (afEmail.toLowerCase() !== admin.email.toLowerCase())
      return setErr('Email not recognized.')

    setLoading(true)
    try {
      const code = createOTP('af', afEmail)
      setOtpEmailDisplay(afEmail)
      setOtpValue('')
      setMode('af-otp')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot step 2 ───────────────────────────────────────────────────────
  async function handleForgotStep2(e) {
    e.preventDefault()
    clearMessages()
    if (otpValue.length < 6) return setErr('Please enter the full 6-digit OTP.')
    if (afNewPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(afNewPass) || !/[0-9]/.test(afNewPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (afNewPass !== afNewPass2) return setErr('Passwords do not match.')

    const result = checkOTP('af', otpValue)
    if (!result.ok) return setErr(result.msg)

    setLoading(true)
    try {
      const newPass = await hashPassword(afNewPass)
      await saveAdmin({ ...admin, pass: newPass })
      clearOTP('af')
      setOkMsg('✅ Admin password updated!')
      setTimeout(() => { setMode('login'); setOkMsg('') }, 1800)
    } catch (e2) {
      setErr('Failed to save: ' + e2.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-bg" id="admin-login-screen">
      <WeatherScene isDark={theme === 'dark'} showBadge style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <ThemeToggle />

      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-royal mb-3">
            <span className="text-gold text-2xl">📋</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-ink">AcadFlow</h1>
          <p className="text-xs text-ink3 mt-1">Teacher / Admin Portal</p>
        </div>

        <div className="card card-pad">
          {err  && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
          {okMsg && <div className="ok-msg" style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Login ──────────────────────────────────────────────────── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label>Username</label>
                <input
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <LoadingButton loading={loading} loadingText="Signing in…" className="btn btn-primary btn-full mt-2">
                Sign In
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { setMode('forgot'); clearMessages() }}>
                Forgot Password?
              </button>
            </form>
          )}

          {/* ── Forgot ─────────────────────────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotStep1}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Reset Admin Password</h3>
              <p className="text-xs text-ink2 mb-4">Enter the admin email address to receive an OTP.</p>
              <div className="field">
                <label>Admin Email</label>
                <input type="email" value={afEmail} onChange={e => setAfEmail(e.target.value)} placeholder="admin@school.edu" />
              </div>
              <LoadingButton loading={loading} loadingText="Sending…" className="btn btn-primary btn-full mt-2">
                Send OTP →
              </LoadingButton>
              <button type="button" className="link-btn w-full text-center mt-2" onClick={() => { setMode('login'); clearMessages() }}>
                ← Back to Login
              </button>
              <button type="button" className="link-btn w-full text-center mt-1" onClick={() => { clearMessages(); setPinResetOpen(true) }}>
                Use Recovery PIN instead
              </button>
            </form>
          )}

          {/* ── OTP + new password ─────────────────────────────────────── */}
          {mode === 'af-otp' && (
            <form onSubmit={handleForgotStep2}>
              <p className="text-sm text-ink2 mb-2 text-center">
                Enter the 6-digit OTP sent to <strong>{otpEmailDisplay}</strong>
              </p>
              <OTPBoxes value={otpValue} onChange={setOtpValue} disabled={loading} />
              <div className="field">
                <label>New Password</label>
                <input type="password" placeholder="Min 8 chars, 1 uppercase, 1 number" value={afNewPass} onChange={e => setAfNewPass(e.target.value)} />
              </div>
              <div className="field">
                <label>Confirm New Password</label>
                <input type="password" value={afNewPass2} onChange={e => setAfNewPass2(e.target.value)} />
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

        <p className="text-center text-xs text-ink3 mt-4">
          Student?{' '}
          <a href="/" className="text-accent-m underline">Student Login →</a>
        </p>
      </div>

      {pinResetOpen && (
        <Suspense fallback={null}>
          <ResetPinModal onClose={() => setPinResetOpen(false)} onReset={() => setMode('login')} />
        </Suspense>
      )}
    </div>
  )
}
