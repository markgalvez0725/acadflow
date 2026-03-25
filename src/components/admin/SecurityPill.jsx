import React, { useState, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'

/**
 * Circle FAB shown after login, positioned left of the messenger button.
 * Auto-shows status popup on mount, collapses to icon after 4s.
 */
export default function SecurityPill() {
  const { fbReady, ejs } = useData()
  const [visible, setVisible] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (fbReady !== undefined) {
      setVisible(true)
      setPopupOpen(true)
      timerRef.current = setTimeout(() => setPopupOpen(false), 4000)
    }
    return () => clearTimeout(timerRef.current)
  }, [fbReady])

  if (dismissed || !visible) return null

  const allGood = fbReady && ejs.configured
  const statusColor = allGood ? 'green' : fbReady ? 'yellow' : 'red'

  return (
    <div className="sec-pill-wrap">
      {popupOpen && (
        <div className="sec-pill-popup">
          <div className="sec-pill-row">
            <span className={`sec-dot ${fbReady ? 'green' : 'red'}`} />
            <span className="sec-pill-text">
              Firebase {fbReady ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="sec-pill-row">
            <span className={`sec-dot ${ejs.configured ? 'green' : 'yellow'}`} />
            <span className="sec-pill-text">
              Email {ejs.configured ? 'Ready' : 'Not configured'}
            </span>
          </div>
          <button
            className="sec-pill-dismiss"
            onClick={e => { e.stopPropagation(); setDismissed(true) }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <button
        className="sec-pill"
        onClick={() => setPopupOpen(o => !o)}
        title="System Status"
      >
        🛡️
        <span className={`sec-status-dot ${statusColor}`} />
      </button>
    </div>
  )
}
