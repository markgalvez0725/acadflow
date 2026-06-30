import React, { useId } from 'react'
import { cn } from '@/utils/cn'

// Single canonical form-field system, replacing the four that exist today
// (.field / .field-float / .input / .form-input). Each control owns its label,
// hint, and error, and the label is ALWAYS associated with the control via a
// generated id, so the "form field has no label" / "needs id or name"
// accessibility issues can never recur.
//
// Shared props (Input / Textarea / Select):
//   label  text label rendered above the control (optional but recommended)
//   hint   muted helper line below the control
//   error  error string; turns the control + hint red and sets aria-invalid
//   id     override the generated id (otherwise auto via useId)
//   ...props forwarded to the native control (value, onChange, placeholder, ...)

function useField(id, hint, error) {
  const auto = useId()
  const fid = id || auto
  const describedBy = hint || error ? `${fid}-hint` : undefined
  return { fid, describedBy }
}

function Hint({ id, hint, error }) {
  if (!hint && !error) return null
  return (
    <p id={id} className={cn('field-hint', error && 'field-hint--error')}>
      {error || hint}
    </p>
  )
}

export function Input({ label, hint, error, id, className, ...props }) {
  const { fid, describedBy } = useField(id, hint, error)
  return (
    <div className="ds-field">
      {label && <label htmlFor={fid}>{label}</label>}
      <input
        id={fid}
        className={cn('input', error && 'input--error', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      <Hint id={describedBy} hint={hint} error={error} />
    </div>
  )
}

export function Textarea({ label, hint, error, id, className, ...props }) {
  const { fid, describedBy } = useField(id, hint, error)
  return (
    <div className="ds-field">
      {label && <label htmlFor={fid}>{label}</label>}
      <textarea
        id={fid}
        className={cn('input', error && 'input--error', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      <Hint id={describedBy} hint={hint} error={error} />
    </div>
  )
}

export function Select({ label, hint, error, id, className, children, ...props }) {
  const { fid, describedBy } = useField(id, hint, error)
  return (
    <div className="ds-field">
      {label && <label htmlFor={fid}>{label}</label>}
      <select
        id={fid}
        className={cn('input', error && 'input--error', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      >
        {children}
      </select>
      <Hint id={describedBy} hint={hint} error={error} />
    </div>
  )
}

export default Input
