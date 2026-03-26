import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

const UIContext = createContext(null)

export function UIProvider({ children }) {
  const [theme, setTheme]           = useState('light')
  const [adminTab, setAdminTab]     = useState('dashboard')
  const [studentTab, setStudentTab] = useState('overview')
  const [toastQueue, setToastQueue] = useState([])
  const [dialog, setDialog]         = useState(null) // { title, msg, type, confirmLabel, cancelLabel, showCancel }
  const dialogResolveRef = useRef(null)
  const [isLoading, setIsLoading]   = useState(false)
  const loadingCount = useRef(0)

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
  const toast = useCallback((msg, type = 'dark', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToastQueue(q => [...q, { id, msg, type, duration }])
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

  return (
    <UIContext.Provider value={{
      theme, toggleTheme,
      adminTab, setAdminTab,
      studentTab, setStudentTab,
      toastQueue, toast, dismissToast,
      dialog, openDialog, resolveDialog,
      isLoading, startLoading, stopLoading,
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
