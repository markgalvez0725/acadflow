import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { hashPassword } from '@/utils/crypto'
import { genOTP, verifyOTP, consumeOTP } from '@/utils/otp'
import { isLockedOut, recordFailedAttempt, clearAttempts } from '@/utils/validate'
import { getFbAuth, getDb } from '@/firebase/firebaseInit'
import { ADMIN_EMAIL, studentEmail, studentDocId } from '@/constants/auth'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const SESSION_KEY = 'cp_session'
const LAST_LOGIN_PREFIX = 'cp_lastlogin_'

// Map Firebase Auth error codes to friendly, non-leaky messages.
function friendlyAuthError(e) {
  const c = (e && e.code) || ''
  if (c.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.'
  if (c.includes('network'))           return 'Network error. Check your connection and try again.'
  if (c.includes('user-disabled'))     return 'This account has been disabled. Please contact your teacher.'
  if (c.includes('operation-not-allowed')) return 'Sign-in is not enabled yet. Ask the admin to turn on Email/Password sign-in.'
  return 'Incorrect login details. Please try again.'
}

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

  // ── Admin login (Firebase Auth) ───────────────────────────────────────────
  // Signs in with the fixed admin email; only the password is variable, so a
  // non-admin Firebase user can never gain the admin role here.
  const loginAdmin = useCallback(async (_username, password) => {
    const lockMsg = isLockedOut('admin')
    if (lockMsg) return { ok: false, msg: lockMsg }
    const auth = getFbAuth()
    if (!auth) return { ok: false, msg: 'Authentication is still starting. Please wait a moment and try again.' }

    try {
      const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password)
      if ((cred.user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        await signOut(auth)
        recordFailedAttempt('admin')
        return { ok: false, msg: 'This is not the admin account.' }
      }
    } catch (e) {
      recordFailedAttempt('admin')
      return { ok: false, msg: friendlyAuthError(e) }
    }
    clearAttempts('admin')
    _startSession('admin')
    return { ok: true }
  }, [])

  // ── Student login (Firebase Auth) ─────────────────────────────────────────
  const loginStudent = useCallback(async (studentId, password) => {
    const snum = (studentId || '').trim()
    const key = 'student_' + snum.toLowerCase()
    const lockMsg = isLockedOut(key)
    if (lockMsg) return { ok: false, msg: lockMsg }
    const auth = getFbAuth()
    if (!auth) return { ok: false, msg: 'Authentication is still starting. Please wait a moment and try again.' }

    try {
      await signInWithEmailAndPassword(auth, studentEmail(snum), password)
    } catch (e) {
      recordFailedAttempt(key)
      return { ok: false, msg: friendlyAuthError(e) }
    }
    clearAttempts(key)

    // Confirm a roster record exists, then let StudentLayout resolve the full
    // (deserialized) record from the live students list via the _pending flag.
    let exists = false
    try {
      const snap = await getDoc(doc(getDb(), 'students', studentDocId(snum)))
      exists = snap.exists()
    } catch (e) {}
    if (!exists) {
      await signOut(auth)
      return { ok: false, msg: 'Your student record was not found. Please contact your teacher.' }
    }

    _startSession('student', { id: studentDocId(snum), _pending: true })
    return { ok: true, student: { id: studentDocId(snum) } }
  }, [])

  // ── Logout ──────────────────────────────────────────────────────────────
  const logout = useCallback((reason) => {
    clearTimeout(sessionTimerRef.current)
    try { const a = getFbAuth(); if (a) signOut(a) } catch (e) {}
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
