import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

const UIContext = createContext(null)

// Map the semantic type names used across the app (success/error/warn/info) onto
// the six colour variants the toast renderer actually styles. Without this every
// success/error toast silently fell through to the default "dark" variant - which
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
  // Selected tab persists across refresh (no URL to encode it in). Restored from
  // localStorage on mount, re-saved on every change below.
  const [adminTab, setAdminTab]     = useState(() => { try { return localStorage.getItem('acadflow_admin_tab') || 'dashboard' } catch { return 'dashboard' } })
  const [studentTab, setStudentTab] = useState(() => { try { return localStorage.getItem('acadflow_student_tab') || 'overview' } catch { return 'overview' } })
  const [toastQueue, setToastQueue] = useState([])
  const [dialog, setDialog]         = useState(null) // { title, msg, type, confirmLabel, cancelLabel, showCancel }
  const dialogResolveRef = useRef(null)
  const [isLoading, setIsLoading]   = useState(false)
  const loadingCount = useRef(0)
  // Globally-shared "view student profile" target - any professor-side button can
  // open the same profile modal by id, keeping every entry point in sync.
  const [viewStudentId, setViewStudentId] = useState(null)

  // Persist the selected tab so a browser refresh returns to the same panel.
  useEffect(() => { try { localStorage.setItem('acadflow_admin_tab', adminTab) } catch (e) {} }, [adminTab])
  useEffect(() => { try { localStorage.setItem('acadflow_student_tab', studentTab) } catch (e) {} }, [studentTab])

  // ── Generic redirect-and-highlight deep link ──────────────────────────────
  // Centralizes "switch to the right tab AND glow the exact record" for every
  // module (the Stream announcement glow is the older, class-scoped special
  // case). A destination list calls useRedirectHighlight(type) to consume this.
  const [pendingHighlight, setPendingHighlight] = useState(null) // { type, id, ts }
  const clearHighlight = useCallback(() => setPendingHighlight(null), [])
  const navigateToTarget = useCallback((target) => {
    if (!target || !target.tab) return
    if (target.side === 'admin') setAdminTab(target.tab)
    else setStudentTab(target.tab)
    if (target.classId != null) setPendingStreamClassId(target.classId)
    if (target.type && target.id != null) {
      setPendingHighlight({ type: target.type, id: String(target.id), ts: Date.now() })
    }
  }, [])

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
  // fires twice in several situations - React StrictMode double-invoking an
  // effect, a Firestore onSnapshot echo re-running a notification effect, or a
  // handler bound twice - and the user sees every message appear doubled. We
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
  // deduped - repeating one (e.g. several "Undo" prompts) is intentional.
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

  // ── Student profile (professor view) ─────────────────────────────────────
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

  // ── Deep-link a student into a specific Stream announcement (e.g. from the
  // saved-announcements widget on the dashboard) so it scrolls into view and
  // glows briefly. ──
  // The Stream feed is scoped to one class at a time, so the deep-link also
  // carries the class to switch to (the student's matching class for the post),
  // otherwise a saved post from a non-active class can't be found.
  const [pendingStreamAnnId, setPendingStreamAnnId] = useState(null)
  const [pendingStreamClassId, setPendingStreamClassId] = useState(null)
  const openStreamAnnouncement = useCallback((id, classId = null) => {
    setPendingStreamAnnId(id || null)
    setPendingStreamClassId(classId || null)
    setStudentTab('stream')
  }, [])
  const clearPendingStreamAnn = useCallback(() => setPendingStreamAnnId(null), [])
  const clearPendingStreamClass = useCallback(() => setPendingStreamClassId(null), [])

  // Open the Stream post referenced by a shared message preview (PostRefCard).
  // Announcements deep-link into the Stream (scroll + glow); the other feed
  // types (activity/quiz/grade/attendance) live on their own student tab, so we
  // route there instead of hunting for a non-existent announcement.
  const STREAM_POST_TAB = { activity: 'activities', quiz: 'quizzes', grade: 'grades', attendance: 'attendance' }
  const openStreamPost = useCallback((postRef) => {
    if (!postRef) return
    const tab = STREAM_POST_TAB[postRef.type]
    if (tab) {
      // Activity/quiz posts deep-link to (and glow) the exact record.
      const ht = (postRef.type === 'activity' || postRef.type === 'quiz') ? postRef.type : undefined
      navigateToTarget({ side: 'student', tab, type: ht, id: postRef.id })
      return
    }
    setPendingStreamAnnId(postRef.id || null)
    setPendingStreamClassId(postRef.classId || null)
    setStudentTab('stream')
  }, [navigateToTarget])

  // ── "Ask the professor about this post": open the student's direct thread with
  // the professor, pre-filling a draft AND attaching a preview of the post so the
  // professor sees (and can open) exactly which post it's about. Accepts either a
  // postRef object { id, type, title, classLabel, classId, thumb } or a bare
  // title string (back-compat). ──
  const [pendingMessageDraft, setPendingMessageDraft] = useState(null)
  const [pendingMessagePostRef, setPendingMessagePostRef] = useState(null)
  const messageProfessorAboutPost = useCallback((post) => {
    const ref = (post && typeof post === 'object') ? post : null
    const title = ref ? ref.title : (post || '')
    setPendingMessageDraft(title ? `Re: ${title}\n` : 'About this post:\n')
    setPendingMessagePostRef(ref)
    setStudentTab('messages')
  }, [])
  const clearPendingMessageDraft = useCallback(() => { setPendingMessageDraft(null); setPendingMessagePostRef(null) }, [])

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
      pendingStreamAnnId, openStreamAnnouncement, clearPendingStreamAnn,
      pendingStreamClassId, clearPendingStreamClass, openStreamPost,
      pendingMessageDraft, pendingMessagePostRef, messageProfessorAboutPost, clearPendingMessageDraft,
      pendingHighlight, navigateToTarget, clearHighlight,
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
