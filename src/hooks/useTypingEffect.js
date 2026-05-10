import { useState, useEffect } from 'react'

/**
 * Animates text as if it is being typed character-by-character.
 * Supports multi-segment text: pass an array of strings to type them sequentially.
 *
 * @param {string | string[]} segments - One string or array of strings to type.
 * @param {{ speed?: number, startDelay?: number }} options
 * @returns {{ displayed: string[], done: boolean }}
 *   `displayed` has the same length as `segments`, each element typed so far.
 *   `done` is true once all segments have finished typing.
 */
export function useTypingEffect(segments, { speed = 45, startDelay = 400 } = {}) {
  const parts = Array.isArray(segments) ? segments : [segments]

  const [displayed, setDisplayed] = useState(() => parts.map(() => ''))
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed(parts.map(() => ''))
    setDone(false)

    let cancelled = false
    let delayTimer = null
    let interval = null

    const fullSequence = parts.map((p, i) => ({ text: p, index: i }))
    let segIdx = 0
    let charIdx = 0

    function tick() {
      if (cancelled) return
      const seg = fullSequence[segIdx]
      charIdx++
      setDisplayed(prev => {
        const next = [...prev]
        next[seg.index] = seg.text.slice(0, charIdx)
        return next
      })

      if (charIdx >= seg.text.length) {
        // Finished this segment; move to next
        charIdx = 0
        segIdx++
        if (segIdx >= fullSequence.length) {
          clearInterval(interval)
          setDone(true)
        }
      }
    }

    delayTimer = setTimeout(() => {
      if (cancelled) return
      interval = setInterval(tick, speed)
    }, startDelay)

    return () => {
      cancelled = true
      clearTimeout(delayTimer)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parts), speed, startDelay])

  return { displayed, done }
}
