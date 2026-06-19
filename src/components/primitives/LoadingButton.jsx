import React from 'react'

/**
 * Button that shows a spinner + loading text while `loading` is true.
 */
export default function LoadingButton({
  loading,
  loadingText = 'Loading…',
  children,
  className = 'btn btn-primary',
  disabled,
  ...props
}) {
  return (
    <button
      className={className}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? (
        <>
          <span className="spinner" />
          {loadingText}
        </>
      ) : children}
    </button>
  )
}
