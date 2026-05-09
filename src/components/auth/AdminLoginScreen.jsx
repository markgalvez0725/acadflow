import React, { useState, lazy, Suspense } from 'react'
import { Eye, EyeOff, ShieldCheck, PenLine, Users, CalendarCheck, GraduationCap } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import OTPBoxes from '@/components/primitives/OTPBoxes'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'

const ResetPinModal = lazy(() => import('@/components/auth/ResetPinModal'))

const ADMIN_FEATURES = [
  { Icon: Users,         label: 'Students' },
  { Icon: GraduationCap, label: 'Grades' },
  { Icon: CalendarCheck, label: 'Attendance' },
  { Icon: PenLine,       label: 'Quizzes' },
]

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

  const [showPass, setShowPass]     = useState(false)
  const [showAfPass, setShowAfPass] = useState(false)
  const [showAfPass2, setShowAfPass2] = useState(false)

  const [afEmail, setAfEmail]   = useState('')
  const [otpValue, setOtpValue] = useState('')
  const [afNewPass, setAfNewPass]   = useState('')
  const [afNewPass2, setAfNewPass2] = useState('')
  const [otpEmailDisplay, setOtpEmailDisplay] = useState('')

  const clearMessages = () => { setErr(''); setOkMsg('') }

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

  const modeTitle = mode === 'login' ? 'Admin portal' : mode === 'forgot' ? 'Reset password' : 'OTP verification'
  const modeSub   = mode === 'login' ? 'Sign in to manage your classes.' : mode === 'forgot' ? 'Enter your email to receive an OTP.' : 'Enter the code sent to your email.'

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-bg" id="admin-login-screen">
      <WeatherScene isDark={theme === 'dark'} showBadge style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <ThemeToggle />

      {/* ── Left branding panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-between flex-1 relative z-10 p-10 pointer-events-none select-none">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="AcadFlow" className="w-9 h-9 object-contain drop-shadow" />
          <span className="font-display text-xl font-bold text-ink tracking-tight">AcadFlow</span>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl" style={{ background: 'var(--accent-l)', color: 'var(--accent)' }}>
              <ShieldCheck size={18} />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-ink3">Teacher Portal</span>
          </div>
          <p className="text-4xl font-display font-bold text-ink leading-tight mb-4" style={{ letterSpacing: '-.03em' }}>
            Manage your<br />
            <span style={{ background: 'var(--grad-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              classroom, smarter.
            </span>
          </p>
          <p className="text-sm text-ink2 max-w-xs leading-relaxed">
            Full control over grades, attendance, quizzes, announcements and student records — all from one dashboard.
          </p>
          <div className="flex gap-6 mt-8">
            {ADMIN_FEATURES.map(({ Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-l)', color: 'var(--accent)' }}>
                  <Icon size={18} />
                </div>
                <span className="text-xs font-semibold text-ink3">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink3">© {new Date().getFullYear()} AcadFlow. All rights reserved.</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="relative z-10 flex flex-col justify-center w-full lg:max-w-[460px] lg:min-h-screen px-4 py-8 lg:px-12 lg:bg-surface/80 lg:backdrop-blur-xl lg:border-l lg:border-border">

        {/* Mobile branding */}
        <div className="text-center mb-6 lg:hidden">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/logo.png" alt="AcadFlow" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="font-display text-3xl font-bold text-ink">AcadFlow</h1>
          <p className="text-xs text-ink3 mt-1">Teacher / Admin Portal</p>
        </div>

        {/* Desktop welcome text */}
        <div className="hidden lg:block mb-7">
          <h2 className="text-2xl font-bold text-ink mb-1" style={{ letterSpacing: '-.02em' }}>{modeTitle}</h2>
          <p className="text-sm text-ink3">{modeSub}</p>
        </div>

        <div className="card card-pad">
          {err   && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
          {okMsg && <div className="ok-msg"  style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Login ──────────────────────────────────────────────────── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="field-float">
                <input
                  type="text"
                  placeholder=" "
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                />
                <label>Username</label>
              </div>
              <div className="field-float">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder=" "
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1} aria-label={showPass ? 'Hide password' : 'Show password'}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
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

          {/* ── Forgot ─────────────────────────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotStep1}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Reset Admin Password</h3>
              <p className="text-xs text-ink2 mb-4">Enter the admin email address to receive an OTP.</p>
              <div className="field-float">
                <input type="email" placeholder=" " value={afEmail} onChange={e => setAfEmail(e.target.value)} />
                <label>Admin Email</label>
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
              <div className="field-float" style={{ marginTop: 10 }}>
                <input
                  type={showAfPass ? 'text' : 'password'}
                  placeholder=" "
                  value={afNewPass}
                  onChange={e => setAfNewPass(e.target.value)}
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowAfPass(v => !v)} tabIndex={-1} aria-label={showAfPass ? 'Hide password' : 'Show password'}>
                  {showAfPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <label>New Password</label>
              </div>
              <div className="field-float">
                <input
                  type={showAfPass2 ? 'text' : 'password'}
                  placeholder=" "
                  value={afNewPass2}
                  onChange={e => setAfNewPass2(e.target.value)}
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowAfPass2(v => !v)} tabIndex={-1} aria-label={showAfPass2 ? 'Hide password' : 'Show password'}>
                  {showAfPass2 ? <EyeOff size={16} /> : <Eye size={16} />}
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
