import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Eye, EyeOff, BarChart2, CalendarCheck, Rss, MessageSquare, KeyRound, Check, ShieldCheck, GraduationCap, IdCard, Lock, HelpCircle, Fingerprint, ScanFace } from 'lucide-react'
import FaceResetModal from '@/components/student/modals/FaceResetModal'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'
import { useTypingEffect } from '@/hooks/useTypingEffect'
import { useAuth } from '@/context/AuthContext'
import { isBiometricSupported, getBiometric, biometricUnlock } from '@/utils/biometric'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { signInWithCustomToken, updatePassword } from 'firebase/auth'
import { getFbAuth } from '@/firebase/firebaseInit'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import Button from '@/components/ds/Button'
import ThemeToggle from '@/components/primitives/ThemeToggle'

const FaqModal = lazy(() => import('@/components/auth/FaqModal'))

const STUDENT_FEATURES = [
  { Icon: BarChart2,     label: 'Grades' },
  { Icon: CalendarCheck, label: 'Attendance' },
  { Icon: Rss,           label: 'Stream' },
  { Icon: MessageSquare, label: 'Messages' },
]

const STUDENT_PHRASES = [
  ['Your academic',    '\nuniverse, unified.'],
  ['Track your grades', '\nwith ease.'],
  ['Stay connected',   '\nwith your class.'],
]

