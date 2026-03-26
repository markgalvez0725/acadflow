import React, { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

// Screens — imported lazily to keep initial bundle small
const LoginScreen      = React.lazy(() => import('@/components/auth/LoginScreen'))
const AdminLoginScreen = React.lazy(() => import('@/components/auth/AdminLoginScreen'))
const AdminLayout      = React.lazy(() => import('@/components/admin/AdminLayout'))
const StudentLayout    = React.lazy(() => import('@/components/student/StudentLayout'))

export default function AppRouter() {
  const { sessionRole } = useAuth()
  const { fbReady }     = useData()
  const { startLoading, stopLoading } = useUI()
  const isAdminPath = window.location.pathname.startsWith('/admin')

  // Show loading bar while Firebase is initializing
  useEffect(() => {
    if (!fbReady) {
      startLoading()
    } else {
      stopLoading()
    }
  }, [fbReady])

  return (
    <React.Suspense fallback={null}>
      {sessionRole === 'admin'   && <AdminLayout />}
      {sessionRole === 'student' && <StudentLayout />}
      {!sessionRole && (isAdminPath ? <AdminLoginScreen /> : <LoginScreen />)}
    </React.Suspense>
  )
}
