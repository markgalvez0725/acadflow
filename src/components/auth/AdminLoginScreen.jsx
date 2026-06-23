import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Eye, EyeOff, ShieldCheck, BookOpen, Users, CalendarCheck, BarChart2, TrendingUp, Mail, Lock } from 'lucide-react'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'
import { useTypingEffect } from '@/hooks/useTypingEffect'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { ADMIN_EMAIL } from '@/constants/auth'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'

const ADMIN_FEATURES = [
  { Icon: Users,         label: 'Students' },
  { Icon: BarChart2,     label: 'Grades' },
  { Icon: CalendarCheck, label: 'Attendance' },
  { Icon: BookOpen,      label: 'Quizzes' },
]

const ADMIN_PHRASES = [
  ['Manage your',  '\nclassroom, smarter.'],
  ['Full control', '\nat your fingertips.'],
  ['Empower your', '\nstudents, today.'],
]

const ResetPinModal = lazy(() => import('@/components/auth/ResetPinModal'))

export default function AdminLoginScreen() {
  const { loginAdmin } = useAuth()
  const { admin } = useData()
  const { toast, theme } = useUI()

  const [pinResetOpen, setPinResetOpen] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')


  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  const clearMessages = () => { setErr(''); setOkMsg('') }

  // ── Admin login ─────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const result = await loginAdmin(ADMIN_EMAIL, password)
      if (!result.ok) {
        setErr(result.msg)
        setPassword('')
      }
    } finally {
      setLoading(false)
    }
  }

  const { displayed: typed, done: typingDone } = useTypingEffect(
    ADMIN_PHRASES,
    { speed: 45, deleteSpeed: 35, startDelay: 350, holdDelay: 5_000 }
  )
  const typedLine1 = typed[0] ?? ''
  const typedLine2 = (typed[1] ?? '').replace(/^\n/, '')

  const modeTitle = 'Admin portal'
  const modeSub   = 'Sign in to manage your classes.'

  const panelInkReset = theme === 'dark'
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : { '--ink': '#0d1526', '--ink2': '#52637a', '--ink3': '#8b9ab0' }

  return (
    <div className="min-h-screen flex relative overflow-hidden" id="admin-login-screen">
      <ThemeToggle />

      {/* ── Left branding panel (desktop only) ── */}
      <div className="auth-brand hidden lg:flex flex-col justify-between flex-1 relative z-10 p-10 pointer-events-none select-none">
        {/* Depth layers */}
        <div className="auth-orb auth-orb-1" aria-hidden="true" />
        <div className="auth-orb auth-orb-2" aria-hidden="true" />
        <div className="auth-grid" aria-hidden="true" />

        <AcadFlowLogo size="sm" />
        <div>
          <div className="auth-eyebrow">
            <ShieldCheck size={13} /> Teacher portal
          </div>
          <p className="text-4xl font-display font-bold text-ink leading-tight mb-4" style={{ letterSpacing: '-.03em' }}>
            {typedLine1}
            {!typed[1] && (
              <span className="typing-cursor" aria-hidden="true" />
            )}
            {typed[1] !== undefined && (
              <>
                <br />
                <span style={{ background: 'var(--grad-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {typedLine2}
                </span>
                {!typingDone && (
                  <span className="typing-cursor" aria-hidden="true" style={{ WebkitTextFillColor: 'var(--ink)', background: 'none' }} />
                )}
              </>
            )}
          </p>
          <p className="text-sm text-ink2 max-w-xs leading-relaxed">
            Full control over grades, attendance, quizzes, announcements and student records — all from one dashboard.
          </p>

          <div className="auth-highlight">
            <div className="auth-highlight-ic"><TrendingUp size={18} /></div>
            <div>
              <div className="auth-highlight-t">Your classroom, in command</div>
              <div className="auth-highlight-s">Grades, attendance &amp; quizzes, live</div>
            </div>
          </div>

          <div className="auth-chips">
            {ADMIN_FEATURES.map(({ Icon, label }) => (
              <span key={label} className="auth-chip"><Icon size={13} /> {label}</span>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink3">© {new Date().getFullYear()} AcadFlow. All rights reserved.</p>
      </div>

      {/* ── Right glass panel ── */}
      <div className="login-panel relative z-10 flex flex-col justify-center w-full lg:max-w-[460px] lg:min-h-screen px-4 py-8 lg:px-12">
        {/* Mobile branding */}
        <div className="auth-brand-mobile text-center mb-6 lg:hidden">
          <AcadFlowLogo variant="stacked" size="lg" className="justify-center mb-1" />
          <p className="text-xs text-ink3 mt-2">Teacher / Admin Portal</p>
        </div>

        {/* Desktop welcome text */}
        <div className="hidden lg:block mb-7">
          <div className="auth-form-badge"><ShieldCheck size={22} /></div>
          <h2 className="text-2xl font-bold text-ink mb-1" style={{ letterSpacing: '-.02em' }}>{modeTitle}</h2>
          <p className="text-sm text-ink3">{modeSub}</p>
        </div>

        {err   && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
        {okMsg && <div className="ok-msg"  style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Login ──────────────────────────────────────────────────── */}
            <form onSubmit={handleLogin}>
              <div className="field-float field-float--icon">
                <span className="ff-icon" aria-hidden="true"><Mail size={16} /></span>
                <input
                  type="email"
                  value={ADMIN_EMAIL}
                  readOnly
                  autoComplete="username"
                  style={{ background: 'var(--surface2)', color: 'var(--ink2)' }}
                />
                <label>Admin email</label>
              </div>
              <div className="field-float field-float--icon">
                <span className="ff-icon" aria-hidden="true"><Lock size={16} /></span>
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
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { clearMessages(); setPinResetOpen(true) }}>
                Forgot Password?
              </button>
            </form>

        <div className="auth-trust"><ShieldCheck size={13} /> Encrypted &amp; secure</div>
        <p className="text-center text-xs text-ink3 mt-3">
          Student?{' '}
          <a href="/" className="text-accent-m underline">Student Login →</a>
        </p>
      </div>

      {pinResetOpen && (
        <Suspense fallback={null}>
          <ResetPinModal onClose={() => setPinResetOpen(false)} onReset={() => setPinResetOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
