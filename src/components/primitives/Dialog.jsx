import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useUI } from '@/context/UIContext'
import { Info, CheckCircle2, AlertTriangle } from 'lucide-react'

const ICONS = {
  info:    Info,
  success: CheckCircle2,
  danger:  AlertTriangle,
  warning: AlertTriangle,
}

export default function Dialog() {
  const { dialog, resolveDialog } = useUI()
  const confirmRef = useRef(null)

  // Focus the primary action and allow Escape to cancel.
  useEffect(() => {
    if (!dialog) return
    confirmRef.current?.focus()
    const handler = e => { if (e.key === 'Escape') resolveDialog(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dialog, resolveDialog])

  if (!dialog) return null

  const { title, msg, type = 'info', confirmLabel = 'OK', cancelLabel = 'Cancel', showCancel = false } = dialog

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay-scrim, rgba(10,20,50,.55))', zIndex: 1200, backdropFilter: 'blur(4px)' }}
    >
      {/* Backdrop click no longer dismisses - use the Cancel/confirm buttons. */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="glass-panel bg-surface border border-border w-full max-w-[420px] overflow-hidden"
        style={{ borderRadius: 18, animation: 'dialogPop .22s cubic-bezier(.22,.8,.38,1) both' }}
      >
        <div className="dlg-body">
          <div className={`dlg-icon-wrap dlg-${type}`} aria-hidden="true">
            {(() => { const I = ICONS[type] || Info; return <I size={26} /> })()}
          </div>
          <div className="dlg-text">
            <div className="dlg-title">{title}</div>
            {msg && <div className="dlg-msg">{msg}</div>}
          </div>
        </div>
        <div className="dlg-footer">
          {showCancel && (
            <button
              className="btn btn-ghost"
              onClick={() => resolveDialog(false)}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => resolveDialog(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
