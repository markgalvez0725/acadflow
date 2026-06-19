import React, { useEffect, useState } from 'react'

const LETTERS = 'AcadFlow'.split('')

export default function AcadFlowLogo({ variant = 'horizontal', size = 'md', className = '' }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t1)
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
      className={`acadflow-wordmark font-display font-bold tracking-tight ${textCls}`}
      aria-label="AcadFlow"
    >
      {LETTERS.map((l, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            display:    'inline',
            position:   'relative',
            opacity:    visible ? 1 : 0,
            top:        visible ? '0em' : '0.28em',
            transition: `opacity .38s ease ${0.12 + i * 0.045}s, top .38s cubic-bezier(.34,1.56,.64,1) ${0.12 + i * 0.045}s`,
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
