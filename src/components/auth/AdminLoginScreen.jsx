import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Eye, EyeOff, ShieldCheck, BookOpen, Users, CalendarCheck, BarChart2, Mail, Lock, HelpCircle } from 'lucide-react'
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
const FaqModal = lazy(() => import('@/components/auth/FaqModal'))

export default function AdminLoginScreen() {
  const { loginAdmin } = useAuth()
  const { admin } = useData()
  const { toast, theme } = useUI()

  const [pinResetOpen, setPinResetOpen] = useState(false)
  const [faqOpen, setFaqOpen]   = useState(false)
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
    <div className="auth2" id="admin-login-screen">
      <button
        type="button"
        className="theme-btn help-btn"
        onClick={() => setFaqOpen(true)}
        title="About AcadFlow / FAQ"
        aria-label="About AcadFlow / FAQ"
      >
        <HelpCircle size={16} />
      </button>
      <ThemeToggle />

      {/* Full-page decorative backdrop (orbs + dot grid) */}
      <div className="auth2-bg" aria-hidden="true">
        <div className="auth2-orb auth2-orb-1" />
        <div className="auth2-orb auth2-orb-2" />
        <div className="auth2-grid" />
      </div>

      <div className="auth2-inner">
        {/* ── Brand column (desktop only) ── */}
        <div className="auth2-brand">
          <AcadFlowLogo size="lg" />
          <div className="auth2-eyebrow"><ShieldCheck size={13} /> Faculty portal</div>
          <h1 className="auth2-headline">
            {typedLine1}
            {!typed[1] && (
              <span className="typing-cursor" aria-hidden="true" />
            )}
            {typed[1] !== undefined && (
              <>
                <br />
                <span className="grad">{typedLine2}</span>
                {!typingDone && (
                  <span className="typing-cursor" aria-hidden="true" style={{ WebkitTextFillColor: 'var(--ink)', background: 'none' }} />
                )}
              </>
            )}
          </h1>
          <p className="auth2-tagline">
            Full control over grades, attendance, quizzes, announcements and student records - all from one dashboard.
          </p>
          <div className="auth2-feats">
            {ADMIN_FEATURES.map(({ Icon, label }) => (
              <div className="auth2-feat" key={label}>
                <span className="auth2-feat-ic"><Icon size={18} /></span>
                <span className="auth2-feat-t">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form column ── */}
        <div className="auth2-main">
          {/* Brand (mobile / tablet only) */}
          <div className="auth2-brandtop">
            <AcadFlowLogo variant="stacked" size="lg" className="justify-center" />
            <p className="auth2-tagline">Run your classroom from one live dashboard.</p>
          </div>

          <div className="auth2-card">
            <div className="auth2-title">{modeTitle}</div>
            <p className="auth2-sub-text">{modeSub}</p>

            {err   && <div className="err-msg" style={{ display: 'block' }}>{err}</div>}
            {okMsg && <div className="ok-msg"  style={{ display: 'block' }}>{okMsg}</div>}

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

            <div className="auth2-trust"><ShieldCheck size={13} /> Encrypted &amp; secure · faculty access only</div>
          </div>{/* /auth2-card */}

          <div className="auth2-foot">
            <button type="button" className="link-btn" onClick={() => setFaqOpen(true)}>Why AcadFlow?</button>
            {' · '}© {new Date().getFullYear()} AcadFlow
          </div>
        </div>{/* /auth2-main */}
      </div>{/* /auth2-inner */}

      {pinResetOpen && (
        <Suspense fallback={null}>
          <ResetPinModal onClose={() => setPinResetOpen(false)} onReset={() => setPinResetOpen(false)} />
        </Suspense>
      )}

      {faqOpen && (
        <Suspense fallback={null}>
          <FaqModal onClose={() => setFaqOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
