import React from 'react'
import ReactDOM from 'react-dom'
import { useUI } from '@/context/UIContext'

const ICONS = {
  info:    '💬',
  success: '✅',
  danger:  '⚠️',
  warning: '⚠️',
}

export default function Dialog() {
  const { dialog, resolveDialog } = useUI()
  if (!dialog) return null

  const { title, msg, type = 'info', confirmLabel = 'OK', cancelLabel = 'Cancel', showCancel = false } = dialog

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,50,.55)', zIndex: 1200, backdropFilter: 'blur(4px)' }}
      onClick={() => resolveDialog(false)}
    >
      <div
        className="bg-surface border border-border w-full max-w-[420px] overflow-hidden"
        style={{ borderRadius: 18, animation: 'dialogPop .22s cubic-bezier(.22,.8,.38,1) both' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dlg-body">
          <div className={`dlg-icon-wrap dlg-${type}`}>
            {ICONS[type] || '💬'}
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
