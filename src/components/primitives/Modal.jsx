import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'

/**
 * Generic modal overlay.
 * Renders via createPortal so z-index stacking contexts don't interfere.
 *
 * @param {{ isOpen: boolean, onClose: () => void, size?: 'sm'|'md'|'lg', children: React.ReactNode, zIndex?: number }} props
 */
export default function Modal({ isOpen = true, onClose, size = 'md', children, zIndex = 200, wide = false, header = null, footer = null, sheetOnMobile = false, padded = true }) {
  const panelRef = useRef(null)
  const prevFocusRef = useRef(null)

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Move focus into the dialog on open and restore it on close.
  useEffect(() => {
    if (!isOpen) return
    prevFocusRef.current = document.activeElement
    const el = panelRef.current
    if (el) {
      const focusable = el.querySelector('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])')
      ;(focusable || el).focus()
    }
    return () => {
      const prev = prevFocusRef.current
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [isOpen])

  // Trap Tab focus within the dialog.
  function handleKeyDown(e) {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = panelRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  if (!isOpen) return null

  const maxW = wide ? 'max-w-[960px]' : ({
    sm: 'max-w-[420px]',
    md: 'max-w-[500px]',
    lg: 'max-w-[700px]',
    xl: 'max-w-[900px]',
  }[size] || 'max-w-[500px]')

  // When a `header` or `footer` is supplied, the panel becomes a structured
  // shell: the header and footer stay pinned and only the middle body scrolls.
  // Modals that pass plain children (the long-standing pattern) are unaffected -
  // they keep the single padded scroll area.
  const structured = !!(header || footer)

  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4${sheetOnMobile ? ' modal-overlay-sheet' : ''}`}
      style={{ background: 'rgba(10,20,50,.55)', zIndex, backdropFilter: 'blur(4px)' }}
    >
      {/* Backdrop click intentionally does NOT close - use the X (or Esc). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`glass-panel bg-surface border border-border rounded-lg w-full ${maxW} max-h-[90vh] shadow-lg${sheetOnMobile ? ' modal-sheet' : ''}`}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none' }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="modal-close-btn"
          >
            <X size={18} />
          </button>
        )}
        {header && <div className="modal-head">{header}</div>}
        <div className="modal-scroll" style={{ overflowY: 'auto', padding: structured ? 0 : 28, ...(structured ? { flex: '1 1 auto', minHeight: 0 } : {}) }}>
          {structured && padded ? <div className="modal-shell-body">{children}</div> : children}
        </div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

// Note: the close (X) button now lives on the Modal panel itself, so every
// modal gets exactly one consistent control. `onClose` is accepted for
// backwards-compatibility but no longer renders a second X here. `pr-8`
// reserves room so a long title doesn't run under the panel's X.
export function ModalHeader({ icon, title, subtitle, flush = false }) {
  return (
    <div className={`${flush ? '' : 'mb-5 '}pr-8 flex items-start gap-2.5`}>
      {icon && <span className="modal-head-ic">{icon}</span>}
      <div className="min-w-0">
        <h3 className="text-lg font-bold text-ink font-display">{title}</h3>
        {subtitle && <p className="text-xs text-ink2 mt-1">{subtitle}</p>}
      </div>
    </div>
  )
}

export function ModalFooter({ children }) {
  return (
    <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-border">
      {children}
    </div>
  )
}
