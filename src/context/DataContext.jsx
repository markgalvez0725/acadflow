import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { fbInit, getFbConfigFromEnv, getFbAuth } from '@/firebase/firebaseInit'
import { fbStartListening, stopListening } from '@/firebase/listeners'
import {
  persistStudentsSync, persistClassesSync, persistAdmin, loadAdminFromStorage,
  fbDeleteStudent, fbSaveAnnouncement, fbDeleteAnnouncement, fbPushAnnouncementNotifs,
  fbAddAnnouncementComment, fbAddCommentReply,
  fbSaveResource, fbDeleteResource, fbSaveRubricLibrary,
  fbSaveMeetLink, fbScheduleMeeting, fbStartMeeting, fbEndMeeting, fbCancelMeeting, fbPushMeetingNotifs,
  fbSetSubjectRep, fbDeleteClassRelatedData, fbAddAuditLog, fbRestoreFromBackup,
  fbSubmitStudentFeedback, fbUpdateFeedbackStatus,
} from '@/firebase/persistence'
import { serializeStudents } from '@/utils/attendance'
import { syncSettingsFromFirebase, syncAdminFromFirebase, saveSettingsToFirebase, saveEjsToFirebase, saveSemesterToFirebase, saveLatePolicyToFirebase, saveGradeFloorToFirebase } from '@/firebase/settings'
import { DEFAULT_LATE_POLICY, normalizeLatePolicy } from '@/utils/latePenalty'
import { sendPushToOwners } from '@/firebase/pushTokens'
import {
  fbOpenAttendanceSession, fbCloseAttendanceSession, fbMarkCheckedIn,
  fbSubmitExcuseRequest, fbDecideExcuseRequest, fbNotifyAdmin, fbNotifyStudent,
} from '@/firebase/attendanceExtras'
import { loadFbConfigFromStorage, readStoredEJS } from '@/utils/crypto'
import { DEFAULT_EQ_SCALE } from '@/utils/grades'
import { computeSubjectGrade, gradeInputHash } from '@/utils/gradeEngine'
import { ADMIN_EMAIL } from '@/constants/auth'

