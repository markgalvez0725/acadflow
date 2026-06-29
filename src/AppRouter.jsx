import React, { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import LoadingScreen from '@/components/primitives/LoadingScreen'

// Screens - imported lazily to keep initial bundle small
const LoginScreen      = React.lazy(() => import('@/components/auth/LoginScreen'))
const AdminLoginScreen = React.lazy(() => import('@/components/auth/AdminLoginScreen'))
const AdminLayout      = React.lazy(() => import('@/components/admin/AdminLayout'))
const StudentLayout    = React.lazy(() => import('@/components/student/StudentLayout'))
const CommandPalette   = React.lazy(() => import('@/components/primitives/CommandPalette'))
const QuickUnlock      = React.lazy(() => import('@/components/auth/QuickUnlock'))

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
  const { sessionRole, pinLocked } = useAuth()
  const { fbReady }     = useData()
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

  // While Firebase boots we render nothing here: the instant #boot-splash overlay
  // (index.html, outside #root) is already covering the screen and keeps animating
  // continuously. The old code swapped in a React <LoadingScreen> at this point,
  // which remounted an identical splash and made its animation visibly restart
  // ("double firing"). BootSplashHider below removes the overlay once the first
  // real screen commits.
  if (!fbReady) return null

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
