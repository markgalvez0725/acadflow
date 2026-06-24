import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

const UIContext = createContext(null)

// Map the semantic type names used across the app (success/error/warn/info) onto
// the six colour variants the toast renderer actually styles. Without this every
// success/error toast silently fell through to the default "dark" variant — which
// is also the one that became invisible in dark mode.
const TOAST_TYPE_ALIAS = {
  success: 'green',
  error:   'red',
  danger:  'red',
  warn:    'yellow',
  warning: 'yellow',
  info:    'blue',
}
function normalizeToastType(type) {
  return TOAST_TYPE_ALIAS[type] || type || 'dark'
}

export function UIProvider({ children }) {
  const [theme, setTheme]           = useState('light')
  const [adminTab, setAdminTab]     = useState('dashboard')
  const [studentTab, setStudentTab] = useState('overview')
  const [toastQueue, setToastQueue] = useState([])
  const [dialog, setDialog]         = useState(null) // { title, msg, type, confirmLabel, cancelLabel, showCancel }
  const dialogResolveRef = useRef(null)
  const [isLoading, setIsLoading]   = useState(false)
  const loadingCount = useRef(0)
  // Globally-shared "view student profile" target — any teacher-side button can
  // open the same profile modal by id, keeping every entry point in sync.
  const [viewStudentId, setViewStudentId] = useState(null)

  const startLoading = useCallback(() => {
    loadingCount.current += 1
    setIsLoading(true)
  }, [])

  const stopLoading = useCallback(() => {
    loadingCount.current = Math.max(0, loadingCount.current - 1)
    if (loadingCount.current === 0) setIsLoading(false)
  }, [])

  // ── Theme init (read localStorage + OS preference) ─────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('acadflow_theme')
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const dark = saved ? saved === 'dark' : prefersDark
      const next = dark ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', next)
      setTheme(next)
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      try { localStorage.setItem('acadflow_theme', next) } catch (e) {}
      return next
    })
  }, [])

  // ── Toast ───────────────────────────────────────────────────────────────
  // Remember the last toast so we can collapse rapid duplicates. The same toast
  // fires twice in several situations — React StrictMode double-invoking an
  // effect, a Firestore onSnapshot echo re-running a notification effect, or a
  // handler bound twice — and the user sees every message appear doubled. We
  // suppress an identical (message + type) toast within a short window.
  const lastToastRef = useRef({ key: '', at: 0 })
  const toast = useCallback((msg, type = 'dark', duration = 3500) => {
    const t = normalizeToastType(type)
    const now = Date.now()
    const key = `${t}::${msg}`
    if (lastToastRef.current.key === key && now - lastToastRef.current.at < 1000) return
    lastToastRef.current = { key, at: now }
    const id = now + Math.random()
    setToastQueue(q => [...q, { id, msg, type: t, duration }])
  }, [])

  // Toast with an inline action button (e.g. "Undo"). The action runs on click;
  // the toast stays up longer so there is time to react. Action toasts are not
  // deduped — repeating one (e.g. several "Undo" prompts) is intentional.
  const toastAction = useCallback((msg, { label, onAction, type = 'dark', duration = 7000 } = {}) => {
    const id = Date.now() + Math.random()
    setToastQueue(q => [...q, { id, msg, type: normalizeToastType(type), duration, action: { label, onAction } }])
  }, [])

  const dismissToast = useCallback(id => {
    setToastQueue(q => q.filter(t => t.id !== id))
  }, [])

  // ── Dialog (replaces alert/confirm) ────────────────────────────────────
  const openDialog = useCallback(({ title, msg, type = 'info', confirmLabel = 'OK', cancelLabel = 'Cancel', showCancel = false }) => {
    return new Promise(resolve => {
      dialogResolveRef.current = resolve
      setDialog({ title, msg, type, confirmLabel, cancelLabel, showCancel })
    })
  }, [])

  const resolveDialog = useCallback(value => {
    setDialog(null)
    if (dialogResolveRef.current) {
      dialogResolveRef.current(value)
      dialogResolveRef.current = null
    }
  }, [])

  // ── Student profile (teacher view) ─────────────────────────────────────
  const openStudentProfile  = useCallback(id => setViewStudentId(id || null), [])
  const closeStudentProfile = useCallback(() => setViewStudentId(null), [])

  // ── Grade edit (per-student, opens alongside Grades tab) ───────────────
  const [editGradesStudentId, setEditGradesStudentId] = useState(null)
  const openEditGradesForStudent = useCallback(id => setEditGradesStudentId(id || null), [])
  const closeEditGrades          = useCallback(() => setEditGradesStudentId(null), [])

  // ── Deep-link a student into a specific message thread (e.g. from a toast) ──
  const [pendingMessageId, setPendingMessageId] = useState(null)
  const openStudentMessageThread = useCallback(id => {
    setPendingMessageId(id || null)
    setStudentTab('messages')
  }, [])
  const clearPendingMessage = useCallback(() => setPendingMessageId(null), [])

  return (
    <UIContext.Provider value={{
      theme, toggleTheme,
      adminTab, setAdminTab,
      studentTab, setStudentTab,
      toastQueue, toast, toastAction, dismissToast,
      dialog, openDialog, resolveDialog,
      isLoading, startLoading, stopLoading,
      viewStudentId, openStudentProfile, closeStudentProfile,
      editGradesStudentId, openEditGradesForStudent, closeEditGrades,
      pendingMessageId, openStudentMessageThread, clearPendingMessage,
    }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
