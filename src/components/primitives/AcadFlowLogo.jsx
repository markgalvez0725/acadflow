import React from 'react'

// The real AcadFlow brand lockups (PNG exports live in /public/brand). Picks the
// variant + size, and for tone="auto" renders both the color and all-white
// lockups, letting CSS swap them by theme so the wordmark never disappears on a
// dark surface. variant: 'horizontal' | 'stacked' | 'mark'.
const SRC = {
  horizontal: { color: '/brand/logo-horizontal.svg', white: '/brand/logo-horizontal-white.svg', mono: '/brand/logo-horizontal-mono.svg' },
  stacked:    { color: '/brand/logo-stacked.svg',    white: '/brand/logo-stacked-white.svg',    mono: '/brand/logo-stacked-mono.svg' },
  mark:       { color: '/brand/logo-mark.svg',       white: '/brand/logo-mark-white.svg',       mono: '/brand/logo-mark-mono.svg' },
}
// Rendered height (px) per variant + size; width stays auto to keep the ratio.
const HEIGHT = {
  horizontal: { sm: 32, md: 44, lg: 60 },
  stacked:    { sm: 64, md: 96, lg: 128 },
  mark:       { sm: 30, md: 44, lg: 60 },
}

export default function AcadFlowLogo({ variant = 'horizontal', size = 'md', tone = 'auto', className = '' }) {
  const src = SRC[variant] || SRC.horizontal
  const h = (HEIGHT[variant] || HEIGHT.horizontal)[size] || (HEIGHT[variant] || HEIGHT.horizontal).md
  // Height drives size; width auto keeps the ratio. Display is left to CSS so
  // the light/dark swap classes can hide one without an inline override.
  const style = { height: h, width: 'auto' }

  if (tone === 'auto') {
    return (
      <span className={`aflogo ${className}`}>
        <img src={src.color} alt="AcadFlow" style={style} className="aflogo-light" />
        <img src={src.white} alt="" aria-hidden="true" style={style} className="aflogo-dark" />
      </span>
    )
  }
  return <img src={src[tone] || src.color} alt="AcadFlow" style={style} className={`aflogo aflogo-solo ${className}`} />
}
