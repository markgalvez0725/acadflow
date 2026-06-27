import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Eye, EyeOff, BarChart2, CalendarCheck, Rss, MessageSquare, KeyRound, Check, ShieldCheck, GraduationCap, IdCard, Lock, HelpCircle, Fingerprint, ScanFace } from 'lucide-react'
import FaceResetModal from '@/components/student/modals/FaceResetModal'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'
import { useTypingEffect } from '@/hooks/useTypingEffect'
import { useAuth } from '@/context/AuthContext'
import { isBiometricSupported, getBiometric, biometricUnlock } from '@/utils/biometric'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { createUserWithEmailAndPassword, deleteUser, signOut, signInWithEmailAndPassword, signInWithCustomToken, updatePassword } from 'firebase/auth'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { getFbAuth, getDb } from '@/firebase/firebaseInit'
import { studentEmail, studentDocId } from '@/constants/auth'
import { hashPassword, verifyPassword } from '@/utils/crypto'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import { SECURITY_QUESTIONS } from '@/utils/securityQuestions'
import { scoreIdentity, describeFields } from '@/utils/identityVerify'
import { courseOptions } from '@/constants/courses'
import LoadingButton from '@/components/primitives/LoadingButton'
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

// Modes: 'student' | 'register' | 'forgot' | 'fp-set-sq' | 'fp-sq'
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

  // Forgot-password (live, professor-coordinated) reset
  const [rpNum,      setRpNum]      = useState('')
  const [rpStatus,   setRpStatus]   = useState('idle') // 'idle' | 'waiting' | 'setpass' | 'saving'
  const [rpNewPass,  setRpNewPass]  = useState('')
  const [rpNewPass2, setRpNewPass2] = useState('')
  const [faceResetOpen, setFaceResetOpen] = useState(false)
  const rpTimer = useRef(null)
  const rpDeadline = useRef(0)

  // Register form
  const [regSnum,    setRegSnum]    = useState('')
  const [regSurname, setRegSurname] = useState('')
  const [regFirst,   setRegFirst]   = useState('')
  const [regMiddle,  setRegMiddle]  = useState('')
  const [regCourse,  setRegCourse]  = useState('')
  const [regYear,    setRegYear]    = useState('1st Year')
  const [regSection, setRegSection] = useState('')
  const [regPass,    setRegPass]    = useState('')
  const [regPass2,   setRegPass2]   = useState('')

  // Forgot form
  const [fpSnum,    setFpSnum]    = useState('')
  const [fpPending, setFpPending] = useState(null) // { snum: canonical id }

  // Forgot secret question answer + new password
  const [fpAnswer,   setFpAnswer]   = useState('')
  const [fpNewPass,  setFpNewPass]  = useState('')
  const [fpNewPass2, setFpNewPass2] = useState('')

  // Forgot - set security question (for legacy accounts without one)
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
      const result = await loginStudent(snum.trim(), pass)
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
      const result = await loginStudent((bsnum || '').trim(), password)
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

  // ── Register - verified, roster-gated account creation (Firebase Auth) ─────
  // Flow: create the auth account (signs in), then read the roster record while
  // authenticated and verify the details. If anything fails, the just-created
  // account is deleted so nothing is left behind.
  async function handleRegStep1(e) {
    e.preventDefault()
    clearMessages()

    const snErr = validateSnum(regSnum)
    if (snErr) return setErr(snErr)
    // Compose the canonical school format from separate fields so the surname
    // is never ambiguous: "SURNAME, FNAME MNAME", ALL UPPERCASE.
    const clean   = v => v.trim().toUpperCase().replace(/\s+/g, ' ')
    const surname = clean(regSurname)
    const first   = clean(regFirst)
    const middle  = clean(regMiddle)
    if (!surname) return setErr('Please enter your surname.')
    if (!first)   return setErr('Please enter your first name.')
    const given   = [first, middle].filter(Boolean).join(' ')
    const nameVal = `${surname}, ${given}`
    if (!regCourse.trim()) return setErr('Please enter your course/program.')
    if (!regSection.trim()) return setErr('Please enter your section.')
    if (regPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(regPass) || !/[0-9]/.test(regPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (regPass !== regPass2) return setErr('Passwords do not match.')

    const auth = getFbAuth()
    const db = getDb()
    if (!fbReady || !auth || !db) {
      return setErr('Still connecting. Please wait a moment and try again.')
    }

    setLoading(true)
    let createdUser = null
    try {
      // 1) Create the Firebase Auth account (this also signs us in).
      try {
        const cred = await createUserWithEmailAndPassword(auth, studentEmail(regSnum), regPass)
        createdUser = cred.user
      } catch (err) {
        const c = err?.code || ''
        if (c.includes('email-already-in-use'))
          return setErr('⛔ An account already exists for this student number. Switch to "Sign In", or ask your professor to reset it.')
        if (c.includes('operation-not-allowed'))
          return setErr('Registration is not enabled yet. Please ask the admin to turn on Email/Password sign-in.')
        if (c.includes('weak-password'))
          return setErr('Password is too weak. Use at least 8 characters with an uppercase letter and a number.')
        return setErr('Could not create your account: ' + (err?.message || 'unknown error'))
      }

      // 2) Read the roster record directly (now authenticated).
      const ref  = doc(db, 'students', studentDocId(regSnum))
      const snap = await getDoc(ref)
      if (!snap.exists()) {
        await deleteUser(createdUser).catch(() => {})
        await signOut(auth).catch(() => {})
        return setErr('⛔ We could not find your student number in the class records. Please ask your professor to add you first, then register.')
      }
      const roster = snap.data()
      if (roster.account?.registered) {
        await signOut(auth).catch(() => {})
        return setErr('⛔ An account already exists for this student number. Switch to "Sign In".')
      }

      // 3) Score the entered identity against the roster (fuzzy, multi-signal).
      const entered = { name: nameVal, course: regCourse.trim(), year: regYear, section: regSection.trim() }
      const score = scoreIdentity(entered, roster)
      if (score.verdict === 'block') {
        await deleteUser(createdUser).catch(() => {})
        await signOut(auth).catch(() => {})
        const detail = describeFields(score.fields)
        return setErr(`⛔ Your details don't match our records for this student number${detail ? ` (${detail})` : ''}. Please check your name, course, year, and section, or contact your professor.`)
      }

      // 4) Create the account on the roster record. It starts PENDING:
      //    `verified` is set to true only by the server gate below (strong match)
      //    or by a professor - never by this device. Writing it explicitly false
      //    keeps the account pending even if the server is unreachable.
      const patch = {
        'account.registered': true,
        'account.activated': true,
        'account._tempPass': false,
        'account.verified': false,
        'account.verification': { method: 'ai', confidence: score.confidence ?? 0, fields: score.fields, at: Date.now() },
      }
      if (!roster.name)    patch.name    = nameVal
      if (!roster.course)  patch.course  = regCourse.trim()
      if (!roster.year)    patch.year    = regYear
      if (!roster.section) patch.section = regSection.trim()
      await updateDoc(ref, patch)

      // 5) Server-side verification (authoritative). On a strong match the server
      //    flips account.verified=true → the student is Active immediately. If the
      //    endpoint is unconfigured/unreachable, the account stays Pending for the
      //    professor to approve - the student is never blocked.
      let verified = false
      try {
        const idToken = await createdUser.getIdToken()
        const resp = await fetch('/api/verify-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, studentNumber: regSnum, ...entered }),
        })
        if (resp.ok) { const d = await resp.json().catch(() => ({})); verified = !!d.verified }
      } catch (_) { /* leave pending - professor will verify */ }

      // 6) Sign out so they sign in cleanly with their new password.
      await signOut(auth).catch(() => {})
      setOkMsg(verified
        ? '✅ Verified! Sign in with your student number.'
        : '✅ Account created. You can sign in now - full access unlocks once your professor verifies you.')
      setTimeout(() => { setMode('student'); clearMessages() }, 2400)
    } catch (err) {
      if (createdUser) { try { await deleteUser(createdUser) } catch (_) {} }
      try { await signOut(auth) } catch (_) {}
      setErr('Registration failed: ' + (err?.message || 'unknown error'))
    } finally {
      setLoading(false)
    }
  }


  // ── Forgot Step 1 - look up student, display security question ───────────
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
        return setErr('No account found for that student number. Please contact your professor.')
      }
      if (!s.account?.registered) {
        return setErr('This student number has no account yet. Switch to "Register" to create one - you\'ll verify your identity with your course, year, and section.')
      }
      setFpPending({ snum: s.id })
      if (!s.account?.securityQuestion) {
        // Legacy account - let them set a security question first
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

  // ── Forgot Step 1b - set security question for legacy accounts ──────────
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

  // ── Forgot Step 2 - verify answer, save new password ────────────────────
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
      return setErr('Incorrect answer. If you cannot remember, please contact your professor to reset your password.')

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
            <span onClick={handleLogoTap}><AcadFlowLogo variant="stacked" size="lg" className="justify-center" /></span>
            <p className="auth2-tagline">Grades, attendance, and messages - live, in one calm place.</p>
          </div>

          <div className="auth2-card">
            <div className="auth2-eyebrow auth2-eyebrow--card"><GraduationCap size={13} /> Student portal</div>
            {(mode === 'student' || mode === 'register') && (
              <>
                <div className="auth2-title">{mode === 'student' ? 'Welcome back' : 'Create account'}</div>
                <p className="auth2-sub-text">{mode === 'student' ? 'Sign in to your student portal.' : 'Register your AcadFlow student account.'}</p>
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
                  type="text"
                  placeholder=" "
                  value={snum}
                  onChange={e => setSnum(sanitizeSnum(e.target.value))}
                  autoComplete="username"
                />
                <label>Student Number</label>
              </div>
              <div className="field-float field-float--icon">
                <span className="ff-icon" aria-hidden="true"><Lock size={16} /></span>
                <input
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
                <label>Password</label>
              </div>
              <LoadingButton loading={loading} loadingText="Signing in…" className="btn btn-primary btn-full mt-2">
                Sign In
              </LoadingButton>
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

          {/* ── Register Step 1 ──────────────────────────────────────── */}
          {mode === 'register' && (
            <form onSubmit={handleRegStep1}>
              <div className="auth-section-label">Verify your identity</div>

              <div className="field-float">
                <input type="text" placeholder=" " value={regSnum} onChange={e => setRegSnum(sanitizeSnum(e.target.value))} autoComplete="username" />
                <label>Student Number</label>
              </div>
              <div className="field-float">
                <input type="text" placeholder=" " value={regSurname} onChange={e => setRegSurname(e.target.value.toUpperCase())} autoComplete="family-name" />
                <label>Surname</label>
              </div>
              <div className="ff-row">
                <div className="field-float">
                  <input type="text" placeholder=" " value={regFirst} onChange={e => setRegFirst(e.target.value.toUpperCase())} autoComplete="given-name" />
                  <label>First Name</label>
                </div>
                <div className="field-float">
                  <input type="text" placeholder=" " value={regMiddle} onChange={e => setRegMiddle(e.target.value.toUpperCase())} autoComplete="additional-name" />
                  <label>Middle Name</label>
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '-4px 2px 12px', lineHeight: 1.5 }}>
                Saved as <strong>{(regSurname.trim() || 'SURNAME').toUpperCase()}, {[regFirst.trim().toUpperCase(), regMiddle.trim().toUpperCase()].filter(Boolean).join(' ') || 'FNAME MNAME'}</strong> to match your class records. Middle name is optional.
              </p>
              <div className="field-float field-float--select">
                <select value={regCourse} onChange={e => setRegCourse(e.target.value)}>
                  <option value="">- Select course -</option>
                  {courseOptions(regCourse).map(c => <option key={c} value={c}>{courseShort(c)}</option>)}
                </select>
                <label>Course / Program</label>
              </div>
              <div className="ff-row">
                <div className="field-float field-float--select">
                  <select value={regYear} onChange={e => setRegYear(e.target.value)}>
                    <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
                  </select>
                  <label>Year Level</label>
                </div>
                <div className="field-float">
                  <input type="text" placeholder=" " value={regSection} onChange={e => setRegSection(e.target.value)} />
                  <label>Section</label>
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '-4px 2px 10px', lineHeight: 1.5 }}>
                Your details must match your professor's records to verify you're a real student. Section example: <strong>2A</strong>.
              </p>

              <div className="auth-section-label">Create your login</div>

              <div className="field-float">
                <input
                  type={showRegPass ? 'text' : 'password'}
                  placeholder=" "
                  value={regPass}
                  onChange={e => setRegPass(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass(v => !v)} tabIndex={-1} aria-label={showRegPass ? 'Hide password' : 'Show password'}>
                  {showRegPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <label>Password</label>
              </div>
              <div className="pw-reqs" aria-hidden="true">
                {[['8+ characters', regPass.length >= 8], ['1 uppercase', /[A-Z]/.test(regPass)], ['1 number', /[0-9]/.test(regPass)]].map(([label, met]) => (
                  <span key={label} className={`pw-req${met ? ' met' : ''}`}>
                    <span className="dot">{met ? <Check size={11} /> : <span className="pw-req-dot" />}</span>{label}
                  </span>
                ))}
              </div>
              <div className="field-float">
                <input
                  type={showRegPass2 ? 'text' : 'password'}
                  placeholder=" "
                  value={regPass2}
                  onChange={e => setRegPass2(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingRight: 38 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass2(v => !v)} tabIndex={-1} aria-label={showRegPass2 ? 'Hide password' : 'Show password'}>
                  {showRegPass2 ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <label>Confirm Password</label>
              </div>
              {regPass2.length > 0 && (
                <div className={`pw-match ${regPass === regPass2 ? 'ok' : 'no'}`} role="status">
                  {regPass === regPass2 ? '✓ Passwords match' : '✗ Passwords don’t match yet'}
                </div>
              )}
              <LoadingButton loading={loading} loadingText="Next…" className="btn btn-primary btn-full mt-2">
                Next →
              </LoadingButton>
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
                  type="text"
                  placeholder=" "
                  value={rpNum}
                  onChange={e => setRpNum(e.target.value)}
                  disabled={rpStatus !== 'idle'}
                  autoComplete="off"
                />
                <label>Student Number</label>
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
                      type="password"
                      placeholder=" "
                      value={rpNewPass}
                      onChange={e => setRpNewPass(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                    />
                    <label>New Password</label>
                  </div>
                  <p className="text-xs text-ink3 -mt-1 mb-2">Min. 8 characters, 1 uppercase, 1 number.</p>
                  <div className="field-float">
                    <input
                      type="password"
                      placeholder=" "
                      value={rpNewPass2}
                      onChange={e => setRpNewPass2(e.target.value)}
                      autoComplete="new-password"
                    />
                    <label>Confirm Password</label>
                  </div>
                  <LoadingButton loading={rpStatus === 'saving'} loadingText="Saving…" className="btn btn-primary btn-full mt-2">
                    <Check size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Set Password &amp; Continue
                  </LoadingButton>
                </form>
              </div>
            </div>
          )}

          {/* ── Forgot Password Step 1b - Set Security Question ─────── */}
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

          {/* ── Forgot Password Step 2 - Answer + New Password ──────── */}
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
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass(v => !v)} tabIndex={-1} aria-label={showFpPass ? 'Hide password' : 'Show password'}>
                    {showFpPass ? <EyeOff size={16} /> : <Eye size={16} />}
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
                  <button type="button" className="pw-toggle" onClick={() => setShowFpPass2(v => !v)} tabIndex={-1} aria-label={showFpPass2 ? 'Hide password' : 'Show password'}>
                    {showFpPass2 ? <EyeOff size={16} /> : <Eye size={16} />}
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

          </div>{/* /auth2-card */}

          {/* Mode switch - Instagram-style secondary card */}
          {mode === 'student' && (
            <div className="auth2-subcard">
              New here?{' '}
              <button type="button" className="link-btn" onClick={() => { setMode('register'); clearMessages() }}>Create a student account</button>
            </div>
          )}
          {mode === 'register' && (
            <div className="auth2-subcard">
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => { setMode('student'); clearMessages() }}>Sign in</button>
            </div>
          )}

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
