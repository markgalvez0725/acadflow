import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { fbInit, getFbConfigFromEnv, getFbAuth, getIdToken } from '@/firebase/firebaseInit'
import { fbStartListening, stopListening, subscribeAdminMessages } from '@/firebase/listeners'
import {
  persistStudentsSync, persistClassesSync, persistAdmin, loadAdminFromStorage,
  fbDeleteStudent, fbPurgeStudentData, fbSaveAnnouncement, fbDeleteAnnouncement, fbPushAnnouncementNotifs,
  fbAddAnnouncementComment, fbAddCommentReply, fbEditAnnouncementComment, fbDeleteAnnouncementComment, fbEditCommentReply, fbDeleteCommentReply, fbToggleAnnouncementLike, fbToggleSavedPost, fbToggleAnnouncementFollow, fbSetGradeGoal,
  fbSaveRubricLibrary,
  fbSaveMeetLink, fbScheduleMeeting, fbStartMeeting, fbEndMeeting, fbCancelMeeting, fbPushMeetingNotifs,
  fbSaveMeetingRecap, fbSaveMeetingRecording, fbPatchMeeting,
  fbSetSubjectRep, fbDeleteClassRelatedData, fbAddAuditLog, fbRestoreFromBackup,
  fbSubmitStudentFeedback, fbUpdateFeedbackStatus,
  fbBackfillMessageActivity, fbFetchAllMessages,
  fbWriteStudentSecret, fbMigrateStudentSecrets,
  fbSubmitQuizResult,
  fbSetQuizProgress,
  fbSaveCaseStudy, fbDeleteCaseStudy,
  fbSaveCaseStudyPlan, fbDeleteCaseStudyPlan, fbDeletePlanTask,
} from '@/firebase/persistence'
import { fbPushReminderNotif } from '@/firebase/reminders'
import { rtcCleanupRoom, rtcFetchTranscript, rtcSaveTranscript } from '@/firebase/rtc'
import { fbFetchTelemetry } from '@/firebase/telemetry'
import { teleAttach } from '@/utils/telemetry'
import { presAttach, presEvent } from '@/utils/presence'
import { fbFetchPresence } from '@/firebase/presence'
import { buildRecap, transcriptToText } from '@/utils/meetingRecap'
import { serializeStudents } from '@/utils/attendance'
import { syncSettingsFromFirebase, syncAdminFromFirebase, saveSettingsToFirebase, saveEjsToFirebase, saveSemesterToFirebase, saveLatePolicyToFirebase, saveGradeFloorToFirebase, saveBrandingToFirebase, watchMaintenanceFlag, saveMaintenanceToFirebase } from '@/firebase/settings'
import { setReportBranding, setReportProfessor } from '@/export/reportTemplate'
import { DEFAULT_LATE_POLICY, normalizeLatePolicy } from '@/utils/latePenalty'
import { sendPushToOwners } from '@/firebase/pushTokens'
import {
  fbOpenAttendanceSession, fbCloseAttendanceSession, fbMarkCheckedIn,
  fbSubmitExcuseRequest, fbDecideExcuseRequest, fbNotifyAdmin, fbNotifyStudent,
} from '@/firebase/attendanceExtras'
import { loadFbConfigFromStorage, readStoredEJS } from '@/utils/crypto'
import { DEFAULT_EQ_SCALE } from '@/utils/grades'
import { annClassIds, annIsBroadcast } from '@/utils/announce'
import { computeSubjectGrade, gradeInputHash, makeHistoryEntry, appendGradeHistory } from '@/utils/gradeEngine'
import { ADMIN_EMAIL, studentDocId } from '@/constants/auth'

// The audit log is professor-only (its Firestore rule denies students). Only
// attach its listener for the admin so student sessions don't trip a
// "Missing or insufficient permissions" error on a collection they never read.
function isAdminUser() {
  try {
    const email = getFbAuth()?.currentUser?.email || ''
    return !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  } catch { return false }
}

