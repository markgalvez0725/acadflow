import React, { useEffect, useState } from 'react'

const LETTERS = 'AcadFlow'.split('')

// Sparkle specs: position around the wordmark text
// Mix of accent (indigo) and purple for colour variety
const SPARKLES = [
  { style: { top: '-11px', left:  '0%'    }, sz: 10, delay: '1.05s', clr: 'var(--accent)' },
  { style: { top:  '-7px', left:  '17%'   }, sz:  6, delay: '1.35s', clr: 'var(--purple)' },
  { style: { top: '-15px', left:  '40%'   }, sz: 13, delay: '1.15s', clr: 'var(--accent)' },
  { style: { top:  '-9px', right: '21%'   }, sz:  8, delay: '1.28s', clr: 'var(--purple)' },
  { style: { top: '-13px', right:  '2%'   }, sz: 11, delay: '1.08s', clr: 'var(--accent)' },
  { style: { bottom: '-8px', left:  '30%' }, sz:  7, delay: '1.42s', clr: 'var(--accent)' },
  { style: { bottom:'-10px', right: '26%' }, sz:  9, delay: '1.20s', clr: 'var(--purple)' },
]

/**
 * Animated AcadFlow logo + wordmark.
 *
 * Props:
 *   variant  'horizontal' (default) | 'stacked'
 *   size     'sm' | 'md' | 'lg'
 *   className  extra wrapper classes
 *
 * Implementation notes:
 *   – Letter spans use display:inline + position:relative/top so that the parent's
 *     background-clip:text paints through them (inline-block breaks background-clip).
 *   – The wordmark gradient is always present; a CSS animation sweeps the
 *     background-position once from the ink zone into the brand-colour zone.
 *   – Sparkle particles appear after the letters settle and twinkle continuously.
 */
export default function AcadFlowLogo({ variant = 'horizontal', size = 'md', className = '' }) {
  const [visible, setVisible] = useState(false)
  const [sparkle, setSparkle] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true),  60)   // logo + letters start
    const t2 = setTimeout(() => setSparkle(true), 980)   // after letters settle
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
    // Wrapper uses relative+inline-block to contain both the glow layer and wordmark.
    // CRITICAL: No `filter` on any ancestor of the wordmark span — filter on a parent
    // breaks -webkit-background-clip:text in Safari/WebKit.
    // Instead, a sibling blurred span provides the glow/shadow (filter on itself = safe).
    <span className="relative inline-block">
      {/* Glow shadow layer — filter:blur on THIS element, not on an ancestor.
          This avoids the Safari bug where parent filter breaks background-clip:text. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 font-display font-bold tracking-tight pointer-events-none select-none ${textCls}`}
        style={{
          opacity:             visible ? 0.7 : 0,
          transition:          'opacity 0.8s ease 0.6s',
          background:          'linear-gradient(90deg,#a78bfa 0%,#818cf8 35%,#c4b5fd 50%,#818cf8 65%,#a78bfa 100%)',
          backgroundSize:      '250% 100%',
          backgroundPosition:  '0% center',
          WebkitBackgroundClip:'text',
          backgroundClip:      'text',
          WebkitTextFillColor: 'transparent',
          filter:              'blur(14px)',
          animation:           'acadflow-wordmark-flow 5s ease-in-out 0.1s infinite',
          whiteSpace:          'nowrap',
          lineHeight:          'inherit',
        }}
      >
        AcadFlow
      </span>

      {/* Actual wordmark — no ancestor has filter, so background-clip:text works correctly */}
      <span
        className={`relative inline-block acadflow-wordmark font-display font-bold tracking-tight ${textCls}`}
        aria-label="AcadFlow"
      >
        {LETTERS.map((l, i) => (
          // display:inline (NOT inline-block) keeps background-clip:text working
          // position:relative + top provides the drop-in stagger effect
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

        {/* Sparkle particles — positioned absolutely outside letter bounds */}
        {sparkle && SPARKLES.map((sp, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="acadflow-sparkle"
            style={{
              width:          sp.sz,
              height:         sp.sz,
              background:     sp.clr,
              animationDelay: sp.delay,
              ...sp.style,
            }}
          />
        ))}
      </span>
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
