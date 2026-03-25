import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { fbInit, getFbConfigFromEnv } from '@/firebase/firebaseInit'
import { fbStartListening, stopListening } from '@/firebase/listeners'
import { persistStudentsSync, persistClassesSync, persistAdmin, loadAdminFromStorage, fbDeleteStudent } from '@/firebase/persistence'
import { syncSettingsFromFirebase, syncAdminFromFirebase, saveSettingsToFirebase, saveEjsToFirebase } from '@/firebase/settings'
import { loadFbConfigFromStorage, readStoredEJS } from '@/utils/crypto'
import { DEFAULT_EQ_SCALE } from '@/utils/grades'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [students, setStudents]         = useState([])
  const [classes, setClasses]           = useState([])
  const [messages, setMessages]         = useState([])
  const [activities, setActivities]     = useState([])
  const [adminNotifs, setAdminNotifs]   = useState([])
  const [quizzes, setQuizzes]           = useState([])
  const [fbReady, setFbReady]           = useState(false)
  const [fbConfig, setFbConfig]         = useState(null) // decrypted config object
  const dbRef = useRef(null)

  const [ejs, setEjs] = useState({ publicKey: '', serviceId: '', templateId: '', configured: false })
  const [eqScale, setEqScale]           = useState(DEFAULT_EQ_SCALE)
  const [admin, setAdmin]               = useState({ user: 'admin', pass: 'Admin@1234', email: 'admin@school.edu', resetPin: null })

  const _bootstrapping = useRef(false)

  // ── Bootstrap Firebase on mount ─────────────────────────────────────────
  useEffect(() => {
    if (_bootstrapping.current) return
    _bootstrapping.current = true
    _bootstrap()
    return () => stopListening()
  }, [])

  async function _bootstrap() {
    // 0. Load EJS from localStorage cache — independent of Firebase state
    try {
      const raw = localStorage.getItem('cp_ejs')
      const ejsObj = await readStoredEJS(raw)
      if (ejsObj) setEjs({ ...ejsObj, configured: true })
    } catch (e) {}

    // 1. Load Firebase config — env vars take priority, localStorage as fallback
    const cfg = getFbConfigFromEnv() || await loadFbConfigFromStorage()
    if (!cfg) {
      console.log('[DataContext] No Firebase config found — waiting for admin setup.')
      return
    }
    setFbConfig(cfg)

    // 2. Init Firebase SDK
    const db = await fbInit(cfg)
    if (!db) return
    dbRef.current = db
    setFbReady(true)

    // 3. Load admin credentials (localStorage primary, Firebase fallback)
    // localStorage is preferred because saves are written there immediately;
    // the Firebase write is non-blocking and may fail silently.
    const local = await loadAdminFromStorage()
    if (local?.pass) {
      setAdmin(local)
    } else {
      const fbAdmin = await syncAdminFromFirebase(db)
      if (fbAdmin) {
        setAdmin(fbAdmin)
        // Seed localStorage from Firebase so future offline loads work
        await persistAdmin(null, fbAdmin)
      }
    }

    // 4. Load portal settings (equiv scale)
    const settings = await syncSettingsFromFirebase(db)
    if (settings?.equivScale) setEqScale(settings.equivScale)

    // 5. Start real-time listeners
    fbStartListening(db, {
      onStudentsUpdate: setStudents,
      onClassesUpdate:    setClasses,
      onMessagesUpdate:   setMessages,
      onActivitiesUpdate: setActivities,
      onAdminNotifUpdate: setAdminNotifs,
      onQuizzesUpdate:    setQuizzes,
      onConfigUpdate: async ({ ejsConfig }) => {
        if (ejsConfig) {
          setEjs({ ...ejsConfig, configured: true })
          try {
            const { init } = await import('@emailjs/browser')
            init(ejsConfig.publicKey)
          } catch (e) {}
        }
      },
      onSettingsUpdate: data => {
        if (Array.isArray(data?.equivScale) && data.equivScale.length === DEFAULT_EQ_SCALE.length) {
          setEqScale(data.equivScale)
        }
      },
    })

    // Security: remove any plaintext Firebase config from localStorage
    setTimeout(() => { try { localStorage.removeItem('cp_firebase') } catch (e) {} }, 3000)
  }

  // ── Re-initialize Firebase with a new config ───────────────────────────
  const reinitFirebase = useCallback(async (cfg) => {
    stopListening()
    setFbReady(false)
    dbRef.current = null
    setFbConfig(cfg)
    const db = await fbInit(cfg)
    if (!db) return false
    dbRef.current = db
    setFbReady(true)
    fbStartListening(db, {
      onStudentsUpdate: setStudents,
      onClassesUpdate:    setClasses,
      onMessagesUpdate:   setMessages,
      onActivitiesUpdate: setActivities,
      onAdminNotifUpdate: setAdminNotifs,
      onQuizzesUpdate:    setQuizzes,
      onConfigUpdate: async ({ ejsConfig }) => {
        if (ejsConfig) {
          setEjs({ ...ejsConfig, configured: true })
          try {
            const { init } = await import('@emailjs/browser')
            init(ejsConfig.publicKey)
          } catch (e) {}
        }
      },
      onSettingsUpdate: data => {
        if (Array.isArray(data?.equivScale) && data.equivScale.length === DEFAULT_EQ_SCALE.length) {
          setEqScale(data.equivScale)
        }
      },
    })
    return true
  }, [])

  // ── Persistence helpers exposed to components ──────────────────────────
  const saveStudents = useCallback(async (updatedStudents, changedIds) => {
    setStudents(updatedStudents)
    await persistStudentsSync(dbRef.current, updatedStudents, changedIds)
  }, [])

  const saveClasses = useCallback(async (updatedClasses) => {
    setClasses(updatedClasses)
    await persistClassesSync(dbRef.current, updatedClasses)
  }, [])

  const saveAdmin = useCallback(async (updatedAdmin) => {
    setAdmin(updatedAdmin)
    await persistAdmin(dbRef.current, updatedAdmin)
  }, [])

  const deleteStudent = useCallback(async (id) => {
    setStudents(prev => prev.filter(s => s.id !== id))
    await fbDeleteStudent(dbRef.current, id)
  }, [])

  const saveEquivScale = useCallback(async (scale) => {
    setEqScale(scale)
    try { localStorage.setItem('cp_eq_scale', JSON.stringify(scale)) } catch (e) {}
    try { await saveSettingsToFirebase(dbRef.current, scale) } catch (e) {
      console.warn('[DataContext] saveEquivScale Firebase sync failed:', e.message)
    }
  }, [])

  const saveEjs = useCallback(async (ejsConfig) => {
    setEjs({ ...ejsConfig, configured: true })

    // 1. Write localStorage immediately
    try {
      const { encryptEJS } = await import('@/utils/crypto')
      const enc = await encryptEJS(ejsConfig)
      if (enc) localStorage.setItem('cp_ejs', enc)
    } catch (e) {
      console.warn('[DataContext] Failed to cache EJS locally:', e.message)
    }

    // 2. Sync to Firebase in background — non-blocking
    saveEjsToFirebase(dbRef.current, ejsConfig)
      .catch(e => console.warn('[DataContext] saveEjs Firebase sync failed:', e.message))
  }, [])

  return (
    <DataContext.Provider value={{
      students, setStudents, saveStudents, deleteStudent,
      classes, setClasses, saveClasses,
      messages, setMessages,
      activities, setActivities,
      adminNotifs, setAdminNotifs,
      quizzes, setQuizzes,
      fbReady, fbConfig, reinitFirebase,
      db: dbRef,
      ejs, setEjs, saveEjs,
      eqScale, saveEquivScale,
      admin, setAdmin, saveAdmin,
    }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