// The audit log is teacher-only (its Firestore rule denies students). Only
// attach its listener for the admin so student sessions don't trip a
// "Missing or insufficient permissions" error on a collection they never read.
function isAdminUser() {
  try {
    const email = getFbAuth()?.currentUser?.email || ''
    return !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  } catch { return false }
}

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
  const [attendanceSessions, setAttendanceSessions] = useState([])
  const [excuseRequests, setExcuseRequests]         = useState([])
  const [studentFeedback, setStudentFeedback]       = useState([])
  const [auditLog, setAuditLog]                     = useState([])
  const [resources, setResources]                   = useState([])
  const [rubricLibrary, setRubricLibrary]           = useState([])
  const [fbReady, setFbReady]           = useState(false)
  const [fbConfig, setFbConfig]         = useState(null) // decrypted config object
  const [semester, setSemester]         = useState(null)
  const dbRef = useRef(null)

  const [ejs, setEjs] = useState({ publicKey: '', serviceId: '', templateId: '', configured: false })
  const [eqScale, setEqScale]           = useState(DEFAULT_EQ_SCALE)
  const [latePolicy, setLatePolicy]     = useState(DEFAULT_LATE_POLICY)
  // Minimum-component-grade floor (0 = off). Applies to activities & quizzes.
  const [gradeFloor, setGradeFloor]     = useState(0)
  const [admin, setAdmin]               = useState({ user: 'admin', pass: 'Admin@1234', email: 'admin@school.edu', resetPin: null })

  const _bootstrapping = useRef(false)
  const _authUnsubRef  = useRef(null)

  // ── Bootstrap Firebase on mount ─────────────────────────────────────────
  useEffect(() => {
    if (_bootstrapping.current) return
    _bootstrapping.current = true
    _bootstrap()
    return () => { stopListening(); if (_authUnsubRef.current) _authUnsubRef.current() }
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

    // Load admin info, settings, and start real-time listeners. All Firestore
    // reads happen here so they can be gated behind authentication below.
    const loadData = async () => {
      // Admin record (display only — login itself is via Firebase Auth).
      try {
        const fbAdmin = await syncAdminFromFirebase(db)
        if (fbAdmin) { setAdmin(fbAdmin); await persistAdmin(null, fbAdmin) }
        else { const local = await loadAdminFromStorage(); if (local?.pass) setAdmin(local) }
      } catch (e) {}

      // Portal settings (equiv scale, semester).
      try {
        const settings = await syncSettingsFromFirebase(db)
        if (settings?.equivScale) setEqScale(settings.equivScale)
        if (settings?.semester) setSemester(settings.semester)
        if (settings?.latePolicy) setLatePolicy(normalizeLatePolicy(settings.latePolicy))
        if (typeof settings?.gradeFloor === 'number') setGradeFloor(settings.gradeFloor)
      } catch (e) {}

      // Real-time listeners.
      fbStartListening(db, {
        onStudentsUpdate: setStudents,
        onClassesUpdate:    setClasses,
        onMessagesUpdate:   setMessages,
        onActivitiesUpdate: setActivities,
        onAdminNotifUpdate: setAdminNotifs,
        onQuizzesUpdate:    setQuizzes,
        onAnnouncementsUpdate: setAnnouncements,
        onMeetingsUpdate: setMeetings,
        onAttendanceSessionsUpdate: setAttendanceSessions,
        onExcuseRequestsUpdate: setExcuseRequests,
        onStudentFeedbackUpdate: setStudentFeedback,
        onAuditLogUpdate: isAdminUser() ? setAuditLog : undefined,
        onResourcesUpdate: setResources,
        onRubricLibraryUpdate: setRubricLibrary,
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
          if (data?.latePolicy) setLatePolicy(normalizeLatePolicy(data.latePolicy))
          if (typeof data?.gradeFloor === 'number') setGradeFloor(data.gradeFloor)
        },
      })
    }

    // Gate all data loading behind sign-in so locked Firestore rules
    // (require auth) don't reject reads. Runs on sign-in; stops on sign-out.
    const auth = getFbAuth()
    if (!auth) {
      await loadData()
    } else {
      let started = false
      _authUnsubRef.current = onAuthStateChanged(auth, (user) => {
        if (user && !started) { started = true; loadData() }
        else if (!user && started) { started = false; stopListening() }
      })
    }

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
      onAttendanceSessionsUpdate: setAttendanceSessions,
      onExcuseRequestsUpdate: setExcuseRequests,
      onAuditLogUpdate: isAdminUser() ? setAuditLog : undefined,
      onResourcesUpdate: setResources,
      onRubricLibraryUpdate: setRubricLibrary,
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
        if (data?.latePolicy) setLatePolicy(normalizeLatePolicy(data.latePolicy))
        if (typeof data?.gradeFloor === 'number') setGradeFloor(data.gradeFloor)
      },
    })
    return true
  }, [])

  // ── Persistence helpers exposed to components ──────────────────────────
  const saveStudents = useCallback(async (updatedStudents, changedIds) => {
    setStudents(updatedStudents)
    await persistStudentsSync(dbRef.current, updatedStudents, changedIds)
  }, [])

  // Promote a student's account to "Active": they've taken ownership by setting
  // their own password. Self-registration writes this inline; this covers the
  // admin-provisioned temp-password path (first forced/voluntary change).
  // Idempotent — no write if already active.
  const markAccountActive = useCallback(async (studentId) => {
    let changed = false
    const updated = students.map(s => {
      if (s.id !== studentId) return s
      const a = s.account || {}
      if (a.activated && !a._tempPass) return s
      changed = true
      return { ...s, account: { ...a, registered: true, activated: true, _tempPass: false } }
    })
    if (changed) await saveStudents(updated, [studentId])
  }, [students, saveStudents])

  // Append an entry to the admin audit log. Fire-and-forget — callers should
  // not await this in a way that blocks the primary action.
  const logAudit = useCallback((entry) => {
    if (!dbRef.current) return
    const actor = entry?.actor || admin?.email || 'admin'
    return fbAddAuditLog(dbRef.current, { ...entry, actor })
  }, [admin])

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
    let removed = null
    setStudents(prev => {
      removed = prev.find(s => s.id === id) || null
      return prev.filter(s => s.id !== id)
    })
    await fbDeleteStudent(dbRef.current, id)
    logAudit({
      action: 'student.delete',
      target: removed?.name || id,
      summary: `Deleted student "${removed?.name || id}"${removed?.snum ? ' (' + removed.snum + ')' : ''}`,
      meta: { studentId: id },
    })
    return removed
  }, [logAudit])

  // Undo support: re-create previously deleted student record(s). The caller
  // keeps the full in-memory student object(s) (with attendance/excuse Sets),
  // so restoring is just re-adding and re-persisting them by id.
  const restoreStudents = useCallback(async (list) => {
    const arr = (Array.isArray(list) ? list : [list]).filter(Boolean)
    if (!arr.length) return
    let merged = null
    setStudents(prev => {
      const have = new Set(prev.map(s => s.id))
      merged = [...prev, ...arr.filter(s => !have.has(s.id))]
      return merged
    })
    await persistStudentsSync(dbRef.current, merged, arr.map(s => s.id))
    logAudit({
      action: 'student.restore',
      target: arr.length === 1 ? (arr[0].name || arr[0].id) : `${arr.length} students`,
      summary: `Restored ${arr.length} deleted student${arr.length === 1 ? '' : 's'} via undo`,
      meta: { studentIds: arr.map(s => s.id) },
    })
  }, [logAudit])

  const saveEquivScale = useCallback(async (scale) => {
    setEqScale(scale)
    try { localStorage.setItem('cp_eq_scale', JSON.stringify(scale)) } catch (e) {}
    try { await saveSettingsToFirebase(dbRef.current, scale) } catch (e) {
      console.warn('[DataContext] saveEquivScale Firebase sync failed:', e.message)
    }
  }, [])

  // ── Full data backup / restore ─────────────────────────────────────────
  // Serializes the current in-memory data (students with Sets converted to
  // arrays) into a portable JSON object. Credentials and Firebase/EmailJS
  // config are intentionally excluded — this is academic data, not secrets.
  const buildBackup = useCallback(() => ({
    app: 'acadflow',
    version: 1,
    exportedAt: Date.now(),
    counts: {
      students: students.length, classes: classes.length, messages: messages.length,
      activities: activities.length, quizzes: quizzes.length, announcements: announcements.length,
      meetings: meetings.length, attendanceSessions: attendanceSessions.length, excuseRequests: excuseRequests.length,
    },
    data: {
      students: serializeStudents(students),
      classes,
      messages,
      activities,
      quizzes,
      announcements,
      meetings,
      attendanceSessions,
      excuseRequests,
      adminNotifs,   // included for record; not written back on restore
      auditLog,      // included for record; not written back on restore
      settings: { equivScale: eqScale, semester, latePolicy, gradeFloor },
    },
  }), [students, classes, messages, activities, quizzes, announcements, meetings, attendanceSessions, excuseRequests, adminNotifs, auditLog, eqScale, semester, latePolicy, gradeFloor])

  const restoreBackup = useCallback(async (backup, onProgress) => {
    await fbRestoreFromBackup(dbRef.current, backup, onProgress)
    logAudit({
      action: 'data.restore',
      target: 'Full backup',
      summary: `Restored data from backup${backup?.exportedAt ? ' dated ' + new Date(backup.exportedAt).toLocaleString('en-PH') : ''}`,
      meta: { counts: backup?.counts || null },
    })
  }, [logAudit])

  const saveLatePolicy = useCallback(async (policy) => {
    const norm = normalizeLatePolicy(policy)
    setLatePolicy(norm)
    try { await saveLatePolicyToFirebase(dbRef.current, norm) } catch (e) {
      console.warn('[DataContext] saveLatePolicy Firebase sync failed:', e.message)
      throw e
    }
  }, [])

  // Minimum component grade (floor) for activities & quizzes. 0 disables it.
  const saveGradeFloor = useCallback(async (v) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
    setGradeFloor(n)
    try { await saveGradeFloorToFirebase(dbRef.current, n) } catch (e) {
      console.warn('[DataContext] saveGradeFloor Firebase sync failed:', e.message)
      throw e
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

  // ── Permanently delete a class and all its related data ─────────────────
  // Removes: the class record, all enrolled students' subject data (grades,
  // attendance, gradeComponents, gradeUploadedAt), activities, announcements,
  // online meetings, and quizzes that belong to this class from Firestore.
  const deleteClass = useCallback(async (cls) => {
    const updatedClasses = classes.filter(c => c.id !== cls.id)

    const enrolled = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id))
    const updatedStudents = students.map(s => {
      if (s.classId !== cls.id && !s.classIds?.includes(cls.id)) return s

      const ns = {
        ...s,
        grades:          { ...s.grades },
        attendance:      { ...(s.attendance || {}) },
        excuse:          { ...(s.excuse || {}) },
        gradeComponents: { ...(s.gradeComponents || {}) },
      }
      if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }

      // Strip all subject data belonging to this class
      cls.subjects?.forEach(sub => {
        delete ns.grades[sub]
        delete ns.attendance[sub]
        delete ns.excuse[sub]
        delete ns.gradeComponents[sub]
        if (ns.gradeUploadedAt) delete ns.gradeUploadedAt[sub]
      })

      // Unenroll
      ns.classIds = (s.classIds || []).filter(id => id !== cls.id)
      if (ns.classId === cls.id) ns.classId = ns.classIds[0] || null

      return ns
    })

    // Update local state immediately
    setActivities(prev => prev.filter(a => a.classId !== cls.id))
    setAnnouncements(prev => prev.filter(a => a.classId !== cls.id))
    setMeetings(prev => prev.filter(m => m.classId !== cls.id))
    setQuizzes(prev => prev.filter(q => !q.classIds?.includes(cls.id)))

    await saveClasses(updatedClasses)
    if (enrolled.length) {
      await saveStudents(updatedStudents, enrolled.map(s => s.id))
    }

    // Delete related Firestore documents (activities, announcements, meetings, quizzes)
    // Wrapped in try/catch — if Firestore security rules block the batch delete,
    // the class is still fully removed from the app; orphaned docs are harmless.
    try {
      await fbDeleteClassRelatedData(dbRef.current, cls.id)
    } catch (e) {
      console.warn('[DataContext] deleteClass: related data cleanup failed (may be a Firestore rules issue):', e.message)
    }

    logAudit({
      action: 'class.delete',
      target: `${cls.name || cls.id}${cls.section ? ' · ' + cls.section : ''}`,
      summary: `Deleted class "${cls.name || cls.id}" (${enrolled.length} student${enrolled.length === 1 ? '' : 's'} affected)`,
      meta: { classId: cls.id, students: enrolled.length },
    })
  }, [students, classes, saveClasses, saveStudents, logAudit])

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

  // ── Resource Hub (per class + subject learning materials) ──────────────
  const saveResource = useCallback(async (resource) => {
    setResources(prev => {
      const idx = prev.findIndex(r => r.id === resource.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = resource; return next }
      return [resource, ...prev]
    })
    await fbSaveResource(dbRef.current, resource)
  }, [])

  const deleteResource = useCallback(async (id) => {
    setResources(prev => prev.filter(r => r.id !== id))
    await fbDeleteResource(dbRef.current, id)
  }, [])

  // ── Rubric library (reusable grading rubrics — singleton portal doc) ────
  // Read-modify-write the whole list; optimistic local update + Firebase sync.
  const saveRubricToLibrary = useCallback(async (entry) => {
    let next
    setRubricLibrary(prev => {
      const idx = prev.findIndex(r => r.id === entry.id)
      next = idx >= 0 ? prev.map((r, i) => i === idx ? entry : r) : [entry, ...prev]
      return next
    })
    await fbSaveRubricLibrary(dbRef.current, next)
  }, [])

  const deleteLibraryRubric = useCallback(async (id) => {
    let next
    setRubricLibrary(prev => { next = prev.filter(r => r.id !== id); return next })
    await fbSaveRubricLibrary(dbRef.current, next)
  }, [])

  // ── Purge a deleted quiz's cached records from students ──────────────────
  // A quiz score is denormalized onto each student (quizResults[subject][] for
  // display + gradeComponents[subject].quizScores[quizId] for the gradebook).
  // Deleting the quiz doc leaves those stale, so the student still sees the
  // grade — clear them here. Recomputed term grades refresh next time the
  // teacher opens/saves the grade sheet.
  const purgeQuizFromStudents = useCallback(async (quiz) => {
    const quizId = quiz?.id
    if (!quizId) return
    const changed = []
    const updated = students.map(s => {
      let touched = false
      // 1. quizResults — remove the entry for this quiz (search every subject).
      const qr = s.quizResults || {}
      const nextQr = {}
      for (const sub of Object.keys(qr)) {
        const list = qr[sub]
        if (Array.isArray(list) && list.some(e => e?.quizId === quizId)) {
          nextQr[sub] = list.filter(e => e?.quizId !== quizId)
          touched = true
        } else {
          nextQr[sub] = list
        }
      }
      // 2. gradeComponents[subject].quizScores[quizId] — drop the keyed score.
      let nextGc = s.gradeComponents
      const sub = quiz.subject
      if (sub && s.gradeComponents?.[sub]?.quizScores && quizId in s.gradeComponents[sub].quizScores) {
        const qs = { ...s.gradeComponents[sub].quizScores }
        delete qs[quizId]
        nextGc = { ...s.gradeComponents, [sub]: { ...s.gradeComponents[sub], quizScores: qs } }
        touched = true
      }
      if (!touched) return s
      changed.push(s.id)
      return { ...s, quizResults: nextQr, gradeComponents: nextGc }
    })
    if (changed.length) await saveStudents(updated, changed)
  }, [students, saveStudents])

  // ── Verified Grading: recompute & sync drifted grades ────────────────────
  // Re-run the GradeEngine live for the given student×subject pairs and write
  // the fresh components + term grades + final, plus a signed snapshot (hash of
  // the inputs) so the published grade provably matches the current data again.
  // Admin-only write path (the Firestore rule blocks students from touching
  // grade fields). `pairs`: [{ studentId, subject }].
  const syncDriftedGrades = useCallback(async (pairs) => {
    if (!pairs?.length) return 0
    let updated = students
    const changed = new Set()
    const now = Date.now()
    for (const { studentId, subject } of pairs) {
      const s = updated.find(x => x.id === studentId)
      if (!s) continue
      const live = computeSubjectGrade(
        s, subject,
        { activities, quizzes, students: updated, classes, eqScale, floor: gradeFloor },
        { mode: 'live' }
      )
      if (live.final == null && live.midterm == null && live.finals == null) continue
      const prev = s.gradeComponents?.[subject] || {}
      const comp = {
        ...prev,
        activities: live.components.activities,
        quizzes:    live.components.quizzes,
        attendance: live.components.attendance,
        midterm:    live.midterm,
        finals:     live.finals,
      }
      const snapshot = {
        final: live.final, midterm: live.midterm, finals: live.finals,
        components: live.components, hash: gradeInputHash(live), at: now,
      }
      updated = updated.map(x => x.id === studentId ? {
        ...x,
        gradeComponents: { ...(x.gradeComponents || {}), [subject]: comp },
        grades:          { ...(x.grades || {}), [subject]: live.final },
        gradeSnapshots:  { ...(x.gradeSnapshots || {}), [subject]: snapshot },
      } : x)
      changed.add(studentId)
    }
    if (changed.size) await saveStudents(updated, [...changed])
    return changed.size
  }, [students, activities, quizzes, classes, eqScale, gradeFloor, saveStudents])

  // Save a Meet link for a class. When `subject` is given, the link is stored
  // per-subject in meetLinks[subject]; otherwise it sets the class-wide link.
  const saveMeetLink = useCallback(async (classId, meetLink, subject) => {
    const updated = classes.map(c => {
      if (c.id !== classId) return c
      return subject
        ? { ...c, meetLinks: { ...(c.meetLinks || {}), [subject]: meetLink } }
        : { ...c, meetLink }
    })
    setClasses(updated)
    if (subject) await persistClassesSync(dbRef.current, updated)
    else await fbSaveMeetLink(dbRef.current, classId, meetLink)
  }, [classes])

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

  // One-click "Go Live": create a meeting and bring it live immediately, so
  // enrolled students instantly see the Join button + a "live now" notice.
  // Returns the live meeting (with its Meet link) for the caller to open.
  const startInstantMeeting = useCallback(async (meetingData) => {
    // Never spin up a second live session for a class+subject that is already
    // live — reuse the existing one. This stops the duplicate-session bug at the
    // source (the UI already hides "Go Live" when one is live, but a stale render
    // could slip a second click through).
    const already = meetings.find(m => m.status === 'live'
      && m.classId === meetingData.classId
      && (m.subject || null) === (meetingData.subject || null))
    if (already) return already
    const meeting = await fbScheduleMeeting(dbRef.current, { ...meetingData, scheduledAt: Date.now() })
    if (!meeting) return null
    await fbStartMeeting(dbRef.current, meeting.id)
    const live = { ...meeting, status: 'live' }
    setMeetings(prev => [live, ...prev])
    await fbPushMeetingNotifs(dbRef.current, live, students, 'meeting_live')
    return live
  }, [students, meetings])

  const endMeeting = useCallback(async (meeting) => {
    // End every live session for this class+subject, not just the clicked one, so
    // any duplicate live docs are cleaned up together (students stop seeing Join).
    const liveSiblings = meetings.filter(m => m.status === 'live'
      && m.classId === meeting.classId
      && (m.subject || null) === (meeting.subject || null))
    const targets = liveSiblings.length ? liveSiblings : [meeting]
    for (const m of targets) await fbEndMeeting(dbRef.current, m.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_ended')
  }, [students, meetings])

  const cancelMeeting = useCallback(async (meeting) => {
    await fbCancelMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_cancelled')
  }, [students])

  const pushAnnouncementNotifs = useCallback(async (announcement) => {
    await fbPushAnnouncementNotifs(dbRef.current, announcement, students)
    // Best-effort web push (in addition to the existing in-app notification).
    const targetOwners = announcement?.classId && announcement.classId !== 'all'
      ? students.filter(s => s.classId === announcement.classId || s.classIds?.includes(announcement.classId)).map(s => s.id)
      : 'all'
    sendPushToOwners(dbRef.current, targetOwners, {
      title: announcement?.title || 'New announcement',
      body: 'Open AcadFlow to view the announcement.',
    }, { url: '/', tag: 'announcement' })
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

    // ── Identity verification: course + year level + section must all match ──
    const norm        = v => (v == null ? '' : String(v)).trim().toLowerCase()
    const normSection = v => norm(v).replace(/[\s\-_]/g, '')           // "2 - A" → "2a"
    const yearDigit   = v => { const m = String(v ?? '').match(/(\d)/); return m ? m[1] : null }

    // Course
    const courseReq     = norm(cls.courseReq || cls.name)
    const studentCourse = norm(student.course)
    if (courseReq && studentCourse !== courseReq) {
      throw new Error(`Course mismatch. This subject is for "${cls.courseReq || cls.name}", but your course is "${student.course || 'not set'}". You can only enroll in subjects offered to your own course.`)
    }

    // Year level (digit from class.year or section vs student's year)
    const clsYear = yearDigit(cls.year) || yearDigit(cls.section)
    const stuYear = yearDigit(student.year)
    if (clsYear && stuYear && clsYear !== stuYear) {
      throw new Error(`Year level mismatch. This subject is for year ${clsYear}, but you are in year ${stuYear}. You can only enroll in subjects for your own year level.`)
    }

    // Section (exact match). Student section = explicit field, else their primary class's section.
    const primaryCls = classes.find(c => c.id === (student.classId || student.classIds?.[0]))
    const studentSection = student.section || primaryCls?.section || ''
    if (cls.section) {
      if (!studentSection) {
        throw new Error('Your section is not set yet. Please ask your teacher to set your section before enrolling.')
      }
      if (normSection(studentSection) !== normSection(cls.section)) {
        throw new Error(`Section mismatch. This subject is for section "${cls.section}", but you belong to section "${studentSection}". You can only enroll in subjects for your own section.`)
      }
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

  // ── Attendance check-in + excuse requests ──────────────────────────────
  const openCheckIn = useCallback(async ({ classId, subject }) => {
    const session = await fbOpenAttendanceSession(dbRef.current, { classId, subject })
    setAttendanceSessions(prev => [session, ...prev.filter(s => s.id !== session.id)])
    return session
  }, [])

  const closeCheckIn = useCallback(async (session) => {
    await fbCloseAttendanceSession(dbRef.current, session.id)
    setAttendanceSessions(prev => prev.map(s => s.id === session.id ? { ...s, status: 'closed', closedAt: Date.now() } : s))
  }, [])

  // Student self check-in: validate the code against an open session for one of
  // the student's classes, then mark them present in their own student doc.
  const studentCheckIn = useCallback(async (code, student) => {
    const c = (code || '').trim().toUpperCase()
    if (!c) throw new Error('Enter the code your teacher shows.')
    const ids = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    const session = attendanceSessions.find(s => s.status === 'open' && s.code === c && ids.includes(s.classId))
    if (!session) throw new Error('That code is not valid or the session has closed.')
    if (session.checkedIn?.[student.id]) return session
    const updated = students.map(s => {
      if (s.id !== student.id) return s
      const ns = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) } }
      const att = new Set(ns.attendance[session.subject] || [])
      const exc = new Set(ns.excuse[session.subject] || [])
      att.add(session.date)
      exc.delete(session.date)
      ns.attendance[session.subject] = att
      ns.excuse[session.subject] = exc
      return ns
    })
    setStudents(updated)
    await persistStudentsSync(dbRef.current, updated, [student.id])
    await fbMarkCheckedIn(dbRef.current, session.id, student.id)
    return session
  }, [attendanceSessions, students])

  // ── Student feedback (enhancement / bug / request) ─────────────────────
  const submitStudentFeedback = useCallback(async ({ student, classId, category, subject, message }) => {
    const res = await fbSubmitStudentFeedback(dbRef.current, {
      studentId: student?.id, studentName: student?.name || student?.id,
      classId: classId || student?.classId || null,
      category, subject, message,
    })
    // Notify the teacher's feedback feed.
    fbNotifyAdmin(dbRef.current, {
      type: 'feedback_new',
      title: 'New student feedback',
      body: `${student?.name || student?.id || 'A student'} sent ${category === 'bug' ? 'a bug report' : category === 'enhancement' ? 'an enhancement idea' : category === 'request' ? 'a request' : 'feedback'}.`,
      link: 'feedback',
    })
    return res
  }, [])

  const updateFeedbackStatus = useCallback(async (feedbackId, status) => {
    const reviewer = (getFbAuth()?.currentUser?.email) || 'admin'
    await fbUpdateFeedbackStatus(dbRef.current, feedbackId, status, reviewer)
    setStudentFeedback(prev => prev.map(f =>
      f.id === feedbackId ? { ...f, status, reviewedAt: Date.now(), reviewedBy: reviewer } : f
    ))
  }, [])

  // ── Screenshot guard: best-effort report to the teacher ────────────────
  // Browsers (especially iOS Safari) can't reliably block or detect a
  // screenshot, so this is a deterrent signal, not a guarantee.
  const reportScreenshot = useCallback((student, threadLabel) => {
    fbNotifyAdmin(dbRef.current, {
      type: 'screenshot',
      title: 'Possible screenshot in Messages',
      body: `${student?.name || student?.id || 'A student'} may have captured a conversation${threadLabel ? ` — ${threadLabel}` : ''}.`,
      link: 'messages',
    })
  }, [])

  const submitExcuseRequest = useCallback(async ({ student, classId, subject, date, reason }) => {
    const res = await fbSubmitExcuseRequest(dbRef.current, {
      studentId: student.id, studentName: student.name || student.id,
      classId, subject, date, reason: (reason || '').trim(),
    })
    // Notify the teacher (in-app admin notification).
    fbNotifyAdmin(dbRef.current, {
      title: 'New excuse request',
      body: `${student.name || student.id} — ${subject} (${date})`,
    })
    return res
  }, [])

  // Approving an excuse marks the date excused (and clears any present mark) on
  // the student doc; denying just records the decision.
  const decideExcuseRequest = useCallback(async (req, approve) => {
    await fbDecideExcuseRequest(dbRef.current, req.id, approve ? 'approved' : 'denied')
    setExcuseRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: approve ? 'approved' : 'denied', decidedAt: Date.now() } : r))
    if (approve) {
      const updated = students.map(s => {
        if (s.id !== req.studentId) return s
        const ns = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) } }
        const exc = new Set(ns.excuse[req.subject] || [])
        const att = new Set(ns.attendance[req.subject] || [])
        exc.add(req.date)
        att.delete(req.date)
        ns.excuse[req.subject] = exc
        ns.attendance[req.subject] = att
        return ns
      })
      setStudents(updated)
      await persistStudentsSync(dbRef.current, updated, [req.studentId])
    }
    // Notify the student (in-app notification + best-effort web push).
    const verdict = approve ? 'approved' : 'not approved'
    fbNotifyStudent(dbRef.current, req.studentId, {
      title: approve ? 'Excuse approved' : 'Excuse request update',
      body: `Your excuse for ${req.subject} on ${req.date} was ${verdict}.`,
    })
    sendPushToOwners(dbRef.current, [req.studentId], {
      title: approve ? 'Excuse approved' : 'Excuse update',
      body: `${req.subject} on ${req.date}: ${verdict}.`,
    }, { url: '/', tag: 'excuse' })
  }, [students])

  return (
    <DataContext.Provider value={{
      students, setStudents, saveStudents, markAccountActive, deleteStudent, restoreStudents,
      classes, setClasses, saveClasses, setSubjectRep, archiveClassWithStudents, unarchiveClassWithStudents, deleteClass,
      enrollInClass, unenrollFromClass,
      messages, setMessages,
      activities, setActivities,
      adminNotifs, setAdminNotifs,
      quizzes, setQuizzes,
      announcements, setAnnouncements, saveAnnouncement, deleteAnnouncement, pushAnnouncementNotifs, addAnnouncementComment, addCommentReply,
      resources, setResources, saveResource, deleteResource,
      rubricLibrary, saveRubricToLibrary, deleteLibraryRubric,
      purgeQuizFromStudents,
      syncDriftedGrades,
      meetings, setMeetings,
      liveMeetings: meetings.filter(m => m.status === 'live'),
      saveMeetLink, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting,
      attendanceSessions, openCheckIn, closeCheckIn, studentCheckIn,
      excuseRequests, submitExcuseRequest, decideExcuseRequest,
      studentFeedback, submitStudentFeedback, updateFeedbackStatus,
      reportScreenshot,
      auditLog, logAudit,
      fbReady, fbConfig, reinitFirebase,
      db: dbRef,
      ejs, setEjs, saveEjs,
      eqScale, saveEquivScale,
      latePolicy, saveLatePolicy,
      gradeFloor, saveGradeFloor,
      buildBackup, restoreBackup,
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
