import React, { useEffect, useState } from 'react'
import { useUI } from '@/context/UIContext'

export default function TopLoadingBar() {
  const { isLoading } = useUI()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible]   = useState(false)
  const timerRef = React.useRef(null)
  const fadeRef  = React.useRef(null)

  useEffect(() => {
    if (isLoading) {
      setVisible(true)
      setProgress(0)

      // Quickly advance to ~80%, then slow down
      timerRef.current = setInterval(() => {
        setProgress(p => {
          if (p < 70) return p + 4
          if (p < 88) return p + 0.8
          return p
        })
      }, 60)
    } else {
      clearInterval(timerRef.current)
      setProgress(100)
      fadeRef.current = setTimeout(() => setVisible(false), 400)
    }

    return () => {
      clearInterval(timerRef.current)
      clearTimeout(fadeRef.current)
    }
  }, [isLoading])

  if (!visible) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none">
      <div
        className="h-full transition-all ease-out"
        style={{
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #3b7dd8 0%, #c8a84b 50%, #3b7dd8 100%)',
          backgroundSize: '200% 100%',
          animation: progress < 100 ? 'loadbar-shimmer 1.6s linear infinite' : 'none',
          opacity: progress === 100 ? 0 : 1,
          transition: progress === 100
            ? 'width 0.2s ease-out, opacity 0.35s ease-out 0.1s'
            : 'width 0.25s ease-out',
          boxShadow: '0 0 8px rgba(59,125,216,0.6)',
        }}
      />
    </div>
  )
}
