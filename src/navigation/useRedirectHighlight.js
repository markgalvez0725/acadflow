import { useState, useEffect } from 'react'
import { useUI } from '@/context/UIContext'

// Generic "you landed here" highlight. A destination list calls this with its
// record type; when a redirect targets that type (via navigateToTarget), the
// matching row/card scrolls into view and glows with the SAME amber bulb the
// Stream feed uses (.redirect-glow → @keyframes ig-bulb-glow).
//
// Usage in a list component:
//   const highlightId = useRedirectHighlight('activity')
//   <div id={`activity-${a.id}`} className={cn('card', highlightId === a.id && 'redirect-glow')}>
//
// The anchor id MUST be `${type}-${id}` so the hook can scroll to it.
export function useRedirectHighlight(type) {
  const { pendingHighlight, clearHighlight } = useUI()
  const [highlightId, setHighlightId] = useState(null)

  // Claim a pending highlight meant for this type, then clear it so it fires once.
  useEffect(() => {
    if (pendingHighlight && pendingHighlight.type === type) {
      setHighlightId(String(pendingHighlight.id))
      clearHighlight()
    }
  }, [pendingHighlight, type, clearHighlight])

  // Scroll the target into view after it renders, then drop the glow. Timings
  // mirror the original Stream announcement effect (160ms settle, 2600ms glow).
  useEffect(() => {
    if (!highlightId) return
    const scrollT = setTimeout(() => {
      document.getElementById(`${type}-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 160)
    const glowT = setTimeout(() => setHighlightId(null), 2600)
    return () => { clearTimeout(scrollT); clearTimeout(glowT) }
  }, [highlightId, type])

  return highlightId
}
