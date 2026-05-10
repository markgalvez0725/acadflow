import React, { useEffect, useState } from 'react'

const LETTERS = 'AcadFlow'.split('')

/**
 * Animated AcadFlow logo + wordmark.
 *
 * Props:
 *   variant  'horizontal' (default) | 'stacked'
 *   size     'sm' | 'md' | 'lg'
 *   className  extra wrapper classes
 */
export default function AcadFlowLogo({ variant = 'horizontal', size = 'md', className = '' }) {
  const [visible,   setVisible]   = useState(false)
  const [shimmered, setShimmered] = useState(false)

  useEffect(() => {
    // Stagger: logo bounces in first, then letters start falling in
    const t1 = setTimeout(() => setVisible(true),    60)
    // Shimmer fires after all letters have settled (~0.12 + 7*0.042 + 0.38 ≈ 0.8s)
    const t2 = setTimeout(() => setShimmered(true), 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const imgCls  = { sm: 'w-9  h-9',  md: 'w-12 h-12', lg: 'w-16 h-16' }[size] ?? 'w-12 h-12'
  const textCls = { sm: 'text-xl',   md: 'text-2xl',  lg: 'text-3xl'  }[size] ?? 'text-2xl'

  const logoEl = (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      className={`${imgCls} object-contain acadflow-logo-img`}
      style={{
        opacity:    visible ? 1 : 0,
        transform:  visible ? 'scale(1) translateY(0)' : 'scale(0.5) translateY(8px)',
        transition: 'opacity .55s cubic-bezier(.34,1.56,.64,1), transform .55s cubic-bezier(.34,1.56,.64,1)',
      }}
    />
  )

  const wordmarkEl = (
    <span
      className={`font-display font-bold tracking-tight ${textCls} ${shimmered ? 'acadflow-wordmark-shimmer' : 'acadflow-wordmark-base'}`}
      aria-label="AcadFlow"
    >
      {LETTERS.map((l, i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            opacity:    visible ? 1 : 0,
            transform:  visible ? 'translateY(0)' : 'translateY(12px)',
            transition: `opacity .38s ease ${0.12 + i * 0.045}s, transform .38s cubic-bezier(.34,1.56,.64,1) ${0.12 + i * 0.045}s`,
          }}
        >
          {l}
        </span>
      ))}
    </span>
  )

  if (variant === 'stacked') {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        {logoEl}
        {wordmarkEl}
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {logoEl}
      {wordmarkEl}
    </div>
  )
}
