import { useState, useEffect } from 'react'

/**
 * Looping typewriter effect for multi-segment text.
 *
 * Phases per loop:
 *   1. Type all segments character-by-character (speed ms/char)
 *   2. Hold for `holdDelay` ms (30 s default)
 *   3. Delete all segments character-by-character (deleteSpeed ms/char)
 *   4. Pause for `startDelay` ms, then repeat from step 1
 *
 * @param {string | string[]} segments
 * @param {{ speed?: number, deleteSpeed?: number, startDelay?: number, holdDelay?: number }} options
 * @returns {{ displayed: string[], done: boolean }}
 *   `done` is true while the text is fully typed and being held (phase 2).
 */
export function useTypingEffect(
  segments,
  { speed = 45, deleteSpeed = 35, startDelay = 350, holdDelay = 30_000 } = {}
) {
  const parts = Array.isArray(segments) ? segments : [segments]

  const [displayed, setDisplayed] = useState(() => parts.map(() => ''))
  // `done` = fully typed (cursor hidden during hold phase)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer = null

    // Segments flattened for sequential typing/deleting
    // Each entry: { partIndex, text }
    const segs = parts.map((text, i) => ({ index: i, text }))

    function schedule(fn, delay) {
      timer = setTimeout(fn, delay)
    }

    function startCycle() {
      if (cancelled) return
      setDisplayed(parts.map(() => ''))
      setDone(false)
      typePhase(0, 0)
    }

    function typePhase(segIdx, charIdx) {
      if (cancelled) return
      if (segIdx >= segs.length) {
        // All segments fully typed — hold
        setDone(true)
        schedule(deletePhase.bind(null, segs.length - 1), holdDelay)
        return
      }
      const seg = segs[segIdx]
      const nextChar = charIdx + 1
      setDisplayed(prev => {
        const next = [...prev]
        next[seg.index] = seg.text.slice(0, nextChar)
        return next
      })
      if (nextChar >= seg.text.length) {
        // Move to next segment
        schedule(() => typePhase(segIdx + 1, 0), speed)
      } else {
        schedule(() => typePhase(segIdx, nextChar), speed)
      }
    }

    function deletePhase(segIdx) {
      if (cancelled) return
      setDone(false)
      if (segIdx < 0) {
        // All deleted — pause then restart
        schedule(startCycle, startDelay)
        return
      }
      const seg = segs[segIdx]
      deleteSeg(segIdx, seg.text.length)
    }

    function deleteSeg(segIdx, charCount) {
      if (cancelled) return
      const seg = segs[segIdx]
      const next = charCount - 1
      setDisplayed(prev => {
        const arr = [...prev]
        arr[seg.index] = seg.text.slice(0, next)
        return arr
      })
      if (next <= 0) {
        // This segment cleared — move to previous segment
        schedule(() => deletePhase(segIdx - 1), deleteSpeed)
      } else {
        schedule(() => deleteSeg(segIdx, next), deleteSpeed)
      }
    }

    // Kick off with initial delay
    timer = setTimeout(startCycle, startDelay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parts), speed, deleteSpeed, startDelay, holdDelay])

  return { displayed, done }
}
