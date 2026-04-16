import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { verifyPassword, hashPassword } from '@/utils/crypto'
import { genOTP, verifyOTP, consumeOTP } from '@/utils/otp'
import { isLockedOut, recordFailedAttempt, clearAttempts } from '@/utils/validate'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const SESSION_KEY = 'cp_session'
const LAST_LOGIN_PREFIX = 'cp_lastlogin_'
const DEFAULT_PASS = 'Welcome@2026'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [sessionRole, setSessionRole]       = useState(null) // 'admin' | 'student' | null
  const [currentStudent, setCurrentStudent] = useState(null)
  const [loginTime, setLoginTime]           = useState(null) // ms timestamp of current login
  const [lastLogin, setLastLogin]           = useState(null) // ms timestamp of previous login
  const sessionTimerRef = useRef(null)
  // OTP sessions: { ctx: { code, expires, email } }
  const otpSessionsRef = useRef({})

  // ── Session restore on mount ────────────────────────────────────────────
  useEffect(() => {
    _attemptRestore()
  }, [])

  // ── Inactivity timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionRole) return
    const events = ['click', 'keydown', 'mousemove', 'touchstart']
    const reset = () => _resetTimer()
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))

    // On device wake/tab focus, check if session already expired
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) return logout('timeout')
        const sess = JSON.parse(raw)
        if (Date.now() - sess.ts > SESSION_TIMEOUT_MS) logout('timeout')
      } catch (e) {}
    }
    document.addEventListener('visibilitychange', onVisibility)

    _resetTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(sessionTimerRef.current)
    }
  }, [sessionRole])

  function _resetTimer() {
    clearTimeout(sessionTimerRef.current)
    // Refresh stored timestamp
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const sess = JSON.parse(raw)
        sess.ts = Date.now()
        localStorage.setItem(SESSION_KEY, JSON.stringify(sess))
      }
    } catch (e) {}
    sessionTimerRef.current = setTimeout(() => logout('timeout'), SESSION_TIMEOUT_MS)
  }

  function _startSession(role, studentObj = null) {
    const now = Date.now()
    const lastLoginKey = LAST_LOGIN_PREFIX + (role === 'admin' ? 'admin' : (studentObj?.id || 'student'))

    // Read previous session's timestamp to use as lastLogin
    let prevTs = null
    try {
      const prev = localStorage.getItem(lastLoginKey)
      if (prev) prevTs = JSON.parse(prev).ts
    } catch (e) {}

    // Save this login time for next session's lastLogin reference
    try { localStorage.setItem(lastLoginKey, JSON.stringify({ ts: now })) } catch (e) {}

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ role, studentId: studentObj?.id || null, ts: now, loginTime: now, lastLogin: prevTs }))
    } catch (e) {}

    // Replace the current history entry so pressing Back after login
    // does not return to the login page.
    try { history.replaceState(null, '', window.location.href) } catch (e) {}

    setLoginTime(now)
    setLastLogin(prevTs)
    setSessionRole(role)
    setCurrentStudent(studentObj)
  }

  function _attemptRestore() {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return
      const sess = JSON.parse(raw)
      if (!sess?.role || !sess?.ts) return
      if (Date.now() - sess.ts > SESSION_TIMEOUT_MS) {
        localStorage.removeItem(SESSION_KEY)
        return
      }
      setSessionRole(sess.role)
      setLoginTime(sess.loginTime || null)
      setLastLogin(sess.lastLogin || null)
      // currentStudent will be populated from DataContext.students once loaded
      if (sess.studentId) {
        // Defer: store the ID and AppRouter/StudentLayout will match it
        setCurrentStudent({ id: sess.studentId, _pending: true })
      }
    } catch (e) {}
  }

  // ── Admin login ─────────────────────────────────────────────────────────
  const loginAdmin = useCallback(async (username, password, admin) => {
    const lockMsg = isLockedOut('admin')
    if (lockMsg) return { ok: false, msg: lockMsg }

    const userMatch = username.trim().toLowerCase() === (admin.user || 'admin').toLowerCase()
    const passMatch = await verifyPassword(password, admin.pass)

    if (!userMatch || !passMatch) {
      recordFailedAttempt('admin')
      return { ok: false, msg: 'Invalid username or password.' }
    }
    clearAttempts('admin')
    _startSession('admin')
    return { ok: true }
  }, [])

  // ── Student login ───────────────────────────────────────────────────────
  const loginStudent = useCallback(async (studentId, password, students) => {
    const key = 'student_' + studentId
    const lockMsg = isLockedOut(key)
    if (lockMsg) return { ok: false, msg: lockMsg }

    const student = students.find(s => s.id.toLowerCase() === studentId.trim().toLowerCase())
    if (!student) {
      recordFailedAttempt(key)
      return { ok: false, msg: 'Student ID not found.' }
    }
    const storedHash = student.account?.pass ?? student.pass
    let match = await verifyPassword(password, storedHash)
    // Fallback: any student who has not fully set up their account can log in
    // with the default password and will be forced to change it on first login.
    // This covers: no account at all, imported students (_tempPass), and any
    // existing student whose account is not yet marked as registered.
    const notRegistered = !student.account?.registered
    if (!match && password === DEFAULT_PASS && notRegistered) {
      match = true
    }
    if (!match) {
      recordFailedAttempt(key)
      return { ok: false, msg: 'Incorrect password.' }
    }
    clearAttempts(key)
    const needsPassSetup = notRegistered || student.forceChangePassword

    // Record first login timestamp when student uses a temp/default password
    // for the first time. Fire-and-forget — never blocks session start.
    let sessionStudent = student
    if ((student.account?._tempPass || (notRegistered && password === DEFAULT_PASS)) && !student.account?.firstLoginAt) {
      const now = Date.now()
      sessionStudent = {
        ...student,
        account: { ...student.account, firstLoginAt: now },
      }
    }

    _startSession('student', sessionStudent)
    return { ok: true, student: sessionStudent, forceChange: needsPassSetup }
  }, [])

  // ── Logout ──────────────────────────────────────────────────────────────
  const logout = useCallback((reason) => {
    clearTimeout(sessionTimerRef.current)
    try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
    otpSessionsRef.current = {}
    setSessionRole(null)
    setCurrentStudent(null)
    setLoginTime(null)
    setLastLogin(null)
    if (reason === 'timeout') {
      console.log('[Auth] Session expired — logged out.')
    }
  }, [])

  // ── OTP helpers ─────────────────────────────────────────────────────────
  const createOTP = useCallback((ctx, email) => {
    const code = genOTP()
    const expires = Date.now() + 10 * 60 * 1000
    otpSessionsRef.current[ctx] = { code, expires, email }
    return code
  }, [])

  const checkOTP = useCallback((ctx, inputCode) => {
    return verifyOTP(otpSessionsRef.current, ctx, inputCode)
  }, [])

  const clearOTP = useCallback((ctx) => {
    consumeOTP(otpSessionsRef.current, ctx)
  }, [])

  return (
    <AuthContext.Provider value={{
      sessionRole, currentStudent, setCurrentStudent,
      loginTime, lastLogin,
      loginAdmin, loginStudent, logout,
      createOTP, checkOTP, clearOTP,
      hashPassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
