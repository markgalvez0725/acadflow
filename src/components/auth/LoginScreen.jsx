import React, { useState, useEffect } from 'react'
import { Eye, EyeOff, BarChart2, CalendarCheck, Rss, MessageSquare } from 'lucide-react'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'
import { useTypingEffect } from '@/hooks/useTypingEffect'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { hashPassword, verifyPassword } from '@/utils/crypto'
import { validateSnum, sanitizeSnum } from '@/utils/validate'
import { SECURITY_QUESTIONS } from '@/utils/securityQuestions'
import LoadingButton from '@/components/primitives/LoadingButton'
import ThemeToggle from '@/components/primitives/ThemeToggle'

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

// Modes: 'student' | 'register' | 'reg-sq' | 'forgot' | 'fp-set-sq' | 'fp-sq'
export default function LoginScreen() {
  const { loginStudent } = useAuth()
  const { students, saveStudents, fbReady, classes } = useData()
  const { theme } = useUI()

  const [mode, setMode]       = useState('student')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')
  const [okMsg, setOkMsg]     = useState('')


  // Login form
  const [snum, setSnum] = useState('')
  const [pass, setPass] = useState('')

  // Register form
  const [regSnum,    setRegSnum]    = useState('')
  const [regName,    setRegName]    = useState('')
  const [regCourse,  setRegCourse]  = useState('')
  const [regYear,    setRegYear]    = useState('1st Year')
  const [regSection, setRegSection] = useState('')
  const [regEmail,   setRegEmail]   = useState('')
  const [regPass,    setRegPass]    = useState('')
  const [regPass2,   setRegPass2]   = useState('')

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
    if (!regCourse.trim()) return setErr('Please enter your course/program.')
    if (!regSection.trim()) return setErr('Please enter your section.')
    if (!regEmail.includes('@')) return setErr('Please enter a valid email address.')
    if (regPass.length < 8) return setErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(regPass) || !/[0-9]/.test(regPass))
      return setErr('Password must include at least one uppercase letter and one number.')
    if (regPass !== regPass2) return setErr('Passwords do not match.')

    if (!fbReady || students.length === 0) {
      return setErr('Student records are still loading. Please wait a moment and try again.')
    }

    // ── Roster gate: the student number must already exist in the teacher's records ──
    const roster = students.find(s => s.id.toLowerCase() === regSnum.trim().toLowerCase())
    if (!roster) {
      return setErr('⛔ We could not find your student number in the class records. Please ask your teacher to add you first, then register.')
    }
    if (roster.account?.registered) {
      return setErr('⛔ An account already exists for this student number. Use "Forgot Password" if you need to reset it.')
    }

    // ── Identity verification against the roster (course + year + section + name) ──
    const norm        = v => (v == null ? '' : String(v)).trim().toLowerCase()
    const normSection = v => norm(v).replace(/[\s\-_]/g, '')
    const yearDigit   = v => { const m = String(v ?? '').match(/(\d)/); return m ? m[1] : null }
    const rosterSection = roster.section ||
      classes?.find(c => c.id === (roster.classId || roster.classIds?.[0]))?.section || ''

    if (roster.name && norm(roster.name) !== norm(regName)) {
      return setErr('⛔ The name does not match our records for this student number. Please check your details or contact your teacher.')
    }
    if (roster.course && norm(roster.course) !== norm(regCourse)) {
      return setErr('⛔ The course you entered does not match our records for this student number.')
    }
    if (roster.year && yearDigit(roster.year) && yearDigit(roster.year) !== yearDigit(regYear)) {
      return setErr('⛔ The year level you entered does not match our records for this student number.')
    }
    if (rosterSection && normSection(rosterSection) !== normSection(regSection)) {
      return setErr('⛔ The section you entered does not match our records for this student number.')
    }

    const emailDup = students.find(s =>
      s.account?.registered && s.account?.email?.toLowerCase() === regEmail.toLowerCase()
    )
    if (emailDup)
      return setErr('⛔ This email is already linked to another account.')

    setRegPending({
      snum: roster.id, name: regName, email: regEmail, pass: regPass,
      course: regCourse.trim(), year: regYear, section: regSection.trim(),
    })
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
      // Roster gate already guarantees the student exists; never create one here.
      if (idx < 0) {
        setLoading(false)
        return setErr('⛔ Your student record could not be found. Please contact your teacher.')
      }
      const existing = updatedStudents[idx]
      updatedStudents[idx] = {
        ...existing,
        // Keep the teacher's roster values; only fill blanks from the verified input.
        name:    existing.name    || regPending.name,
        course:  existing.course  || regPending.course,
        year:    existing.year    || regPending.year,
        section: existing.section || regPending.section,
        account: {
          ...existing.account,
          registered: true,
          activated: true,
          pass: hashedPass,
          email: regPending.email,
          securityQuestion: regSqKey,
          securityAnswer: hashedAnswer,
        },
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
        return setErr('This student number has no account yet. Switch to "Register" to create one — you\'ll verify your identity with your course, year, and section.')
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
    <div className="min-h-screen flex relative overflow-hidden" id="login-screen">
      <ThemeToggle />

      {/* ── Left branding panel (desktop only) ── */}
      <div className="auth-brand hidden lg:flex flex-col justify-between flex-1 relative z-10 p-10 pointer-events-none select-none">
        <AcadFlowLogo size="sm" />
        <div>
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
            Grades, attendance, announcements, and messages — all in one modern academic platform built for students and educators.
          </p>
          <div className="flex gap-6 mt-8">
            {STUDENT_FEATURES.map(({ Icon, label }) => (
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

      {/* ── Right glass panel ── */}
      <div className="login-panel relative z-10 flex flex-col justify-center w-full lg:max-w-[460px] lg:min-h-screen px-4 py-8 lg:px-12">
        {/* Mobile branding (hidden on desktop) */}
        <div className="auth-brand-mobile text-center mb-6 lg:hidden">
          <AcadFlowLogo variant="stacked" size="lg" className="justify-center mb-1" />
          <p className="text-xs text-ink3 mt-2">Academic Management System</p>
        </div>

        {/* Desktop welcome text */}
        <div className="hidden lg:block mb-7">
          <h2 className="text-2xl font-bold text-ink mb-1" style={{ letterSpacing: '-.02em' }}>
            {mode === 'student' ? 'Welcome back' : mode === 'register' ? 'Create account' : 'Account recovery'}
          </h2>
          <p className="text-sm text-ink3">
            {mode === 'student' ? 'Sign in to your student portal.' : mode === 'register' ? 'Register your AcadFlow student account.' : 'Recover access to your account.'}
          </p>
        </div>

        {/* Mode tabs — only on sign-in / register screens */}
        {(mode === 'student' || mode === 'register') && (
          <div className="glass-tab-bar flex mb-5">
            {[['student', 'Sign In'], ['register', 'Register']].map(([m, label]) => (
              <button
                key={m}
                className={`flex-1 py-2 rounded-[9px] text-sm font-semibold transition-all ${mode === m ? 'glass-tab-active text-ink' : 'text-ink2 hover:text-ink'}`}
                onClick={() => { setMode(m); clearMessages() }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
                <input type="text" placeholder=" " value={regCourse} onChange={e => setRegCourse(e.target.value)} />
                <label>Course / Program</label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Year Level</label>
                  <select value={regYear} onChange={e => setRegYear(e.target.value)} style={{ width: '100%' }}>
                    <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Section</label>
                  <input type="text" value={regSection} onChange={e => setRegSection(e.target.value)} placeholder="e.g. 2A" style={{ width: '100%' }} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '2px 2px 8px' }}>
                Your details must match your teacher's records to verify you're a real student.
              </p>
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
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass(v => !v)} tabIndex={-1} aria-label={showRegPass ? 'Hide password' : 'Show password'}>
                  {showRegPass ? <EyeOff size={16} /> : <Eye size={16} />}
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
                <button type="button" className="pw-toggle" onClick={() => setShowRegPass2(v => !v)} tabIndex={-1} aria-label={showRegPass2 ? 'Hide password' : 'Show password'}>
                  {showRegPass2 ? <EyeOff size={16} /> : <Eye size={16} />}
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
