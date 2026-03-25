import React from 'react'
import { UIProvider } from '@/context/UIContext'
import { DataProvider } from '@/context/DataContext'
import { AuthProvider } from '@/context/AuthContext'
import AppRouter from '@/AppRouter'

export default function App() {
  return (
    <UIProvider>
      <DataProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </DataProvider>
    </UIProvider>
  )
}