// Modes: 'student' | 'forgot'
// Students no longer self-register; the professor provisions each account (default
// password) and the student signs in, then completes guided verification.
export default function LoginScreen({ onRevealFaculty }) {
  const { loginStudent } = useAuth()
  const { students, saveStudents, fbReady } = useData()
  const { theme, toast } = useUI()

  // Hidden faculty entrance: tap the logo 5× within 2s to reveal the faculty
  // sign-in. Lets professors reach it inside the installed PWA, where there's no
  // address bar to type the /faculty path - without showing a link to students.
  const logoTaps = useRef({ count: 0, first: 0 })
  function handleLogoTap() {
    const now = Date.now()
    const t = logoTaps.current
    if (now - t.first > 2000) { t.count = 0; t.first = now }
    t.count += 1
    if (t.count >= 5) {
      t.count = 0
      try { window.history.pushState({}, '', '/faculty') } catch (_) {}
      onRevealFaculty?.()
    }
  }

  const [mode, setMode]       = useState('student')
  const [faqOpen, setFaqOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')
  const [okMsg, setOkMsg]     = useState('')


  // Login form
  const [snum, setSnum] = useState('')
  const [pass, setPass] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(true)

  // Forgot-password (live, professor-coordinated) reset
  const [rpNum,      setRpNum]      = useState('')
  const [rpStatus,   setRpStatus]   = useState('idle') // 'idle' | 'waiting' | 'setpass' | 'saving'
  const [rpNewPass,  setRpNewPass]  = useState('')
  const [rpNewPass2, setRpNewPass2] = useState('')
  const [faceResetOpen, setFaceResetOpen] = useState(false)
  const rpTimer = useRef(null)
  const rpDeadline = useRef(0)

  // Show/hide password toggles
  const [showPass,     setShowPass]     = useState(false)

  const clearMessages = () => { setErr(''); setOkMsg('') }

  // ── Student login ────────────────────────────────────────────────────────
  async function handleStudentLogin(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const result = await loginStudent(snum.trim(), pass, keepSignedIn)
      if (!result.ok) {
        setErr(result.msg)
        setPass('')
      }
    } finally {
      setLoading(false)
    }
  }

  // Biometric quick sign-in - offered only when this device has a credential set
  // up (see BiometricSetupModal). Unlock reveals the stored password and runs
  // the normal login. Password sign-in always remains available below.
  const [bioOffered, setBioOffered] = useState(false)
  useEffect(() => { setBioOffered(isBiometricSupported() && !!getBiometric()) }, [])

  async function handleBiometricLogin() {
    clearMessages()
    setLoading(true)
    try {
      const { snum: bsnum, password } = await biometricUnlock()
      setSnum(bsnum)
      const result = await loginStudent((bsnum || '').trim(), password, keepSignedIn)
      if (!result.ok) setErr(result.msg)
    } catch (e) {
      setErr(e?.message || 'Biometric sign-in failed. Please use your password.')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot password - live reset coordinated with the professor ─────────────
  // The student enters their number and taps Start. We poll the server; while
  // the professor's reset window is open, the server hands back a fresh temporary
  // password, which we use to sign the student in automatically.
  function stopReset() {
    if (rpTimer.current) { clearInterval(rpTimer.current); rpTimer.current = null }
  }

  // Clean up polling if the component unmounts or the user leaves forgot mode.
  useEffect(() => () => stopReset(), [])
  useEffect(() => { if (mode !== 'forgot') { stopReset(); setRpStatus('idle'); setRpNewPass(''); setRpNewPass2(''); setFaceResetOpen(false) } }, [mode])

  async function pollClaim(number) {
    if (Date.now() > rpDeadline.current) {
      stopReset()
      setRpStatus('idle')
      return setErr('The reset window timed out. Ask your professor to open it again, then tap Start.')
    }
    try {
      const r = await fetch('/api/claim-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentNumber: number }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { /* transient - keep waiting unless it's a hard error */
        if (r.status === 404 || r.status === 501) { stopReset(); setRpStatus('idle'); setErr(data.error || 'Reset is unavailable right now.') }
        return
      }
      if (data.customToken) {
        stopReset()
        // Sign in with a one-time custom token - this does NOT change the
        // student's password (their current one stays valid). They then set a
        // new password before reaching the portal; updatePassword works because
        // they just authenticated. If they abandon here, nothing was destroyed.
        try {
          await signInWithCustomToken(getFbAuth(), data.customToken)
        } catch {
          setRpStatus('idle')
          setErr('Could not sign in with the reset token. Ask your professor to open the window again.')
          return
        }
        setRpNewPass('')
        setRpNewPass2('')
        setRpStatus('setpass')
      }
      // else: { pending: true } → keep polling
    } catch {
      // network blip - keep polling until the deadline
    }
  }

  function handleForgotStart(e) {
    e.preventDefault()
    clearMessages()
    const clean = sanitizeSnum(rpNum)
    const snErr = validateSnum(clean)
    if (snErr) return setErr(snErr)

    setRpStatus('waiting')
    rpDeadline.current = Date.now() + 10 * 60_000 // match the server window
    stopReset()
    pollClaim(clean)                         // immediate first check
    rpTimer.current = setInterval(() => pollClaim(clean), 3000)
  }

  // Student sets a brand-new password right after the temp sign-in.
  async function handleResetSetPassword(e) {
    e.preventDefault()
    setErr('')
    if (rpNewPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(rpNewPass) || !/[0-9]/.test(rpNewPass)) return setErr('Password must include at least one uppercase letter and one number.')
    if (rpNewPass !== rpNewPass2) return setErr('Passwords do not match.')

    const user = getFbAuth()?.currentUser
    if (!user) { setRpStatus('idle'); return setErr('Your session expired. Please start the reset again.') }

    setRpStatus('saving')
    try {
      await updatePassword(user, rpNewPass)
    } catch (e) {
      setRpStatus('setpass')
      return setErr('Could not set your new password: ' + (e?.message || 'unknown error'))
    }

    // Start the AcadFlow session with the new password → routes to the portal.
    // Derive the student number from the signed-in account so this works for both
    // the panel (professor) flow and the Face ID flow (where the number was entered
    // in the modal, not the panel field).
    const email = String(user.email || '')
    const clean = email.toLowerCase().endsWith('@acadflow.app')
      ? sanitizeSnum(email.slice(0, -'@acadflow.app'.length))
      : sanitizeSnum(rpNum)
    const result = await loginStudent(clean, rpNewPass)
    if (!result.ok) {
      setRpStatus('setpass')
      return setErr(result.msg || 'Password saved, but sign-in failed. Try signing in normally.')
    }
    toast('Password updated. Welcome back!', 'success')
    // Session starts - this screen unmounts as the student portal loads.
  }

  function handleForgotCancel() {
    stopReset()
    setRpStatus('idle')
    setRpNewPass('')
    setRpNewPass2('')
    setMode('student')
    clearMessages()
  }

  // ── Forgot password - self-service Face ID reset (no professor needed) ───────
  // The modal owns the student-number step, so just open it (optionally
  // prefilled with whatever's already typed in the panel).
  function openFaceReset() {
    clearMessages()
    stopReset()
    setFaceResetOpen(true)
  }

  // The Face ID modal already verified the face AND set the student's chosen new
  // password (their old password was only ever replaced by this one). Just sign
  // in with it to start the session.
  async function handleFaceReset(studentNumber, newPassword) {
    setFaceResetOpen(false)
    clearMessages()
    const clean = sanitizeSnum(studentNumber)
    const result = await loginStudent(clean, newPassword)
    if (!result.ok) {
      setMode('student')
      return setErr(result.msg || 'Your password was updated - please sign in with it.')
    }
    toast('Password updated. Welcome back!', 'success')
  }

  const { displayed: typed, done: typingDone } = useTypingEffect(
    STUDENT_PHRASES,
    { speed: 45, deleteSpeed: 35, startDelay: 350, holdDelay: 5_000 }
  )
  const typedLine1 = typed[0] ?? ''
  const typedLine2 = (typed[1] ?? '').replace(/^\n/, '')

  // The right panel has its own glass surface, so always restore ink tokens
  // to theme-native values regardless of the scene.
  const panelInkReset = theme === 'dark'
    ? { '--ink': '#e8edf8', '--ink2': '#8d9ab8', '--ink3': '#5a6880' }
    : { '--ink': '#0d1526', '--ink2': '#52637a', '--ink3': '#8b9ab0' }

  return (
    <div className="auth2" id="login-screen">
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
          <span onClick={handleLogoTap}><AcadFlowLogo size="lg" /></span>
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
            Grades, attendance, announcements, and messages - one calm place for your whole semester.
          </p>
          <div className="auth2-feats">
            {STUDENT_FEATURES.map(({ Icon, label }) => (
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
            <span onClick={handleLogoTap}><AcadFlowLogo variant="horizontal" size="lg" className="justify-center" /></span>
            <p className="auth2-tagline">Grades, attendance, and messages - live, in one calm place.</p>
          </div>

          <div className="auth2-card">
            <div className="auth2-eyebrow auth2-eyebrow--card"><GraduationCap size={13} /> Student portal</div>
            {mode === 'student' && (
              <>
                <div className="auth2-title">Welcome back</div>
                <p className="auth2-sub-text">Sign in to your student portal.</p>
              </>
            )}

            {err   && <div className="err-msg" role="alert" style={{ display: 'block' }}>{err}</div>}
            {okMsg && <div className="ok-msg"  role="status" aria-live="polite" style={{ display: 'block' }}>{okMsg}</div>}

          {/* ── Student Login ─────────────────────────────────────────── */}
          {mode === 'student' && (
            <form onSubmit={handleStudentLogin}>
              <div className="field-float field-float--icon">
                <span className="ff-icon" aria-hidden="true"><IdCard size={16} /></span>
                <input
                  id="login-snum"
                  name="studentNumber"
                  type="text"
                  placeholder=" "
                  value={snum}
                  onChange={e => setSnum(sanitizeSnum(e.target.value))}
                  autoComplete="username"
                />
                <label htmlFor="login-snum">Student Number</label>
              </div>
              <div className="field-float field-float--icon">
                <span className="ff-icon" aria-hidden="true"><Lock size={16} /></span>
                <input
                  id="login-pass"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  placeholder=" "
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1} aria-label={showPass ? 'Hide password' : 'Show password'}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <label htmlFor="login-pass">Password</label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 2px 0', cursor: 'pointer', fontSize: 13, color: 'var(--ink2)', userSelect: 'none' }}>
                <input type="checkbox" checked={keepSignedIn} onChange={e => setKeepSignedIn(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                Keep me signed in on this device
              </label>
              <Button type="submit" full loading={loading} loadingText="Signing in…" className="mt-2">
                Sign In
              </Button>
              <button type="button" className="link-btn w-full text-center mt-3" onClick={() => { setMode('forgot'); clearMessages() }}>
                Forgot Password?
              </button>
              {bioOffered && (
                <>
                  <div className="auth2-or">or</div>
                  <button type="button" className="btn btn-ghost btn-full" onClick={handleBiometricLogin} disabled={loading}>
                    <Fingerprint size={16} className="inline-block mr-1 align-text-bottom" />Use Face ID / fingerprint
                  </button>
                </>
              )}
            </form>
          )}

          {/* ── Forgot Password - professor-managed reset ──────────────── */}
          {mode === 'forgot' && rpStatus !== 'setpass' && rpStatus !== 'saving' && (
            <form onSubmit={handleForgotStart}>
              <h3 className="font-display text-lg font-bold text-ink mb-1">Forgot Password</h3>
              <p className="text-sm text-ink2 mb-4" style={{ lineHeight: 1.6 }}>
                First, message your professor and ask them to open a reset for you. Enter your
                student number below, then tap <strong>Start</strong> - the moment your professor
                opens the window, you'll be signed in automatically.
              </p>

              <div className="field-float">
                <input
                  id="reset-snum"
                  name="studentNumber"
                  type="text"
                  placeholder=" "
                  value={rpNum}
                  onChange={e => setRpNum(e.target.value)}
                  disabled={rpStatus !== 'idle'}
                  autoComplete="off"
                />
                <label htmlFor="reset-snum">Student Number</label>
              </div>

              {rpStatus === 'idle' && (
                <>
                  <button type="submit" className="btn btn-primary btn-full mt-2">
                    Start
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 12px' }}>
                    <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span className="text-xs text-ink3">or</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <button type="button" className="btn btn-secondary btn-full" onClick={openFaceReset}>
                    <ScanFace size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Reset with Face ID
                  </button>
                  <p className="text-xs text-ink3 text-center mt-2" style={{ lineHeight: 1.5 }}>
                    Only if you set up Face ID reset beforehand. No professor needed.
                  </p>

                  <button type="button" className="link-btn w-full text-center mt-3" onClick={handleForgotCancel}>
                    ← Back to Sign In
                  </button>
                </>
              )}

              {rpStatus === 'waiting' && (
                <>
                  <div className="mt-3 p-3 rounded-xl bg-bg2 text-sm text-ink2 flex items-center gap-3" style={{ lineHeight: 1.5 }}>
                    <span className="typing-cursor" aria-hidden="true" />
                    Waiting for your professor to open the reset… Keep this window open.
                  </div>
                  <button type="button" className="link-btn w-full text-center mt-3" onClick={handleForgotCancel}>
                    Cancel
                  </button>
                </>
              )}
            </form>
          )}

          {faceResetOpen && (
            <FaceResetModal
              initialNumber={rpNum}
              onClose={() => setFaceResetOpen(false)}
              onSuccess={handleFaceReset}
            />
          )}

          {/* ── Forgot Password - blocking "set a new password" modal ─────────
               Persistent overlay: the student must set a new password before
               reaching the portal. No close or cancel - it cannot be skipped. */}
          {mode === 'forgot' && (rpStatus === 'setpass' || rpStatus === 'saving') && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div role="dialog" aria-modal="true" aria-label="Set a new password" style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ marginBottom: 8, color: 'var(--accent)' }}><KeyRound size={40} style={{ display: 'inline-block' }} /></div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 6 }}>Set your new password</h3>
                  <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
                    You're verified. Choose a new password to finish - this step can't be skipped.
                  </p>
                </div>

                {err && <div role="alert" className="err-msg" style={{ display: 'block', marginBottom: 10 }}>{err}</div>}

                <form onSubmit={handleResetSetPassword}>
                  <div className="field-float">
                    <input
                      id="reset-newpass"
                      name="newPassword"
                      type="password"
                      placeholder=" "
                      value={rpNewPass}
                      onChange={e => setRpNewPass(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                    />
                    <label htmlFor="reset-newpass">New Password</label>
                  </div>
                  <p className="text-xs text-ink3 -mt-1 mb-2">Min. 8 characters, 1 uppercase, 1 number.</p>
                  <div className="field-float">
                    <input
                      id="reset-newpass2"
                      name="confirmPassword"
                      type="password"
                      placeholder=" "
                      value={rpNewPass2}
                      onChange={e => setRpNewPass2(e.target.value)}
                      autoComplete="new-password"
                    />
                    <label htmlFor="reset-newpass2">Confirm Password</label>
                  </div>
                  <Button type="submit" full loading={rpStatus === 'saving'} loadingText="Saving…" className="mt-2">
                    <Check size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Set Password &amp; Continue
                  </Button>
                </form>
              </div>
            </div>
          )}

          </div>{/* /auth2-card */}

          <div className="auth2-foot">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={11} style={{ color: 'var(--green)' }} /> Encrypted &amp; secure</span>
            {' · '}
            <button type="button" className="link-btn" onClick={() => setFaqOpen(true)}>Why AcadFlow?</button>
            {' · '}© {new Date().getFullYear()} AcadFlow
          </div>
        </div>{/* /auth2-main */}
      </div>{/* /auth2-inner */}

      {faqOpen && (
        <Suspense fallback={null}>
          <FaqModal onClose={() => setFaqOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
