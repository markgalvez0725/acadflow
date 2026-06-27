import React, { useId } from 'react'
// Inlined SVG markup (?raw) - the lockups render as inline <svg>, not <img src>,
// so they can't be saved as a file and stay crisp at any size. The SVGs were
// sanitized (class fills -> inline fills, unique gradient ids, no <style>) so
// several can coexist on one page without leaking styles or colliding ids.
import lhColor from '@/assets/brand/logo-horizontal.svg?raw'
import lhWhite from '@/assets/brand/logo-horizontal-white.svg?raw'
import lhMono  from '@/assets/brand/logo-horizontal-mono.svg?raw'
import lsColor from '@/assets/brand/logo-stacked.svg?raw'
import lsWhite from '@/assets/brand/logo-stacked-white.svg?raw'
import lsMono  from '@/assets/brand/logo-stacked-mono.svg?raw'
import lmColor from '@/assets/brand/logo-mark.svg?raw'
import lmWhite from '@/assets/brand/logo-mark-white.svg?raw'
import lmMono  from '@/assets/brand/logo-mark-mono.svg?raw'

const SRC = {
  horizontal: { color: lhColor, white: lhWhite, mono: lhMono },
  stacked:    { color: lsColor, white: lsWhite, mono: lsMono },
  mark:       { color: lmColor, white: lmWhite, mono: lmMono },
}
// Rendered height (px) per variant + size; width follows the viewBox ratio.
const HEIGHT = {
  horizontal: { sm: 32, md: 44, lg: 60 },
  stacked:    { sm: 64, md: 96, lg: 128 },
  mark:       { sm: 30, md: 44, lg: 60 },
}

// Make every id (and its url(#id) / href="#id" references) unique per render.
// The same lockup can appear several times on one page (mobile + desktop, plus
// the light/dark twin of tone="auto"); without this, all copies share one
// gradient id and the browser resolves url(#lh-grad) to the FIRST match - which
// may live inside a display:none copy, leaving the purple cap unpainted.
function uniquifyIds(svg, uid) {
  if (!svg || !uid) return svg
  return svg
    .replace(/id="([^"]+)"/g, (_m, id) => `id="${id}-${uid}"`)
    .replace(/url\(#([^")]+)\)/g, (_m, id) => `url(#${id}-${uid})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_m, attr, id) => `${attr}="#${id}-${uid}"`)
}

// Memoized: the sign-in screens re-render rapidly during the headline typing
// animation; without this the logo would re-render (and flicker) on every tick.
function AcadFlowLogo({ variant = 'horizontal', size = 'md', tone = 'auto', className = '' }) {
  const src = SRC[variant] || SRC.horizontal
  const h = (HEIGHT[variant] || HEIGHT.horizontal)[size] || (HEIGHT[variant] || HEIGHT.horizontal).md
  const rid = useId().replace(/[^a-zA-Z0-9]/g, '')

  if (tone === 'auto') {
    // Inline both color + white; CSS swaps them by theme so the dark wordmark
    // never disappears on a dark surface. Distinct id suffixes keep the two
    // twins (and any sibling logos) from colliding.
    return (
      <span className={`aflogo ${className}`} style={{ height: h }} role="img" aria-label="AcadFlow">
        <span className="aflogo-light" dangerouslySetInnerHTML={{ __html: uniquifyIds(src.color, `${rid}l`) }} />
        <span className="aflogo-dark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uniquifyIds(src.white, `${rid}d`) }} />
      </span>
    )
  }
  return (
    <span
      className={`aflogo aflogo-solo ${className}`}
      style={{ height: h }}
      role="img"
      aria-label="AcadFlow"
      dangerouslySetInnerHTML={{ __html: uniquifyIds(src[tone] || src.color, rid) }}
    />
  )
}

export default React.memo(AcadFlowLogo)
