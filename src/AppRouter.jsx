import React from 'react'
import { useAuth } from '@/context/AuthContext'

// Screens — imported lazily to keep initial bundle small
const LoginScreen      = React.lazy(() => import('@/components/auth/LoginScreen'))
const AdminLoginScreen = React.lazy(() => import('@/components/auth/AdminLoginScreen'))
const AdminLayout      = React.lazy(() => import('@/components/admin/AdminLayout'))
const StudentLayout    = React.lazy(() => import('@/components/student/StudentLayout'))

export default function AppRouter() {
  const { sessionRole } = useAuth()
  const isAdminPath = window.location.pathname.startsWith('/admin')

  return (
    <React.Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-bg text-ink2 text-sm">Loading…</div>}>
      {sessionRole === 'admin'   && <AdminLayout />}
      {sessionRole === 'student' && <StudentLayout />}
      {!sessionRole && (isAdminPath ? <AdminLoginScreen /> : <LoginScreen />)}
    </React.Suspense>
  )
}
