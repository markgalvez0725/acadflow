import React, { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import LoadingScreen from '@/components/primitives/LoadingScreen'
import ErrorState from '@/components/ds/ErrorState'
import { lazyRetry } from '@/utils/lazyRetry'

// Screens - imported lazily to keep initial bundle small (lazyRetry survives
// dropped chunk fetches on flaky mobile data instead of hard-failing)
const LoginScreen      = lazyRetry(() => import('@/components/auth/LoginScreen'))
const AdminLoginScreen = lazyRetry(() => import('@/components/auth/AdminLoginScreen'))
const AdminLayout      = lazyRetry(() => import('@/components/admin/AdminLayout'))
const StudentLayout    = lazyRetry(() => import('@/components/student/StudentLayout'))
const CommandPalette   = lazyRetry(() => import('@/components/primitives/CommandPalette'))
const QuickUnlock      = lazyRetry(() => import('@/components/auth/QuickUnlock'))
const MaintenanceScreen = lazyRetry(() => import('@/components/primitives/MaintenanceScreen'))

// Fades out and removes the instant boot splash baked into index.html. It is
// rendered INSIDE the Suspense boundary alongside the real screen, so its effect
// only runs once that screen has actually committed (while the lazy chunk is
// still loading the whole subtree, including this, is replaced by the Suspense
// fallback). Until then the boot splash stays up and keeps its single, continuous
// animation - so the splash never visibly re-fires when React takes over.
function BootSplashHider() {
  useEffect(() => {
    const el = document.getElementById('boot-splash')
    if (!el) return
    const remove = () => {
      el.removeEventListener('transitionend', remove)
      if (el.parentNode) el.parentNode.removeChild(el)
    }
    el.classList.add('is-hiding')
    el.addEventListener('transitionend', remove)
    const t = setTimeout(remove, 600) // fallback if transitionend never fires
    return () => clearTimeout(t)
  }, [])
  return null
}

export default function AppRouter() {
  const { sessionRole, pinLocked, logout } = useAuth()
  const { fbReady, maintenanceOn } = useData()

  // Maintenance mode CUTS live student sessions, it doesn't just cover them:
  // the Firebase Auth sign-out drops every listener and the saved session, so
  // the device lands on the maintenance screen logged out and must sign in
  // fresh once the professor lifts the freeze. Admin sessions are untouched.
  useEffect(() => {
    if (maintenanceOn && sessionRole === 'student') logout('maintenance')
  }, [maintenanceOn, sessionRole, logout])
  const { startLoading, stopLoading } = useUI()
  // Faculty/admin sign-in is reached via the /faculty path (not linked from the
  // student login). Inside an installed PWA there's no address bar to type that
  // path, so the student login also exposes a hidden gesture (tap the logo 5×)
  // that flips this flag to reveal the faculty form.
  const [facultyReveal, setFacultyReveal] = useState(false)
  const isAdminPath = window.location.pathname.startsWith('/faculty') || facultyReveal

  // Drive the thin top loading bar while Firebase initializes.
  useEffect(() => {
    if (!fbReady) {
      startLoading()
    } else {
      stopLoading()
    }
  }, [fbReady])

  // Safety net for slow or dead connections: the boot splash (index.html) is
  // auto-removed after 10s by boot-fallback.js, and without this the user was
  // left staring at a permanently blank page whenever Firebase never became
  // ready. After 12s of waiting we surface an honest "still trying" screen
  // with a reload action instead.
  const [bootStalled, setBootStalled] = useState(false)
  useEffect(() => {
    if (fbReady) { setBootStalled(false); return }
    const t = setTimeout(() => setBootStalled(true), 12000)
    return () => clearTimeout(t)
  }, [fbReady])

  // Migration freeze (portal/publicStatus.maintenance, toggled by the
  // professor in Settings > Maintenance mode). Students - signed in or not -
  // get the maintenance screen; the faculty door stays open: the /faculty
  // path (or the 5-tap logo gesture, mirrored on the maintenance screen for
  // installed PWAs) still reaches the admin login, and an admin session runs
  // the app normally so the toggle can be turned back off.
  if (maintenanceOn && sessionRole !== 'admin' && !(isAdminPath && !sessionRole)) {
    return (
      <React.Suspense fallback={<LoadingScreen />}>
        <BootSplashHider />
        <MaintenanceScreen onRevealFaculty={() => setFacultyReveal(true)} />
      </React.Suspense>
    )
  }

  // While Firebase boots we render nothing here: the instant #boot-splash overlay
  // (index.html, outside #root) is already covering the screen and keeps animating
  // continuously. The old code swapped in a React <LoadingScreen> at this point,
  // which remounted an identical splash and made its animation visibly restart
  // ("double firing"). BootSplashHider below removes the overlay once the first
  // real screen commits.
  if (!fbReady) {
    if (!bootStalled) return null
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <BootSplashHider />
        <ErrorState
          title="Taking longer than usual"
          text={navigator.onLine === false
            ? 'You are offline. AcadFlow will start as soon as you are back on the internet.'
            : 'Your connection may be slow. Hang on, we are still trying - or reload to start over.'}
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      </div>
    )
  }

  return (
    <React.Suspense fallback={<LoadingScreen />}>
      {/* Removes the persistent boot splash once this subtree actually commits. */}
      <BootSplashHider />
      {sessionRole === 'admin'   && <AdminLayout />}
      {sessionRole === 'student' && <StudentLayout />}
      {!sessionRole && (isAdminPath ? <AdminLoginScreen /> : <LoginScreen onRevealFaculty={() => setFacultyReveal(true)} />)}
      {/* Global Ctrl/⌘-K command palette - only when authenticated */}
      {sessionRole && <CommandPalette />}
      {/* Quick-unlock lock screen - covers the app when the session is idle-locked */}
      {sessionRole && pinLocked && <QuickUnlock />}
    </React.Suspense>
  )
}
