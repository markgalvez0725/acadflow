import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { verifyPassword, hashPassword } from '@/utils/crypto'
import { genOTP, verifyOTP, consumeOTP } from '@/utils/otp'
import { isLockedOut, recordFailedAttempt, clearAttempts } from '@/utils/validate'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const SESSION_KEY = 'cp_session'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [sessionRole, setSessionRole]       = useState(null) // 'admin' | 'student' | null
  const [currentStudent, setCurrentStudent] = useState(null)
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
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ role, studentId: studentObj?.id || null, ts: Date.now() }))
    } catch (e) {}
    // Replace the current history entry so pressing Back after login
    // does not return to the login page.
    try { history.replaceState(null, '', window.location.href) } catch (e) {}
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
    // Fallback 1: student has no stored password (pre-account migration).
    // Fallback 2: student was admin-added with a temp password (_tempPass: true).
    //   Their hash may have been created with a different salt (before the salt was
    //   hardcoded), so we accept the literal default password as a bypass so they
    //   can log in and be forced to change it on first login.
    const DEFAULT_PASS = 'Welcome@2026'
    if (!match && password === DEFAULT_PASS && (!storedHash || student.account?._tempPass)) {
      match = true
    }
    if (!match) {
      recordFailedAttempt(key)
      return { ok: false, msg: 'Incorrect password.' }
    }
    clearAttempts(key)
    const needsPassSetup = !storedHash || student.forceChangePassword || !!student.account?._tempPass
    _startSession('student', student)
    return { ok: true, student, forceChange: needsPassSetup }
  }, [])

  // ── Logout ──────────────────────────────────────────────────────────────
  const logout = useCallback((reason) => {
    clearTimeout(sessionTimerRef.current)
    try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
    otpSessionsRef.current = {}
    setSessionRole(null)
    setCurrentStudent(null)
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