// The signed-in student's Firestore doc id, derived from their synthetic auth
// email (<studentNumber>@acadflow.app). Returns null for the admin or when no
// student is signed in. Used to scope per-user listeners (their own feedback /
// excuse requests) instead of reading whole collections.
function currentStudentId() {
  try {
    const email = getFbAuth()?.currentUser?.email || ''
    if (!email || email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return null
    if (!email.toLowerCase().endsWith('@acadflow.app')) return null
    return studentDocId(email.split('@')[0])
  } catch { return null }
}

// Hostnames where one-time, IRREVERSIBLE data migrations may auto-run. localhost
// and Vercel preview URLs share the SAME production Firestore (config is hardcoded
// in firebaseInit), so without this the account.pass strip would fire there too -
// mutating real data while merely trying the app. Add any custom production domain.
const PROD_MIGRATION_HOSTS = ['acadflow-seven.vercel.app']
function isProdMigrationHost() {
  try { return PROD_MIGRATION_HOSTS.includes(window.location.hostname) } catch { return false }
}

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [students, setStudents]         = useState([])
  const [classes, setClasses]           = useState([])
  const [messages, setMessages]         = useState([])
  // Admin-only message pagination: the professor listens to the N most-recently-
  // active threads (not the whole history); "load older" grows the window.
  const [isAdminSession, setIsAdminSession] = useState(false)
  const [messagesLimit, setMessagesLimit]   = useState(120)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [activities, setActivities]     = useState([])
  const [adminNotifs, setAdminNotifs]   = useState([])
  const [quizzes, setQuizzes]           = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [meetings, setMeetings]           = useState([])
  const [attendanceSessions, setAttendanceSessions] = useState([])
  const [excuseRequests, setExcuseRequests]         = useState([])
  const [studentFeedback, setStudentFeedback]       = useState([])
  const [auditLog, setAuditLog]                     = useState([])
  const [rubricLibrary, setRubricLibrary]           = useState([])
  const [caseStudies, setCaseStudies]               = useState([])
  const [caseStudyPlans, setCaseStudyPlans]         = useState([])
  const [fbReady, setFbReady]           = useState(false)
  const [fbConfig, setFbConfig]         = useState(null) // decrypted config object
  const [semester, setSemester]         = useState(null)
  const dbRef = useRef(null)

  const [ejs, setEjs] = useState({ publicKey: '', serviceId: '', templateId: '', configured: false })
  const [eqScale, setEqScale]           = useState(DEFAULT_EQ_SCALE)
  const [latePolicy, setLatePolicy]     = useState(DEFAULT_LATE_POLICY)
  // Minimum-component-grade floor (0 = off). Applies to activities & quizzes.
  const [gradeFloor, setGradeFloor]     = useState(0)
  // School branding used on every exported report (school name, department,
  // address, base64 PNG/JPG logo). null = none set; exports fall back to AcadFlow.
  const [branding, setBranding]         = useState(null)
  const [admin, setAdmin]               = useState({ user: 'admin', pass: 'Admin@1234', email: 'admin@school.edu', resetPin: null, name: '', photo: null })

  // Migration freeze switch (portal/publicStatus.maintenance). Watched from
  // BEFORE sign-in (public-read doc) so the login screen can lock students out;
  // toggled by the professor in Settings > Maintenance mode.
  const [maintenanceOn, setMaintenanceOn] = useState(false)
  const _maintUnsubRef = useRef(null)

  const _bootstrapping = useRef(false)
  const _authUnsubRef  = useRef(null)

  // ── Bootstrap Firebase on mount ─────────────────────────────────────────
  useEffect(() => {
    if (_bootstrapping.current) return
    _bootstrapping.current = true
    _bootstrap()
    return () => { stopListening(); if (_authUnsubRef.current) _authUnsubRef.current(); if (_maintUnsubRef.current) _maintUnsubRef.current() }
  }, [])

  async function _bootstrap() {
    // 0. Load EJS from localStorage cache - independent of Firebase state
    try {
      const raw = localStorage.getItem('cp_ejs')
      const ejsObj = await readStoredEJS(raw)
      if (ejsObj) setEjs({ ...ejsObj, configured: true })
    } catch (e) {}

    // 1. Load Firebase config - env vars take priority, localStorage as fallback
    const cfg = getFbConfigFromEnv() || await loadFbConfigFromStorage()
    if (!cfg) {
      console.log('[DataContext] No Firebase config found - waiting for admin setup.')
      return
    }
    setFbConfig(cfg)

    // 2. Init Firebase SDK
    const db = await fbInit(cfg)
    if (!db) return
    dbRef.current = db
    setFbReady(true)

    // Maintenance flag: attach immediately (NOT auth-gated) - unauthenticated
    // students on the login screen must see the freeze the moment it flips.
    _maintUnsubRef.current = watchMaintenanceFlag(db, setMaintenanceOn)

    // Load admin info, settings, and start real-time listeners. All Firestore
    // reads happen here so they can be gated behind authentication below.
    const loadData = async () => {
      // Admin record (display only - login itself is via Firebase Auth).
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
        if (settings?.branding) setBranding(settings.branding)
      } catch (e) {}

      // Real-time listeners. Role/identity scoping lets students attach per-user
      // listeners (own feedback / excuse requests) and skip the admin-only feeds.
      const _isAdmin = isAdminUser()
      const _studentId = currentStudentId()
      setIsAdminSession(_isAdmin) // drives the admin-only paginated messages listener
      fbStartListening(db, {
        onStudentsUpdate: setStudents,
        onClassesUpdate:    setClasses,
        onMessagesUpdate:   setMessages,
        onActivitiesUpdate: setActivities,
        onAdminNotifUpdate: _isAdmin ? setAdminNotifs : undefined,
        onQuizzesUpdate:    setQuizzes,
        onAnnouncementsUpdate: setAnnouncements,
        onMeetingsUpdate: setMeetings,
        onAttendanceSessionsUpdate: setAttendanceSessions,
        onExcuseRequestsUpdate: setExcuseRequests,
        onStudentFeedbackUpdate: setStudentFeedback,
        onAuditLogUpdate: _isAdmin ? setAuditLog : undefined,
        // The rubric library is a professor-only authoring tool (students see
        // rubrics embedded on each activity doc) - don't subscribe students.
        onRubricLibraryUpdate: _isAdmin ? setRubricLibrary : undefined,
        // Case studies: professor-only grading tool - never subscribed for students.
        onCaseStudiesUpdate: _isAdmin ? setCaseStudies : undefined,
        // The plan (project management) layer is grade-free and read by BOTH roles.
        onCaseStudyPlansUpdate: setCaseStudyPlans,
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
          if (data?.branding) setBranding(data.branding)
        },
      }, { isAdmin: _isAdmin, studentId: _studentId })

      // One-time (per admin device): backfill lastActivityAt on legacy message
      // docs so the paginated admin listener's orderBy doesn't exclude them.
      if (_isAdmin) {
        try {
          if (!localStorage.getItem('cp_msg_lastact_backfill_v1')) {
            fbBackfillMessageActivity(db)
              .then(({ patched }) => {
                localStorage.setItem('cp_msg_lastact_backfill_v1', '1')
                if (patched) console.log('[Firebase] backfilled lastActivityAt on', patched, 'messages')
              })
              .catch(() => {})
          }
          // One-time: move account.pass off the broadly-readable student docs into
          // the server-only studentSecrets collection (closes the C1 read gap).
          // Idempotent and self-retrying, so it clears the flag only on a clean run.
          // Gated to the production host so running locally / on a preview (which
          // share the same Firestore) never triggers the irreversible strip.
          if (isProdMigrationHost() && !localStorage.getItem('cp_student_secrets_migrated_v1')) {
            fbMigrateStudentSecrets(db)
              .then(({ migrated, skipped }) => {
                if (!skipped) localStorage.setItem('cp_student_secrets_migrated_v1', '1')
                if (migrated) console.log('[Firebase] migrated', migrated, 'student secrets', skipped ? `(${skipped} deferred)` : '')
              })
              .catch(() => {})
          }
        } catch (e) {}
      }
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
        else if (!user && started) { started = false; stopListening(); setIsAdminSession(false) }
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
    if (_maintUnsubRef.current) _maintUnsubRef.current()
    _maintUnsubRef.current = watchMaintenanceFlag(db, setMaintenanceOn)
    const _isAdmin = isAdminUser()
    const _studentId = currentStudentId()
    setIsAdminSession(_isAdmin)
    fbStartListening(db, {
      onStudentsUpdate: setStudents,
      onClassesUpdate:    setClasses,
      onMessagesUpdate:   setMessages,
      onActivitiesUpdate: setActivities,
      onAdminNotifUpdate: _isAdmin ? setAdminNotifs : undefined,
      onQuizzesUpdate:    setQuizzes,
      onAnnouncementsUpdate: setAnnouncements,
      onMeetingsUpdate: setMeetings,
      onAttendanceSessionsUpdate: setAttendanceSessions,
      onExcuseRequestsUpdate: setExcuseRequests,
      onStudentFeedbackUpdate: setStudentFeedback,
      onAuditLogUpdate: _isAdmin ? setAuditLog : undefined,
      // Professor-only authoring tool - see the matching gate in _bootstrap.
      onRubricLibraryUpdate: _isAdmin ? setRubricLibrary : undefined,
      onCaseStudiesUpdate: _isAdmin ? setCaseStudies : undefined,
      onCaseStudyPlansUpdate: setCaseStudyPlans,
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
        if (data?.branding) setBranding(data.branding)
      },
    }, { isAdmin: _isAdmin, studentId: _studentId })
    return true
  }, [])

  // ── Admin-only paginated messages listener ─────────────────────────────
  // The professor listens to the `messagesLimit` most-recently-active threads
  // (ordered by lastActivityAt), re-subscribing when "load older" grows the
  // window. Students use the broad listener in fbStartListening instead. A full
  // page back means more may exist (hasMoreMessages).
  useEffect(() => {
    if (!fbReady || !isAdminSession || !dbRef.current) return
    const unsub = subscribeAdminMessages(dbRef.current, (msgs, count) => {
      setMessages(msgs)
      setHasMoreMessages(count >= messagesLimit)
    }, messagesLimit)
    return () => { try { unsub() } catch (e) {} }
  }, [fbReady, isAdminSession, messagesLimit])

  const loadMoreMessages = useCallback(() => setMessagesLimit(n => n + 120), [])

  // ── Device telemetry (System reports) ────────────────────────────────────
  // Hand the collector a live db getter once Firebase is up so buffered
  // signals can flush; expose the admin-side one-shot range fetch.
  useEffect(() => {
    if (!fbReady) return
    teleAttach(() => dbRef.current)
    presAttach(() => dbRef.current)
  }, [fbReady])

  const fetchTelemetry = useCallback(async (days = 7) => {
    const db = dbRef.current
    if (!db) return []
    const d = new Date(Date.now() - Math.max(1, days) * 86400000)
    const p = n => String(n).padStart(2, '0')
    const sinceDay = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    return fbFetchTelemetry(db, sinceDay)
  }, [])

  // Who's online: admin-side one-shot fetch of every presence heartbeat doc.
  const fetchPresence = useCallback(async () => {
    const db = dbRef.current
    if (!db) return []
    return fbFetchPresence(db)
  }, [])

  // ── Persistence helpers exposed to components ──────────────────────────
  // Deferred-purge bookkeeping. A deleted student's full cascade is scheduled to
  // run after the Undo window (in DataContext so it survives leaving the Students
  // tab). If the SAME id is written again before then (a re-enroll of the same
  // student number), we must finish that purge FIRST - otherwise the timer would
  // later clobber the brand-new record, and the new student would inherit the old
  // footprint (quiz scores, messages) and a stale sign-in account that blocks the
  // default Welcome@2026 password.
  const pendingPurges = useRef(new Map()) // id -> { timer, onResult }
  const purgeFnRef = useRef(null)         // latest purgeStudentEverywhere (set below)

  // ── Case studies (professor-only grouped practicals) ────────────────────
  // Optimistic merge into local state; fbSaveCaseStudy merge-writes so the
  // debounced score autosave's partial docs never clobber other fields.
  const saveCaseStudy = useCallback(async (cs) => {
    const db = dbRef.current
    if (!db || !cs?.id) return
    setCaseStudies(prev => {
      const i = prev.findIndex(x => x.id === cs.id)
      if (i === -1) return [...prev, { ...cs }]
      const next = prev.slice()
      next[i] = { ...next[i], ...cs }
      return next
    })
    await fbSaveCaseStudy(db, cs)
  }, [])

  const deleteCaseStudy = useCallback(async (id) => {
    const db = dbRef.current
    if (!db || !id) return
    setCaseStudies(prev => prev.filter(x => x.id !== id))
    setCaseStudyPlans(prev => prev.filter(x => x.id !== id))
    // The plan doc is the case study's shadow: it never outlives it. Best-effort
    // so a missing plan (legacy case study) can't block the main delete.
    fbDeleteCaseStudyPlan(db, id).catch(() => {})
    await fbDeleteCaseStudy(db, id)
  }, [])

  // ── Case study PLANS (student-visible project management layer) ─────────
  // Merge-writes like saveCaseStudy, but the optimistic local merge must go
  // DEEP on `progress` (per group, per milestone) and `tasks` (per group, per
  // task): a partial write like "group g1 checked step m2" would otherwise
  // locally wipe every other group's progress until the next snapshot.
  const saveCaseStudyPlan = useCallback(async (plan) => {
    const db = dbRef.current
    if (!db || !plan?.id) return
    setCaseStudyPlans(prev => {
      const i = prev.findIndex(x => x.id === plan.id)
      if (i === -1) return [...prev, { ...plan }]
      const cur = prev[i]
      const merged = { ...cur, ...plan }
      if (plan.roles) {
        merged.roles = { ...(cur.roles || {}), ...plan.roles }
      }
      if (plan.progress) {
        const p = { ...(cur.progress || {}) }
        for (const gid of Object.keys(plan.progress)) {
          p[gid] = { ...(p[gid] || {}), ...plan.progress[gid] }
        }
        merged.progress = p
      }
      if (plan.tasks) {
        const t = { ...(cur.tasks || {}) }
        for (const gid of Object.keys(plan.tasks)) {
          const g = { ...(t[gid] || {}) }
          for (const tid of Object.keys(plan.tasks[gid] || {})) {
            g[tid] = { ...(g[tid] || {}), ...plan.tasks[gid][tid] }
          }
          t[gid] = g
        }
        merged.tasks = t
      }
      const next = prev.slice()
      next[i] = merged
      return next
    })
    await fbSaveCaseStudyPlan(db, plan)
  }, [])

  const deletePlanTask = useCallback(async (planId, gid, taskId) => {
    const db = dbRef.current
    if (!db || !planId || !gid || !taskId) return
    setCaseStudyPlans(prev => prev.map(p => {
      if (p.id !== planId || !p.tasks?.[gid]?.[taskId]) return p
      const g = { ...p.tasks[gid] }
      delete g[taskId]
      return { ...p, tasks: { ...p.tasks, [gid]: g } }
    }))
    await fbDeletePlanTask(db, planId, gid, taskId)
  }, [])

  const saveStudents = useCallback(async (updatedStudents, changedIds) => {
    if (changedIds?.length) {
      for (const id of changedIds) {
        const p = pendingPurges.current.get(id)
        if (!p) continue
        clearTimeout(p.timer); pendingPurges.current.delete(id)
        const res = purgeFnRef.current ? await purgeFnRef.current(id).catch(() => null) : null
        try { p.onResult?.(res) } catch (e) {}
      }
    }
    setStudents(updatedStudents)
    await persistStudentsSync(dbRef.current, updatedStudents, changedIds)
  }, [])

  // Store a provisioned student's temp-password hash in the server-only
  // studentSecrets store (so it never lives on the broadly-readable student doc).
  // On failure (e.g. the studentSecrets rules aren't published yet) fall back to
  // the legacy on-doc account.pass so onboarding never silently breaks.
  // Student quiz submission routed through the data layer (echo-suppresses the
  // students-doc cache write). The quiz-doc submission is authoritative.
  const submitQuizResult = useCallback((args) => fbSubmitQuizResult(dbRef.current, args), [])
  const setQuizProgress = useCallback((args) => fbSetQuizProgress(dbRef.current, args), [])

  const provisionStudentSecret = useCallback(async (studentId, passHash) => {
    if (!dbRef.current || !studentId || !passHash) return
    try {
      await fbWriteStudentSecret(dbRef.current, studentId, passHash)
    } catch (e) {
      try {
        const { doc, updateDoc } = await import('firebase/firestore')
        await updateDoc(doc(dbRef.current, 'students', studentId), { 'account.pass': passHash })
      } catch (_) {}
    }
  }, [])

  // Promote a student's account to "Active": they've taken ownership by setting
  // their own password. Self-registration writes this inline; this covers the
  // admin-provisioned temp-password path (first forced/voluntary change).
  // Idempotent - no write if already active.
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

  // Professor approves/rejects a self-registered account's identity verification.
  // Admin-only write (the Firestore rule blocks students from setting verified).
  // Approve → verified:true (Active); reject → verified:false (stays Pending).
  const verifyStudentAccount = useCallback(async (studentId, approved = true) => {
    let changed = false
    const updated = students.map(s => {
      if (s.id !== studentId) return s
      const a = s.account || {}
      changed = true
      return { ...s, account: { ...a, verified: !!approved, verification: { ...(a.verification || {}), method: 'teacher', at: Date.now() } } }
    })
    if (changed) await saveStudents(updated, [studentId])
  }, [students, saveStudents])

  // Stamp many accounts as professor-verified in one write (used by the account
  // audit's "mark all legacy accounts verified"). Admin-only.
  const bulkVerifyAccounts = useCallback(async (ids) => {
    const idSet = new Set(ids || [])
    if (!idSet.size) return 0
    const now = Date.now()
    const updated = students.map(s => idSet.has(s.id)
      ? { ...s, account: { ...(s.account || {}), verified: true, verification: { ...(s.account?.verification || {}), method: 'teacher', at: now } } }
      : s)
    await saveStudents(updated, [...idSet])
    return idSet.size
  }, [students, saveStudents])

  // Bulk Verify + Activate: stamp registered accounts as verified AND active in
  // one write - they keep their current (temp/default) password until they
  // change it. Only touches registered accounts. Admin-only. Returns the count.
  const bulkVerifyActivate = useCallback(async (ids) => {
    const idSet = new Set(ids || [])
    if (!idSet.size) return 0
    const now = Date.now()
    let n = 0
    const updated = students.map(s => {
      if (!idSet.has(s.id) || !s.account?.registered) return s
      n++
      return { ...s, account: { ...s.account, verified: true, activated: true, _tempPass: false, verification: { ...(s.account.verification || {}), method: 'teacher', at: now } } }
    })
    if (n) await saveStudents(updated, students.filter(s => idSet.has(s.id) && s.account?.registered).map(s => s.id))
    return n
  }, [students, saveStudents])

  // Bulk "complete your profile" nudge. Writes an in-app notification to each
  // student that deep-links straight into Edit Profile, where saving re-runs the
  // Smart identity check and can auto-activate them. Each successfully-notified
  // student is stamped with account.profileNudgedAt, which drops them out of the
  // nudge target set (so the button disables once everyone flagged is notified)
  // until the cooldown elapses. Students that failed to notify are NOT stamped,
  // so they remain eligible for a retry. Returns how many were notified.
  const bulkNudgeProfiles = useCallback(async (ids) => {
    const db = dbRef.current
    if (!db) return 0
    const idList = [...new Set((ids || []).filter(Boolean))]
    if (!idList.length) return 0
    const now = Date.now()
    const dayKey = new Date(now).toISOString().slice(0, 10)
    const rem = {
      remKey: `profile-verify-${dayKey}`,
      type: 'profile',
      title: 'Finish setting up your account',
      body: 'Tap to review your profile. Confirming your details can unlock full access automatically.',
      link: 'profile',
    }
    const sentIds = []
    for (const id of idList) {
      try { if (await fbPushReminderNotif(db, id, rem)) sentIds.push(id) } catch (_) { /* best-effort - leave unstamped to retry */ }
    }
    if (sentIds.length) {
      const sent = new Set(sentIds)
      const updated = students.map(s => sent.has(s.id)
        ? { ...s, account: { ...(s.account || {}), profileNudgedAt: now } }
        : s)
      await saveStudents(updated, sentIds)
    }
    return sentIds.length
  }, [students, saveStudents])

  // Re-verify incomplete active accounts: demote each selected REGISTERED account
  // back to PENDING (account.verified = false) AND nudge it to finish the profile.
  // The demotion is the primary action and always runs - the student sees the
  // in-app pending gate explaining the paused access, so it is never truly silent.
  // The notification is best-effort: it is NOT gated on delivery (the per-day
  // dedup in fbPushReminderNotif would otherwise wrongly block the demotion when a
  // student was already nudged today). When the student completes the profile, the
  // Edit-Profile save re-runs the Smart check and can auto-activate them. Returns the
  // number demoted. Admin-only.
  const bulkDemoteAndNudge = useCallback(async (ids) => {
    const db = dbRef.current
    const idSet = new Set((ids || []).filter(Boolean))
    if (!idSet.size) return 0
    const now = Date.now()
    const dayKey = new Date(now).toISOString().slice(0, 10)
    const rem = {
      remKey: `profile-verify-${dayKey}`,
      type: 'profile',
      title: 'Action needed: finish setting up your account',
      body: 'Some details are incomplete, so full access is paused. Tap to update your profile - it can be restored automatically.',
      link: 'profile',
    }
    const targetIds = students.filter(s => idSet.has(s.id) && s.account?.registered).map(s => s.id)
    if (!targetIds.length) return 0
    const target = new Set(targetIds)
    const updated = students.map(s => target.has(s.id)
      ? { ...s, account: { ...s.account, verified: false, profileNudgedAt: now,
          verification: { ...(s.account.verification || {}), method: 'teacher-recheck', reason: 'incomplete-profile', at: now } } }
      : s)
    await saveStudents(updated, targetIds)
    // Best-effort notify - does not affect the demotion result.
    if (db) for (const id of targetIds) { try { await fbPushReminderNotif(db, id, rem) } catch (_) { /* in-app pending gate still informs them */ } }
    return targetIds.length
  }, [students, saveStudents])

  // Append an entry to the admin audit log. Fire-and-forget - callers should
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

  // Permanent cascade purge of a student's ENTIRE footprint. Called only AFTER the
  // Undo window closes (the student doc was already removed by deleteStudent). The
  // client wipes every Firestore collection it can reach; the server endpoint then
  // frees the sign-in account + Face ID data (the parts the browser cannot touch).
  // Returns { client, server } so the caller can warn precisely when the server
  // side is unavailable. Never throws - deletion must always feel complete.
  const purgeStudentEverywhere = useCallback(async (id) => {
    let client = null;
    try { client = await fbPurgeStudentData(dbRef.current, id); } catch (e) { /* best-effort */ }

    let server = { ok: false, reason: 'unavailable' };
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        server = { ok: false, reason: 'auth' };
      } else {
        const r = await fetch('/api/delete-student', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, studentNumber: id }),
        });
        if (r.status === 501) server = { ok: false, reason: 'not-configured' };
        else if (r.ok) { const d = await r.json().catch(() => ({})); server = { ok: true, ...d }; }
        else server = { ok: false, reason: 'error' };
      }
    } catch (e) { server = { ok: false, reason: 'network' }; }

    logAudit({
      action: 'student.purge',
      target: id,
      summary: `Permanently purged all data for student ${id}`,
      meta: { studentId: id, serverOk: server.ok },
    });
    return { client, server };
  }, [logAudit]);

  // Keep a stable ref to the latest purge fn so saveStudents (defined earlier) and
  // the deferred timer can reach it without a declaration-order / TDZ dependency.
  purgeFnRef.current = purgeStudentEverywhere;

  // Schedule a student's permanent purge to run after `delayMs` (the Undo window).
  // cancelPurge aborts it (Undo pressed); saveStudents flushes it early when the
  // same student number is re-enrolled. `onResult` receives the purge outcome so
  // the caller can warn if the server side was unreachable.
  const schedulePurge = useCallback((id, delayMs, onResult) => {
    const ex = pendingPurges.current.get(id);
    if (ex) clearTimeout(ex.timer);
    const timer = setTimeout(async () => {
      pendingPurges.current.delete(id);
      const res = purgeFnRef.current ? await purgeFnRef.current(id) : null;
      try { onResult?.(res); } catch (e) {}
    }, delayMs);
    pendingPurges.current.set(id, { timer, onResult });
  }, []);

  const cancelPurge = useCallback((id) => {
    const p = pendingPurges.current.get(id);
    if (p) { clearTimeout(p.timer); pendingPurges.current.delete(id); return true; }
    return false;
  }, []);

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
  // config are intentionally excluded - this is academic data, not secrets.
  const buildBackup = useCallback(async () => {
    // The admin's live `messages` is now a paginated window, so fetch the COMPLETE
    // set for the backup (falls back to the in-memory copy if the read fails).
    let allMessages = messages
    try { const fetched = await fbFetchAllMessages(dbRef.current); if (Array.isArray(fetched)) allMessages = fetched } catch (e) {}
    return {
      app: 'acadflow',
      version: 1,
      exportedAt: Date.now(),
      counts: {
        students: students.length, classes: classes.length, messages: allMessages.length,
        activities: activities.length, quizzes: quizzes.length, announcements: announcements.length,
        meetings: meetings.length, attendanceSessions: attendanceSessions.length, excuseRequests: excuseRequests.length,
      },
      data: {
        students: serializeStudents(students),
        classes,
        messages: allMessages,
        activities,
        quizzes,
        announcements,
        meetings,
        attendanceSessions,
        excuseRequests,
        adminNotifs,   // included for record; not written back on restore
        auditLog,      // included for record; not written back on restore
        settings: { equivScale: eqScale, semester, latePolicy, gradeFloor, branding },
      },
    }
  }, [students, classes, messages, activities, quizzes, announcements, meetings, attendanceSessions, excuseRequests, adminNotifs, auditLog, eqScale, semester, latePolicy, gradeFloor, branding])

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

  // Migration freeze toggle (professor-only in the UI; Firestore rules also
  // restrict the write to the admin). Optimistic set + strict rethrow so the
  // settings panel can surface a failed flip instead of lying about it.
  const setMaintenanceMode = useCallback(async (on) => {
    const next = !!on
    const prev = maintenanceOn
    setMaintenanceOn(next)
    try { await saveMaintenanceToFirebase(dbRef.current, next) } catch (e) {
      setMaintenanceOn(prev)
      console.warn('[DataContext] setMaintenanceMode Firebase sync failed:', e.message)
      throw e
    }
    logAudit({
      action: next ? 'system.maintenanceOn' : 'system.maintenanceOff',
      target: 'Portal',
      summary: next ? 'Maintenance mode turned ON (students locked out)' : 'Maintenance mode turned OFF (portal restored)',
    })
  }, [maintenanceOn, logAudit])

  // Minimum component grade (floor) for activities & quizzes. 0 disables it.
  const saveGradeFloor = useCallback(async (v) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
    setGradeFloor(n)
    try { await saveGradeFloorToFirebase(dbRef.current, n) } catch (e) {
      console.warn('[DataContext] saveGradeFloor Firebase sync failed:', e.message)
      throw e
    }
  }, [])

  // Keep the export engine's branding cache in sync so every PDF/Excel report
  // (including direct exports that don't pass branding) is branded.
  useEffect(() => { setReportBranding(branding) }, [branding])

  // Feed only the professor's NAME into report headers + the "Prepared by"
  // line. The professor photo is intentionally never passed to the export layer.
  useEffect(() => { setReportProfessor({ name: admin?.name || '' }) }, [admin?.name])

  // Branding for exports (school name, department, address, base64 logo).
  // Optimistic local set, then persist (strict: rethrow so the UI can surface).
  const saveBranding = useCallback(async (b) => {
    const next = b || null
    setBranding(next)
    try { await saveBrandingToFirebase(dbRef.current, next) } catch (e) {
      console.warn('[DataContext] saveBranding Firebase sync failed:', e.message)
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
  // and the class is removed from their classIds. Professor re-enrolls manually.
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
          _late: s.late?.[sub] ? [...s.late[sub]] : [],
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
        late:           { ...(s.late || {}) },
        gradeComponents: { ...(s.gradeComponents || {}) },
      }
      if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }

      // Strip attendance/excuse for this class from the active profile
      // (already snapshotted above). Grades are retained so students can
      // always view their results even after the class is archived.
      cls.subjects.forEach(sub => {
        delete ns.attendance[sub]
        delete ns.excuse[sub]
        delete ns.late[sub]
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
      // Strict write + rollback: a silently-dropped write here would leave the
      // students un-enrolled locally yet still enrolled in Firestore (or the
      // reverse on the next reload), i.e. a phantom auto-unenroll. Surface the
      // failure and restore local state so it always matches what was saved.
      setStudents(updatedStudents)
      try {
        await persistStudentsSync(dbRef.current, updatedStudents, enrolled.map(s => s.id), { strict: true })
      } catch (e) {
        setStudents(students)
        throw new Error('Could not archive the class for all students. Please check your connection and try again.')
      }
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
        late:            { ...(s.late || {}) },
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
        ns.late[sub]       = new Set(subData._late || [])
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
      // Strict write + rollback (see archiveClassWithStudents): without this a
      // dropped write leaves students re-enrolled locally but absent in
      // Firestore, so the next reload silently un-enrolls them again.
      setStudents(updatedStudents)
      try {
        await persistStudentsSync(dbRef.current, updatedStudents, studentsToRestore.map(s => s.id), { strict: true })
      } catch (e) {
        setStudents(students)
        throw new Error('Could not restore the class for all students. Please check your connection and try again.')
      }
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
        late:            { ...(s.late || {}) },
        gradeComponents: { ...(s.gradeComponents || {}) },
      }
      if (s.gradeUploadedAt) ns.gradeUploadedAt = { ...s.gradeUploadedAt }

      // Strip all subject data belonging to this class
      cls.subjects?.forEach(sub => {
        delete ns.grades[sub]
        delete ns.attendance[sub]
        delete ns.excuse[sub]
        delete ns.late[sub]
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
    // Wrapped in try/catch - if Firestore security rules block the batch delete,
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

  // ── Rubric library (reusable grading rubrics - singleton portal doc) ────
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
  // grade - clear them here. Recomputed term grades refresh next time the
  // professor opens/saves the grade sheet.
  const purgeQuizFromStudents = useCallback(async (quiz) => {
    const quizId = quiz?.id
    if (!quizId) return
    const changed = []
    const updated = students.map(s => {
      let touched = false
      // 1. quizResults - remove the entry for this quiz (search every subject).
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
      // 2. gradeComponents[subject].quizScores[quizId] - drop the keyed score.
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
      const entry = makeHistoryEntry(
        live.components,
        { midterm: live.midterm, finals: live.finals, final: live.final },
        'recomputed', now,
      )
      updated = updated.map(x => x.id === studentId ? {
        ...x,
        gradeComponents: { ...(x.gradeComponents || {}), [subject]: comp },
        grades:          { ...(x.grades || {}), [subject]: live.final },
        gradeSnapshots:  { ...(x.gradeSnapshots || {}), [subject]: snapshot },
        gradeHistory:    appendGradeHistory(x.gradeHistory, subject, entry),
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
    // Fresh room guarantee: purge anything a badly-ended earlier session left
    // under rtcRooms/{id} (chat, ghost participants, stale signals) BEFORE
    // students can join. The End-class purge is best-effort; this catches
    // whatever it missed, so old chat can never greet a new class.
    if (meeting.provider === 'inapp') { try { await rtcCleanupRoom(dbRef.current, meeting.id) } catch { /* best-effort */ } }
    const sig = await fbStartMeeting(dbRef.current, meeting.id, meeting.provider)
    // Mirror status + signaling mode locally: the professor opens the room
    // right away, before the snapshot echo delivers the stamped doc.
    setMeetings(prev => prev.map(m => (m.id === meeting.id ? { ...m, status: 'live', ...(sig ? { sig } : {}) } : m)))
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_live')
  }, [students])

  // One-click "Go Live": create a meeting and bring it live immediately, so
  // enrolled students instantly see the Join button + a "live now" notice.
  // Returns the live meeting (with its Meet link) for the caller to open.
  const startInstantMeeting = useCallback(async (meetingData) => {
    // Never spin up a second live session for a class+subject that is already
    // live - reuse the existing one. This stops the duplicate-session bug at the
    // source (the UI already hides "Go Live" when one is live, but a stale render
    // could slip a second click through).
    const already = meetings.find(m => m.status === 'live'
      && m.classId === meetingData.classId
      && (m.subject || null) === (meetingData.subject || null))
    if (already) return already
    // A scheduled session for this class+subject that is due (or starts within
    // the hour) IS this class - bring that doc live instead of spawning a
    // duplicate. Otherwise the scheduled entry never starts, never ends, and
    // sits in Upcoming forever after the real class is over.
    const due = meetings
      .filter(m => m.status === 'scheduled'
        && m.classId === meetingData.classId
        && (m.subject || null) === (meetingData.subject || null)
        && (m.scheduledAt || 0) <= Date.now() + 60 * 60000)
      .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0))[0]
    if (due) {
      // The professor may go live in a different mode than they scheduled
      // (e.g. scheduled a Meet link but pressed "Go live in app") - the way
      // they actually start the class wins.
      const wantProvider = meetingData.provider === 'inapp' ? 'inapp' : 'link'
      const patch = {}
      if ((due.provider || 'link') !== wantProvider) {
        patch.provider = wantProvider
        patch.meetLink = wantProvider === 'inapp' ? '' : (meetingData.meetLink || due.meetLink || '')
      } else if (wantProvider === 'link' && meetingData.meetLink && due.meetLink !== meetingData.meetLink) {
        patch.meetLink = meetingData.meetLink
      }
      if (Object.keys(patch).length) {
        try { await fbPatchMeeting(dbRef.current, due.id, patch) } catch { /* keep scheduled fields */ }
      }
      const adopted = { ...due, ...patch }
      if (adopted.provider === 'inapp') { try { await rtcCleanupRoom(dbRef.current, adopted.id) } catch { /* best-effort */ } }
      const sig = await fbStartMeeting(dbRef.current, adopted.id, adopted.provider)
      const live = { ...adopted, status: 'live', ...(sig ? { sig } : {}) }
      setMeetings(prev => prev.map(m => (m.id === live.id ? live : m)))
      await fbPushMeetingNotifs(dbRef.current, live, students, 'meeting_live')
      return live
    }
    const meeting = await fbScheduleMeeting(dbRef.current, { ...meetingData, scheduledAt: Date.now() })
    if (!meeting) return null
    // New uuid = clean room, but purge anyway: belt and braces against any
    // future id-reuse path (same guarantee startMeeting gives scheduled docs).
    if (meeting.provider === 'inapp') { try { await rtcCleanupRoom(dbRef.current, meeting.id) } catch { /* best-effort */ } }
    const sig = await fbStartMeeting(dbRef.current, meeting.id, meeting.provider)
    const live = { ...meeting, status: 'live', ...(sig ? { sig } : {}) }
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
    // In-app rooms leave ephemeral signaling docs behind (rtcRooms/*) - purge
    // them best-effort; anyone still connected also self-deletes on leave.
    for (const m of targets) if (m.provider === 'inapp') rtcCleanupRoom(dbRef.current, m.id)
    // A scheduled sibling whose time has already passed was THIS class (the
    // professor went live without pressing its Start button). Remove it
    // quietly - no cancelled notification, it is a duplicate, not a class
    // being called off - so it never lingers in Upcoming after the class ends.
    const staleScheduled = meetings.filter(m => m.status === 'scheduled'
      && m.classId === meeting.classId
      && (m.subject || null) === (meeting.subject || null)
      && (m.scheduledAt || 0) <= Date.now())
    for (const m of staleScheduled) {
      try { await fbCancelMeeting(dbRef.current, m.id) } catch { /* best-effort */ }
    }
    if (staleScheduled.length) {
      const gone = new Set(staleScheduled.map(m => m.id))
      setMeetings(prev => prev.filter(m => !gone.has(m.id)))
    }
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_ended')
  }, [students, meetings])

  const cancelMeeting = useCallback(async (meeting) => {
    await fbCancelMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_cancelled')
  }, [students])

  // Lazy janitor, called from the professor's Online Classes tab (admin-only
  // writes): a scheduled meeting more than 12 hours overdue was never started
  // and never will be - remove it quietly so Upcoming reflects reality.
  const sweepStaleMeetings = useCallback(async () => {
    const cutoff = Date.now() - 12 * 3600000
    const stale = meetings.filter(m => m.status === 'scheduled' && (m.scheduledAt || 0) < cutoff)
    if (!stale.length) return 0
    for (const m of stale) {
      try { await fbCancelMeeting(dbRef.current, m.id) } catch { /* best-effort */ }
    }
    const gone = new Set(stale.map(m => m.id))
    setMeetings(prev => prev.filter(m => !gone.has(m.id)))
    return stale.length
  }, [meetings])

  // ── Smart Recap of an in-app class ─────────────────────────────────────
  // Assembles the silent per-speaker transcript (rtcRooms/{id}/transcript)
  // into a rich-text recap and saves it on the meeting doc (professor client
  // only - onlineMeetings is admin-write-only; students read it through the
  // normal meetings listener). Tries the server summarizer first (Groq via
  // the shared api/generate-quiz route, 501 when unconfigured), falls back to the
  // deterministic on-device engine. Returns the recap or null (no speech).
  const generateMeetingRecap = useCallback(async (meeting) => {
    const db = dbRef.current
    if (!db || !meeting?.id) return null
    const segments = await rtcFetchTranscript(db, meeting.id)
    if (!segments.length) return null
    // Study-notes engine (embedding-powered topic sections + annotations);
    // it resolves to the keyword recap on devices without the model.
    const device = await buildRecap(segments, meeting)
    let recap = device
    try {
      const idToken = await getIdToken()
      if (idToken) {
        // Shared Groq route (transcript mode) - Vercel Hobby caps deployments
        // at 12 functions, so the recap summarizer rides on generate-quiz.
        const r = await fetch('/api/generate-quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, transcript: transcriptToText(segments), meta: { title: meeting.title || meeting.className || '' } }),
        })
        if (r.ok) {
          const data = await r.json().catch(() => null)
          if (data?.html && device) recap = { ...device, html: data.html, engine: 'smart' }
        }
      }
    } catch { /* on-device recap already in hand */ }
    if (!recap) return null
    recap = { ...recap, generatedAt: Date.now() }
    await fbSaveMeetingRecap(db, meeting.id, recap)
    setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...m, recap } : m))
    return recap
  }, [])

  // Full transcript for the recap modal's "View transcript" section.
  const fetchMeetingTranscript = useCallback(async (meetingId) => {
    if (!dbRef.current || !meetingId) return []
    try { return await rtcFetchTranscript(dbRef.current, meetingId) } catch { return [] }
  }, [])

  // Persist the Drive recording pointer on the meeting. The recording arrives
  // with status 'processing' - Drive still has to process the video before it
  // can be previewed - so NO notification fires here. markMeetingRecordingReady
  // (driven by the MeetingHost status poller) flips it to 'ready' and notifies.
  const saveMeetingRecording = useCallback(async (meeting, recording) => {
    const db = dbRef.current
    if (!db || !meeting?.id || !recording) return
    await fbSaveMeetingRecording(db, meeting.id, recording)
    setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...m, recording } : m))
  }, [])

  // On-device Whisper output: save the lines where the legacy viewer already
  // reads (rtcRooms/{id}/transcript), then build + save the recap off them -
  // that recap stamp is what makes the row's Recap/Transcript buttons appear.
  const saveClassTranscript = useCallback(async (meeting, lines) => {
    const db = dbRef.current
    if (!db || !meeting?.id || !lines?.length) return null
    await rtcSaveTranscript(db, meeting.id, lines)
    return generateMeetingRecap(meeting)
  }, [generateMeetingRecap])

  // Small professor-side patches on a meeting doc (joinLog, attMarkedAt).
  const patchMeeting = useCallback(async (meeting, patch) => {
    const db = dbRef.current
    if (!db || !meeting?.id || !patch) return
    await fbPatchMeeting(db, meeting.id, patch)
    setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...m, ...patch } : m))
  }, [])

  // Drive finished processing the video: mark it ready and tell the professor.
  const markMeetingRecordingReady = useCallback(async (meeting) => {
    const db = dbRef.current
    const rec = meeting?.recording
    if (!db || !meeting?.id || !rec) return
    const updated = { ...rec, status: 'ready', readyAt: Date.now() }
    await fbSaveMeetingRecording(db, meeting.id, updated)
    setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...m, recording: updated } : m))
    try {
      // fbNotifyAdmin here is the attendanceExtras one (title/body/link/type);
      // the meeting: deep-link lands on the past row with the Recording button.
      await fbNotifyAdmin(db, {
        type: 'meeting_recording',
        title: 'Recording is ready to view',
        body: `${meeting.className || 'Class'}: ${meeting.title || 'Online class'}`,
        link: `meeting:${meeting.id}`,
      })
    } catch { /* the row pill already flipped */ }
  }, [])

  const pushAnnouncementNotifs = useCallback(async (announcement) => {
    await fbPushAnnouncementNotifs(dbRef.current, announcement, students)
    // Best-effort web push (in addition to the existing in-app notification).
    const targetClassIds = annClassIds(announcement)
    const targetOwners = annIsBroadcast(announcement)
      ? 'all'
      : students.filter(s => {
          const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
          return ids.some(id => targetClassIds.includes(id))
        }).map(s => s.id)
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
    presEvent('comment', 'Commented on the Stream')
  }, [])

  // Like a post (Instagram-style). Optimistic; reverts the local entry if the
  // atomic write fails so the heart never lies about the persisted state.
  const toggleAnnouncementLike = useCallback(async (announcementId, studentId, liked) => {
    const apply = (want) => setAnnouncements(prev => prev.map(a => {
      if (a.id !== announcementId) return a
      const cur = Array.isArray(a.likes) ? a.likes : []
      const next = want ? [...new Set([...cur, studentId])] : cur.filter(id => id !== studentId)
      return { ...a, likes: next }
    }))
    apply(liked)
    try { await fbToggleAnnouncementLike(dbRef.current, announcementId, studentId, liked) }
    catch { apply(!liked) }
  }, [])

  // Follow a post for new-comment notifications. Optimistic with revert.
  const toggleAnnouncementFollow = useCallback(async (announcementId, studentId, following) => {
    const apply = (want) => setAnnouncements(prev => prev.map(a => {
      if (a.id !== announcementId) return a
      const cur = Array.isArray(a.followers) ? a.followers : []
      const next = want ? [...new Set([...cur, studentId])] : cur.filter(id => id !== studentId)
      return { ...a, followers: next }
    }))
    apply(following)
    try { await fbToggleAnnouncementFollow(dbRef.current, announcementId, studentId, following) }
    catch { apply(!following) }
  }, [])

  // Save/bookmark a post on the student's own doc. Optimistic with revert.
  const toggleSavedPost = useCallback(async (studentId, announcementId, saved) => {
    const apply = (want) => setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const cur = Array.isArray(s.savedPosts) ? s.savedPosts : []
      const next = want ? [...new Set([...cur, announcementId])] : cur.filter(id => id !== announcementId)
      return { ...s, savedPosts: next }
    }))
    apply(saved)
    try { await fbToggleSavedPost(dbRef.current, studentId, announcementId, saved) }
    catch { apply(!saved) }
  }, [])

  // Per-subject grade goal on the student's own doc. Optimistic with revert.
  const setGradeGoal = useCallback(async (studentId, subject, eq) => {
    const prev = students.find(s => s.id === studentId)?.goals?.[subject] ?? null
    const apply = (val) => setStudents(list => list.map(s => {
      if (s.id !== studentId) return s
      const goals = { ...(s.goals || {}) }
      if (val) goals[subject] = val
      else delete goals[subject]
      return { ...s, goals }
    }))
    apply(eq)
    try { await fbSetGradeGoal(dbRef.current, studentId, subject, eq) }
    catch { apply(prev) }
  }, [students])

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

  // Edit / delete a comment or reply. Optimistic; the listener reconciles with
  // the transactional write. Authorization (own comment only) is enforced in the UI.
  const editAnnouncementComment = useCallback(async (announcementId, commentId, text) => {
    setAnnouncements(prev => prev.map(a => a.id === announcementId
      ? { ...a, comments: (a.comments || []).map(c => c.id === commentId ? { ...c, text, editedAt: Date.now() } : c) }
      : a))
    await fbEditAnnouncementComment(dbRef.current, announcementId, commentId, text)
  }, [])

  const deleteAnnouncementComment = useCallback(async (announcementId, commentId) => {
    setAnnouncements(prev => prev.map(a => a.id === announcementId
      ? { ...a, comments: (a.comments || []).filter(c => c.id !== commentId) }
      : a))
    await fbDeleteAnnouncementComment(dbRef.current, announcementId, commentId)
  }, [])

  const editCommentReply = useCallback(async (announcementId, commentId, replyId, text) => {
    setAnnouncements(prev => prev.map(a => a.id === announcementId
      ? { ...a, comments: (a.comments || []).map(c => c.id === commentId
          ? { ...c, replies: (c.replies || []).map(r => r.id === replyId ? { ...r, text, editedAt: Date.now() } : r) }
          : c) }
      : a))
    await fbEditCommentReply(dbRef.current, announcementId, commentId, replyId, text)
  }, [])

  const deleteCommentReply = useCallback(async (announcementId, commentId, replyId) => {
    setAnnouncements(prev => prev.map(a => a.id === announcementId
      ? { ...a, comments: (a.comments || []).map(c => c.id === commentId
          ? { ...c, replies: (c.replies || []).filter(r => r.id !== replyId) }
          : c) }
      : a))
    await fbDeleteCommentReply(dbRef.current, announcementId, commentId, replyId)
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
      throw new Error('The enrollment period for this semester has ended. Contact your professor for assistance.')
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

    // Irregular students may enroll across year levels, so the year + section
    // gates (section encodes the year) are skipped for them; only course applies.
    const irregular = (student.studentType || 'regular') === 'irregular'

    // Year level (digit from class.year or section vs student's year)
    if (!irregular) {
      const clsYear = yearDigit(cls.year) || yearDigit(cls.section)
      const stuYear = yearDigit(student.year)
      if (clsYear && stuYear && clsYear !== stuYear) {
        throw new Error(`Year level mismatch. This subject is for year ${clsYear}, but you are in year ${stuYear}. You can only enroll in subjects for your own year level.`)
      }
    }

    // Section (exact match). Student section = explicit field, else their primary class's section.
    if (!irregular && cls.section) {
      const primaryCls = classes.find(c => c.id === (student.classId || student.classIds?.[0]))
      const studentSection = student.section || primaryCls?.section || ''
      if (!studentSection) {
        throw new Error('Your section is not set yet. Please ask your professor to set your section before enrolling.')
      }
      if (normSection(studentSection) !== normSection(cls.section)) {
        throw new Error(`Section mismatch. This subject is for section "${cls.section}", but you belong to section "${studentSection}". You can only enroll in subjects for your own section.`)
      }
    }

    const currentIds = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    if (currentIds.includes(classId)) throw new Error('You are already enrolled in this class.')

    // Initialise attendance/excuse slots for the new class. Grades and
    // gradeComponents are deliberately LEFT UNTOUCHED: the Firestore rule
    // (gradeFieldsUntouched) rejects any student-side write whose diff touches
    // `grades`/`gradeComponents`, so a self-enroll that seeded null grade slots
    // was rejected - and used to fail silently (the student looked enrolled
    // locally but wasn't saved). Grade slots are created lazily on read and by
    // the professor's gradebook, so they aren't needed here.
    const attendance = { ...student.attendance }
    const excuse     = { ...student.excuse }
    const late       = { ...(student.late || {}) }
    cls.subjects.forEach(sub => {
      if (!attendance[sub]) attendance[sub] = new Set()
      if (!excuse[sub])     excuse[sub] = new Set()
      if (!late[sub])       late[sub] = new Set()
    })

    const newClassIds = [...currentIds, classId]
    const updatedStudent = {
      ...student,
      classId:  student.classId || classId,
      classIds: newClassIds,
      attendance,
      excuse,
      late,
    }
    const updatedStudents = students.map(s => s.id === studentId ? updatedStudent : s)
    // Optimistic update, then a STRICT write. If the write fails we must roll
    // back - otherwise the student looks enrolled locally but isn't in Firestore,
    // and the next reload silently "un-enrolls" them.
    setStudents(updatedStudents)
    try {
      await persistStudentsSync(dbRef.current, updatedStudents, [studentId], { strict: true })
    } catch (e) {
      setStudents(students)
      throw new Error('Could not save your enrollment. Please check your connection and try again.')
    }
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
    try {
      await persistStudentsSync(dbRef.current, updatedStudents, [studentId], { strict: true })
    } catch (e) {
      setStudents(students)
      throw new Error('Could not save the change. Please check your connection and try again.')
    }
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

    // 2. Sync to Firebase in background - non-blocking
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
    if (!c) throw new Error('Enter the code your professor shows.')
    const ids = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    const session = attendanceSessions.find(s => s.status === 'open' && s.code === c && ids.includes(s.classId))
    if (!session) throw new Error('That code is not valid or the session has closed.')
    if (session.date !== new Date().toLocaleDateString('en-CA')) throw new Error('That session was for a previous day and has expired.')
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
    // Notify the professor's feedback feed.
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

  // ── Screenshot guard: best-effort report to the professor ────────────────
  // Browsers (especially iOS Safari) can't reliably block or detect a
  // screenshot, so this is a deterrent signal, not a guarantee.
  const reportScreenshot = useCallback((student, threadLabel) => {
    fbNotifyAdmin(dbRef.current, {
      type: 'screenshot',
      title: 'Possible screenshot in Messages',
      body: `${student?.name || student?.id || 'A student'} may have captured a conversation${threadLabel ? ` - ${threadLabel}` : ''}.`,
      link: 'messages',
    })
  }, [])

  const submitExcuseRequest = useCallback(async ({ student, classId, subject, date, reason }) => {
    const res = await fbSubmitExcuseRequest(dbRef.current, {
      studentId: student.id, studentName: student.name || student.id,
      classId, subject, date, reason: (reason || '').trim(),
    })
    // Notify the professor (in-app admin notification).
    fbNotifyAdmin(dbRef.current, {
      title: 'New excuse request',
      body: `${student.name || student.id} - ${subject} (${date})`,
      link: `excuse:${res.id}`,
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
        const ns = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) }, late: { ...(s.late || {}) } }
        const exc = new Set(ns.excuse[req.subject] || [])
        const att = new Set(ns.attendance[req.subject] || [])
        const lt  = new Set(ns.late[req.subject] || [])
        exc.add(req.date)
        att.delete(req.date)
        lt.delete(req.date)
        ns.excuse[req.subject] = exc
        ns.attendance[req.subject] = att
        ns.late[req.subject] = lt
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

  // Save (or clear) a professor's private note on one student's subject grade.
  // The note is an additive sibling field (`gradeNotes[subject]`) written only
  // through this admin path - never by students - so it stays clear of the
  // Firestore gradeFieldsUntouched() rule. Persists on the same students write
  // path, then notifies the student (in-app + best-effort push).
  const saveGradeNote = useCallback(async (studentId, subject, text, byName) => {
    const clean = String(text || '').trim().slice(0, 600)
    const by = String(byName || '').trim() || 'Your professor'
    let found = false
    const updated = students.map(s => {
      if (s.id !== studentId) return s
      found = true
      const notes = { ...(s.gradeNotes || {}) }
      if (clean) notes[subject] = { text: clean, by, at: Date.now() }
      else delete notes[subject]
      return { ...s, gradeNotes: notes }
    })
    if (!found) return
    await saveStudents(updated, [studentId])
    if (!clean) return // clearing a note is silent
    fbNotifyStudent(dbRef.current, studentId, {
      title: 'Note from your professor',
      body: `${by} left a note on your ${subject} grade.`,
      link: 'grades', type: 'grade_note',
    })
    sendPushToOwners(dbRef.current, [studentId], {
      title: 'Note on your grade',
      body: `${by} left a note on your ${subject} grade.`,
    }, { url: '/', tag: 'grade_note' })
  }, [students, saveStudents])

  return (
    <DataContext.Provider value={{
      students, setStudents, saveStudents, provisionStudentSecret, submitQuizResult, setQuizProgress, saveGradeNote, markAccountActive, deleteStudent, purgeStudentEverywhere, schedulePurge, cancelPurge, restoreStudents,
      classes, setClasses, saveClasses, setSubjectRep, archiveClassWithStudents, unarchiveClassWithStudents, deleteClass,
      enrollInClass, unenrollFromClass,
      messages, setMessages, loadMoreMessages, hasMoreMessages,
      activities, setActivities,
      adminNotifs, setAdminNotifs,
      quizzes, setQuizzes,
      announcements, setAnnouncements, saveAnnouncement, deleteAnnouncement, pushAnnouncementNotifs, addAnnouncementComment, addCommentReply, editAnnouncementComment, deleteAnnouncementComment, editCommentReply, deleteCommentReply, toggleAnnouncementLike, toggleSavedPost, toggleAnnouncementFollow, setGradeGoal,
      rubricLibrary, saveRubricToLibrary, deleteLibraryRubric,
      purgeQuizFromStudents,
      syncDriftedGrades,
      verifyStudentAccount,
      bulkVerifyAccounts,
      bulkVerifyActivate,
      bulkNudgeProfiles,
      bulkDemoteAndNudge,
      meetings, setMeetings,
      liveMeetings: meetings.filter(m => m.status === 'live'),
      saveMeetLink, scheduleMeeting, startInstantMeeting, startMeeting, endMeeting, cancelMeeting, sweepStaleMeetings, fetchTelemetry, fetchPresence,
      generateMeetingRecap, fetchMeetingTranscript, saveMeetingRecording, markMeetingRecordingReady,
      patchMeeting, saveClassTranscript,
      caseStudies, saveCaseStudy, deleteCaseStudy,
      caseStudyPlans, saveCaseStudyPlan, deletePlanTask,
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
      branding, saveBranding,
      buildBackup, restoreBackup,
      semester, saveSemester,
      admin, setAdmin, saveAdmin,
      maintenanceOn, setMaintenanceMode,
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
