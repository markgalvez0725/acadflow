import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Eye, EyeOff, ShieldCheck, BookOpen, Users, CalendarCheck, BarChart2, GraduationCap } from 'lucide-react'
import { useTypingEffect } from '@/hooks/useTypingEffect'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'
import { getScene } from '@/components/canvas/scenes'

const ResetPinModal = lazy(() => import('@/components/auth/ResetPinModal'))

const ADMIN_FEATURES = [
  { Icon: Users,         label: 'Students' },
  { Icon: BarChart2,     label: 'Grades' },
  { Icon: CalendarCheck, label: 'Attendance' },
  { Icon: BookOpen,      label: 'Quizzes' },
]

export default function AdminLoginScreen() {
  const { loginAdmin } = useAuth()
  const { admin } = useData()
  const { toast, theme } = useUI()

  const [pinResetOpen, setPinResetOpen] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')

  // Track scene for background-aware text contrast
  const [scene, setScene] = useState(() => getScene())
  useEffect(() => {
    const id = setInterval(() => setScene(getScene()), 60_000)
    return () => clearInterval(id)
  }, [])

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
      const result = await loginAdmin(username.trim(), password, admin)
      if (!result.ok) {
        setErr(result.msg)
        setPassword('')
      }
    } finally {
      setLoading(false)
    }
  }

  const { displayed: typed, done: typingDone } = useTypingEffect(
    ['Manage your', '\nclassroom, smarter.'],
    { speed: 45, deleteSpeed: 35, startDelay: 350, holdDelay: 30_000 }
  )
  const typedLine1 = typed[0] ?? ''
  const typedLine2 = (typed[1] ?? '').replace(/^\n/, '')

  const modeTitle = 'Admin portal'
  const modeSub   = 'Sign in to manage your classes.'

  const sceneForcesLight = !scene?.isLightScene && theme !== 'dark'
  const sceneTextOverride = sceneForcesLight
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : undefined

  // The right panel has its own opaque surface background, so always restore
  // ink tokens to the theme-native values regardless of the scene.
  const panelInkReset = theme === 'dark'
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : { '--ink': '#0d1526', '--ink2': '#52637a', '--ink3': '#8b9ab0' }

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-bg" id="admin-login-screen" style={sceneTextOverride}>
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
      <div className="relative z-10 flex flex-col justify-center w-full lg:max-w-[460px] lg:min-h-screen px-4 py-8 lg:px-12 lg:bg-surface/80 lg:backdrop-blur-xl lg:border-l lg:border-border" style={panelInkReset}>

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
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { clearMessages(); setPinResetOpen(true) }}>
                Forgot Password?
              </button>
            </form>


        </div>

        <p className="text-center text-xs text-ink3 mt-4">
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
