import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { fbInit, getFbConfigFromEnv } from '@/firebase/firebaseInit'
import { fbStartListening, stopListening } from '@/firebase/listeners'
import {
  persistStudentsSync, persistClassesSync, persistAdmin, loadAdminFromStorage,
  fbDeleteStudent, fbSaveAnnouncement, fbDeleteAnnouncement, fbPushAnnouncementNotifs,
  fbAddAnnouncementComment, fbAddCommentReply,
  fbSaveMeetLink, fbScheduleMeeting, fbStartMeeting, fbEndMeeting, fbCancelMeeting, fbPushMeetingNotifs,
  fbSetSubjectRep,
} from '@/firebase/persistence'
import { syncSettingsFromFirebase, syncAdminFromFirebase, saveSettingsToFirebase, saveEjsToFirebase, saveSemesterToFirebase } from '@/firebase/settings'
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
  const [announcements, setAnnouncements] = useState([])
  const [meetings, setMeetings]           = useState([])
  const [fbReady, setFbReady]           = useState(false)
  const [fbConfig, setFbConfig]         = useState(null) // decrypted config object
  const [semester, setSemester]         = useState(null)
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

    // 3. Load admin credentials (Firebase primary, localStorage fallback)
    // Firebase is preferred to always pick up credential changes made in the console.
    const fbAdmin = await syncAdminFromFirebase(db)
    if (fbAdmin) {
      setAdmin(fbAdmin)
      await persistAdmin(null, fbAdmin)
    } else {
      const local = await loadAdminFromStorage()
      if (local?.pass) setAdmin(local)
    }

    // 4. Load portal settings (equiv scale, semester)
    const settings = await syncSettingsFromFirebase(db)
    if (settings?.equivScale) setEqScale(settings.equivScale)
    if (settings?.semester) setSemester(settings.semester)

    // 5. Start real-time listeners
    fbStartListening(db, {
      onStudentsUpdate: setStudents,
      onClassesUpdate:    setClasses,
      onMessagesUpdate:   setMessages,
      onActivitiesUpdate: setActivities,
      onAdminNotifUpdate: setAdminNotifs,
      onQuizzesUpdate:    setQuizzes,
      onAnnouncementsUpdate: setAnnouncements,
      onMeetingsUpdate: setMeetings,
      onConfigUpdate: ({ ejsConfig }) => {
        if (ejsConfig) {
          setEjs({ ...ejsConfig, configured: true })
        }
      },
      onSettingsUpdate: data => {
        if (Array.isArray(data?.equivScale) && data.equivScale.length === DEFAULT_EQ_SCALE.length) {
          setEqScale(data.equivScale)
        }
        if (data?.semester) setSemester(data.semester)
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
      onAnnouncementsUpdate: setAnnouncements,
      onMeetingsUpdate: setMeetings,
      onConfigUpdate: ({ ejsConfig }) => {
        if (ejsConfig) {
          setEjs({ ...ejsConfig, configured: true })
        }
      },
      onSettingsUpdate: data => {
        if (Array.isArray(data?.equivScale) && data.equivScale.length === DEFAULT_EQ_SCALE.length) {
          setEqScale(data.equivScale)
        }
        if (data?.semester) setSemester(data.semester)
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

  const setSubjectRep = useCallback(async (classId, subject, studentId) => {
    const updated = classes.map(c => {
      if (c.id !== classId) return c
      return { ...c, reps: { ...(c.reps || {}), [subject]: studentId ?? null } }
    })
    setClasses(updated) // always update local state immediately
    await fbSetSubjectRep(dbRef.current, updated)
  }, [classes])

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

  const saveSemester = useCallback(async (sem) => {
    setSemester(sem)
    try { await saveSemesterToFirebase(dbRef.current, sem) } catch (e) {
      console.warn('[DataContext] saveSemester Firebase sync failed:', e.message)
      throw e
    }
  }, [])

  // ── Archive a class + auto-archive enrolled students' subject data ──────────
  // When called, each enrolled student's subject records for this class are
  // snapshotted into archivedSemesters[], then cleared from their active data,
  // and the class is removed from their classIds. Teacher re-enrolls manually.
  const archiveClassWithStudents = useCallback(async (cls) => {
    const semLabel = semester
      ? (semester.label || `${semester.term} AY ${semester.year}`)
      : 'Unknown Semester'

    const enrolled = students.filter(s =>
      s.classId === cls.id || s.classIds?.includes(cls.id)
    )

    const updatedStudents = students.map(s => {
      if (s.classId !== cls.id && !s.classIds?.includes(cls.id)) return s

      // Snapshot current subject data, serializing Sets → arrays for Firestore
      const subjectArchive = {}
      cls.subjects.forEach(sub => {
        subjectArchive[sub] = {
          grade: s.grades?.[sub] ?? null,
          gradeComponents: s.gradeComponents?.[sub] ? { ...s.gradeComponents[sub] } : {},
          gradeUploadedAt: s.gradeUploadedAt?.[sub] ?? null,
          _att: s.attendance?.[sub] ? [...s.attendance[sub]] : [],
          _exc: s.excuse?.[sub] ? [...s.excuse[sub]] : [],
        }
      })

      const archiveEntry = {
        semester: semLabel,
        classId: cls.id,
        className: cls.name,
        section: cls.section,
        archivedAt: new Date().toISOString(),
        subjects: subjectArchive,
      }

      const ns = {
        ...s,
        archivedSemesters: [...(s.archivedSemesters || []), archiveEntry],
        grades:         { ...s.grades },
        attendance:     { ...s.attendance },
        excuse:         { ...s.excuse },
        gradeComponents: { ...(s.gradeComponents || {}) },
      }
      if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }

      // Strip active subject data for this class
      cls.subjects.forEach(sub => {
        delete ns.grades[sub]
        delete ns.attendance[sub]
        delete ns.excuse[sub]
        delete ns.gradeComponents[sub]
        if (ns.gradeUploadedAt) delete ns.gradeUploadedAt[sub]
      })

      // Un-enroll from this class
      ns.classIds = (s.classIds || []).filter(id => id !== cls.id)
      if (ns.classId === cls.id) ns.classId = ns.classIds[0] || null

      return ns
    })

    const updatedClasses = classes.map(c =>
      c.id === cls.id ? { ...c, archived: true } : c
    )

    await saveClasses(updatedClasses)
    if (enrolled.length) {
      setStudents(updatedStudents)
      await persistStudentsSync(dbRef.current, updatedStudents, enrolled.map(s => s.id))
    }
  }, [students, classes, semester, saveClasses])

  const saveAnnouncement = useCallback(async (announcement) => {
    setAnnouncements(prev => {
      const idx = prev.findIndex(a => a.id === announcement.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = announcement
        return next
      }
      return [announcement, ...prev]
    })
    await fbSaveAnnouncement(dbRef.current, announcement)
  }, [])

  const deleteAnnouncement = useCallback(async (id) => {
    setAnnouncements(prev => prev.filter(a => a.id !== id))
    await fbDeleteAnnouncement(dbRef.current, id)
  }, [])

  const saveMeetLink = useCallback(async (classId, meetLink) => {
    setClasses(prev => prev.map(c => c.id === classId ? { ...c, meetLink } : c))
    await fbSaveMeetLink(dbRef.current, classId, meetLink)
  }, [])

  const scheduleMeeting = useCallback(async (meetingData) => {
    const meeting = await fbScheduleMeeting(dbRef.current, meetingData)
    if (meeting) {
      setMeetings(prev => [meeting, ...prev])
      await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_scheduled')
    }
  }, [students])

  const startMeeting = useCallback(async (meeting) => {
    await fbStartMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_live')
  }, [students])

  const endMeeting = useCallback(async (meeting) => {
    await fbEndMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_ended')
  }, [students])

  const cancelMeeting = useCallback(async (meeting) => {
    await fbCancelMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_cancelled')
  }, [students])

  const pushAnnouncementNotifs = useCallback(async (announcement) => {
    await fbPushAnnouncementNotifs(dbRef.current, announcement, students)
  }, [students])

  const addAnnouncementComment = useCallback(async (announcementId, comment) => {
    setAnnouncements(prev => prev.map(a =>
      a.id === announcementId
        ? { ...a, comments: [...(a.comments || []), comment] }
        : a
    ))
    await fbAddAnnouncementComment(dbRef.current, announcementId, comment)
  }, [])

  const addCommentReply = useCallback(async (announcementId, commentId, reply) => {
    setAnnouncements(prev => prev.map(a =>
      a.id === announcementId
        ? {
            ...a,
            comments: (a.comments || []).map(c =>
              c.id === commentId
                ? { ...c, replies: [...(c.replies || []), reply] }
                : c
            ),
          }
        : a
    ))
    await fbAddCommentReply(dbRef.current, announcementId, commentId, reply)
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
      classes, setClasses, saveClasses, setSubjectRep, archiveClassWithStudents,
      messages, setMessages,
      activities, setActivities,
      adminNotifs, setAdminNotifs,
      quizzes, setQuizzes,
      announcements, setAnnouncements, saveAnnouncement, deleteAnnouncement, pushAnnouncementNotifs, addAnnouncementComment, addCommentReply,
      meetings, setMeetings,
      liveMeetings: meetings.filter(m => m.status === 'live'),
      saveMeetLink, scheduleMeeting, startMeeting, endMeeting, cancelMeeting,
      fbReady, fbConfig, reinitFirebase,
      db: dbRef,
      ejs, setEjs, saveEjs,
      eqScale, saveEquivScale,
      semester, saveSemester,
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
