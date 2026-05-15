import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'
import WeatherScene from '@/components/canvas/WeatherScene'
import { getScene } from '@/components/canvas/scenes'

const ResetPinModal = lazy(() => import('@/components/auth/ResetPinModal'))

export default function AdminLoginScreen() {
  const { loginAdmin } = useAuth()
  const { admin } = useData()
  const { toast, theme } = useUI()

  const [pinResetOpen, setPinResetOpen] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')

  // Track scene for background-aware text contrast
  const [scene, setScene]         = useState(() => getScene())
  const [sceneId, setSceneId]     = useState(() => getScene()?.id || 'midday')
  const [weatherCond, setWeatherCond] = useState('clear')
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

  const modeTitle = 'Admin portal'
  const modeSub   = 'Sign in to manage your classes.'

  const sceneForcesLight = !scene?.isLightScene && theme !== 'dark'
  const sceneTextOverride = sceneForcesLight
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : undefined

  const panelInkReset = theme === 'dark'
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : { '--ink': '#0d1526', '--ink2': '#52637a', '--ink3': '#8b9ab0' }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-bg" id="admin-login-screen" data-scene={sceneId} data-weather={weatherCond} style={sceneTextOverride}>
      <WeatherScene isDark={theme === 'dark'} showBadge onSceneChange={({ scene: s, weather: w }) => { setSceneId(s); setWeatherCond(w) }} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      {/* Atmospheric ambient overlay — responds to data-scene via CSS @property */}
      <div className="login-scene-overlay" aria-hidden="true" />
      {/* CSS aurora effect for night scenes */}
      <div className="login-aurora" aria-hidden="true" />
      {/* CSS star particles for night scenes */}
      <div className="login-stars-css" aria-hidden="true" />
      <ThemeToggle />

      {/* ── MacBook glass card — centered ── */}
      <div className="glass-login-card relative z-10 w-full max-w-[420px] mx-4 px-8 py-9 rounded-[28px]" style={panelInkReset}>

        {/* Logo */}
        <div className="flex flex-col items-center mb-5">
          <AcadFlowLogo variant="stacked" size="lg" className="justify-center" />
        </div>

        {/* Title */}
        <div className="text-center mb-5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: 'var(--accent-l)', color: 'var(--accent)' }}>
              <ShieldCheck size={14} />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-ink3">Teacher Portal</span>
          </div>
          <h2 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-.02em' }}>{modeTitle}</h2>
          <p className="text-sm text-ink3">{modeSub}</p>
        </div>

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
