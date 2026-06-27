import React from 'react'

// The real AcadFlow brand lockups (PNG exports live in /public/brand). Picks the
// variant + size, and for tone="auto" renders both the color and all-white
// lockups, letting CSS swap them by theme so the wordmark never disappears on a
// dark surface. variant: 'horizontal' | 'stacked' | 'mark'.
const SRC = {
  horizontal: { color: '/brand/logo-horizontal.png', white: '/brand/logo-horizontal-white.png', mono: '/brand/logo-horizontal-mono.png' },
  stacked:    { color: '/brand/logo-stacked.png',    white: '/brand/logo-stacked-white.png',    mono: '/brand/logo-stacked-mono.png' },
  mark:       { color: '/brand/logo-mark.png',       white: '/brand/logo-mark-white.png',       mono: '/brand/logo-mark.png' },
}
// Rendered height (px) per variant + size; width stays auto to keep the ratio.
const HEIGHT = {
  horizontal: { sm: 28, md: 38, lg: 52 },
  stacked:    { sm: 52, md: 76, lg: 108 },
  mark:       { sm: 28, md: 40, lg: 56 },
}

export default function AcadFlowLogo({ variant = 'horizontal', size = 'md', tone = 'auto', className = '' }) {
  const src = SRC[variant] || SRC.horizontal
  const h = (HEIGHT[variant] || HEIGHT.horizontal)[size] || (HEIGHT[variant] || HEIGHT.horizontal).md
  const style = { height: h, width: 'auto', display: 'block' }

  if (tone === 'auto') {
    return (
      <span className={`aflogo ${className}`}>
        <img src={src.color} alt="AcadFlow" style={style} className="aflogo-light" />
        <img src={src.white} alt="" aria-hidden="true" style={style} className="aflogo-dark" />
      </span>
    )
  }
  return <img src={src[tone] || src.color} alt="AcadFlow" style={style} className={`aflogo ${className}`} />
}
