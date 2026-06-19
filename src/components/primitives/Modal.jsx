import React, { useEffect } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'

/**
 * Generic modal overlay.
 * Renders via createPortal so z-index stacking contexts don't interfere.
 *
 * @param {{ isOpen: boolean, onClose: () => void, size?: 'sm'|'md'|'lg', children: React.ReactNode, zIndex?: number }} props
 */
export default function Modal({ isOpen = true, onClose, size = 'md', children, zIndex = 200, wide = false }) {
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

  if (!isOpen) return null

  const maxW = wide ? 'max-w-[960px]' : ({
    sm: 'max-w-[420px]',
    md: 'max-w-[500px]',
    lg: 'max-w-[700px]',
    xl: 'max-w-[900px]',
  }[size] || 'max-w-[500px]')

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,50,.55)', zIndex, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className={`bg-surface border border-border rounded-lg w-full ${maxW} max-h-[90vh] overflow-y-auto shadow-lg`}
        style={{ padding: 28 }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-ink font-display">{title}</h3>
          {subtitle && <p className="text-xs text-ink2 mt-1">{subtitle}</p>}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-ink3 hover:text-ink flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
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
