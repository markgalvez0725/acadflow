import React from 'react'
import { cn } from '@/utils/cn'

// Single canonical button. Wraps the existing `.btn` CSS so every button in the
// app shares one API and one set of variants, instead of hand-rolling
// `<button className="btn btn-primary">` at ~60 call sites.
//
// It also folds in the old LoadingButton behaviour (spinner + disabled while
// loading), so there is one component to reach for.
//
// Props:
//   variant  'primary' (default) | 'secondary' | 'ghost' | 'danger' | 'success'
//   size     'sm' | 'md' (default) | 'lg'   - md/lg meet the 44px mobile target
//   loading  shows a spinner and disables the button
//   loadingText  optional label shown next to the spinner (defaults to children)
//   Icon     optional lucide icon component, rendered before the label
//   full     stretch to 100% width (the `.btn-full` modifier)
//   ...props standard <button> props (onClick, type, aria-*, etc.)
const VARIANTS = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  ghost:     'btn-ghost',
  danger:    'btn-danger',
  success:   'btn-success',
}
const SIZES = { sm: 'btn-sm', md: '', lg: 'btn-lg' }

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  Icon,
  full = false,
  type = 'button',
  disabled,
  className,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn('btn', VARIANTS[variant], SIZES[size], full && 'btn-full', className)}
      {...props}
    >
      {loading ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {loadingText ?? children}
        </>
      ) : (
        <>
          {Icon && <Icon size={16} aria-hidden="true" />}
          {children}
        </>
      )}
    </button>
  )
}
