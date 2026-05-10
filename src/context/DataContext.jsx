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

    // Auto-sync all active (non-archived) classes: assign current semester label
    // and sync enrollmentOpen with semester status
    const semLabel = sem.label || `${sem.term} AY ${sem.year}`
    const shouldOpen = sem.status === 'active'
    const hasActive = classes.some(c => !c.archived)
    if (hasActive) {
      const updatedClasses = classes.map(c =>
        !c.archived
          ? { ...c, activeSemester: semLabel, enrollmentOpen: shouldOpen }
          : c
      )
      setClasses(updatedClasses)
      await persistClassesSync(dbRef.current, updatedClasses)
    }

    try { await saveSemesterToFirebase(dbRef.current, sem) } catch (e) {
      console.warn('[DataContext] saveSemester Firebase sync failed:', e.message)
      throw e
    }
  }, [classes])

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

      // Strip attendance/excuse for this class from the active profile
      // (already snapshotted above). Grades are retained so students can
      // always view their results even after the class is archived.
      cls.subjects.forEach(sub => {
        delete ns.attendance[sub]
        delete ns.excuse[sub]
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

  // ── Unarchive a class + restore enrolled students' subject data ─────────────
  // Reverses archiveClassWithStudents: finds every student whose archivedSemesters
  // contains an entry for this class, restores their grades/attendance/enrollment,
  // and removes that archive entry (since it is now live again).
  const unarchiveClassWithStudents = useCallback(async (cls) => {
    const studentsToRestore = students.filter(s =>
      s.archivedSemesters?.some(e => e.classId === cls.id)
    )

    const updatedStudents = students.map(s => {
      const entries = (s.archivedSemesters || []).filter(e => e.classId === cls.id)
      if (entries.length === 0) return s

      // Use the most-recently archived entry for this class
      const mostRecent = entries.reduce((a, b) =>
        new Date(a.archivedAt) >= new Date(b.archivedAt) ? a : b
      )

      const ns = {
        ...s,
        grades:          { ...s.grades },
        attendance:      { ...(s.attendance || {}) },
        excuse:          { ...(s.excuse || {}) },
        gradeComponents: { ...(s.gradeComponents || {}) },
      }
      if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }

      // Restore subject data from the archived snapshot
      cls.subjects.forEach(sub => {
        const subData = mostRecent.subjects?.[sub]
        if (!subData) return
        ns.grades[sub] = subData.grade ?? null
        ns.gradeComponents[sub] = subData.gradeComponents ? { ...subData.gradeComponents } : {}
        if (subData.gradeUploadedAt != null) {
          ns.gradeUploadedAt = ns.gradeUploadedAt || {}
          ns.gradeUploadedAt[sub] = subData.gradeUploadedAt
        }
        ns.attendance[sub] = new Set(subData._att || [])
        ns.excuse[sub]     = new Set(subData._exc || [])
      })

      // Re-enroll in the class
      if (!ns.classIds?.includes(cls.id)) {
        ns.classIds = [...(ns.classIds || []), cls.id]
      }
      if (!ns.classId) ns.classId = cls.id

      // Drop the restored archive entry so it is not double-counted in history
      ns.archivedSemesters = (s.archivedSemesters || []).filter(e => e !== mostRecent)

      return ns
    })

    const updatedClasses = classes.map(c =>
      c.id === cls.id ? { ...c, archived: false } : c
    )

    await saveClasses(updatedClasses)
    if (studentsToRestore.length > 0) {
      setStudents(updatedStudents)
      await persistStudentsSync(dbRef.current, updatedStudents, studentsToRestore.map(s => s.id))
    }
  }, [students, classes, saveClasses])

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

  // ── Enrollment helpers ─────────────────────────────────────────────────
  // Enroll a student in a class: validates course match, initialises subject
  // slots, then persists. Throws on validation failure so the caller can show
  // a user-facing error.
  const enrollInClass = useCallback(async (studentId, classId) => {
    const student = students.find(s => s.id === studentId)
    const cls     = classes.find(c => c.id === classId)
    if (!student || !cls) throw new Error('Student or class not found.')
    if (cls.archived) throw new Error('This class is archived and not available for enrollment.')
    if (!cls.enrollmentOpen) throw new Error('Enrollment for this class is currently closed.')

    // Cross-check semester status: block if semester has ended
    if (semester?.status === 'ended') {
      throw new Error('The enrollment period for this semester has ended. Contact your teacher for assistance.')
    }

    const courseReq = (cls.courseReq || cls.name).trim().toLowerCase()
    const studentCourse = (student.course || '').trim().toLowerCase()
    if (studentCourse !== courseReq) {
      throw new Error(`Course mismatch. This class requires "${cls.courseReq || cls.name}" but your enrolled course is "${student.course || 'not set'}".`)
    }

    const currentIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    if (currentIds.includes(classId)) throw new Error('You are already enrolled in this class.')

    // Initialise subject slots for the new class
    const grades          = { ...student.grades }
    const attendance      = { ...student.attendance }
    const excuse          = { ...student.excuse }
    const gradeComponents = { ...(student.gradeComponents || {}) }
    cls.subjects.forEach(sub => {
      if (grades[sub] === undefined)    grades[sub] = null
      if (!attendance[sub])             attendance[sub] = new Set()
      if (!excuse[sub])                 excuse[sub] = new Set()
    })

    const newClassIds = [...currentIds, classId]
    const updatedStudent = {
      ...student,
      classId:  student.classId || classId,
      classIds: newClassIds,
      grades,
      attendance,
      excuse,
      gradeComponents,
    }
    const updatedStudents = students.map(s => s.id === studentId ? updatedStudent : s)
    setStudents(updatedStudents)
    await persistStudentsSync(dbRef.current, updatedStudents, [studentId])
  }, [students, classes, semester])

  // Un-enroll a student from a class. Keeps all grade/attendance data intact
  // (archived-semester pattern is used for permanent removal via archiveClass).
  const unenrollFromClass = useCallback(async (studentId, classId) => {
    const student = students.find(s => s.id === studentId)
    if (!student) throw new Error('Student not found.')

    const currentIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    if (!currentIds.includes(classId)) throw new Error('Not enrolled in this class.')

    const newClassIds = currentIds.filter(id => id !== classId)
    const updatedStudent = {
      ...student,
      classId:  student.classId === classId ? (newClassIds[0] || null) : student.classId,
      classIds: newClassIds,
    }
    const updatedStudents = students.map(s => s.id === studentId ? updatedStudent : s)
    setStudents(updatedStudents)
    await persistStudentsSync(dbRef.current, updatedStudents, [studentId])
  }, [students])

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
      classes, setClasses, saveClasses, setSubjectRep, archiveClassWithStudents, unarchiveClassWithStudents,
      enrollInClass, unenrollFromClass,
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
