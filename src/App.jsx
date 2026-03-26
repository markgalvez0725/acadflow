import React from 'react'
import { UIProvider } from '@/context/UIContext'
import { DataProvider } from '@/context/DataContext'
import { AuthProvider } from '@/context/AuthContext'
import AppRouter from '@/AppRouter'
import TopLoadingBar from '@/components/primitives/TopLoadingBar'

export default function App() {
  return (
    <UIProvider>
      <TopLoadingBar />
      <DataProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </DataProvider>
    </UIProvider>
  )
}
