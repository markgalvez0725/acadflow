import { useState, useEffect } from 'react'

/**
 * Looping typewriter that cycles through multiple phrases.
 *
 * @param {string[][]} phrases  Array of segment-arrays, e.g.
 *   [['Line 1', '\nLine 2'], ['Other line 1', '\nOther line 2'], ...]
 * @param {{ speed?, deleteSpeed?, startDelay?, holdDelay? }} options
 * @returns {{ displayed: string[], done: boolean, phraseIndex: number }}
 *   `displayed`   - segments of the CURRENT phrase typed so far
 *   `done`        - true while fully typed & holding (cursor hidden)
 *   `phraseIndex` - which phrase is active (for keying renders)
 */
export function useTypingEffect(
  phrases,
  { speed = 45, deleteSpeed = 35, startDelay = 350, holdDelay = 30_000 } = {}
) {
  // Normalise: a single segment-array counts as one phrase
  const allPhrases = (Array.isArray(phrases[0]) ? phrases : [phrases])

  const blank = () => allPhrases[0].map(() => '')

  const [displayed, setDisplayed]   = useState(blank)
  const [done, setDone]             = useState(false)
  const [phraseIndex, setPhraseIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer     = null

    let pIdx = 0  // which phrase we're currently on

    function schedule(fn, delay) { timer = setTimeout(fn, delay) }

    function startCycle() {
      if (cancelled) return
      const parts = allPhrases[pIdx]
      setDisplayed(parts.map(() => ''))
      setDone(false)
      setPhraseIdx(pIdx)
      typePhase(parts, 0, 0)
    }

    function typePhase(parts, segIdx, charIdx) {
      if (cancelled) return
      if (segIdx >= parts.length) {
        // Fully typed - hold, then delete
        setDone(true)
        schedule(() => deletePhase(parts, parts.length - 1), holdDelay)
        return
      }
      const next = charIdx + 1
      setDisplayed(prev => {
        const arr = [...prev]
        arr[segIdx] = parts[segIdx].slice(0, next)
        return arr
      })
      if (next >= parts[segIdx].length) {
        schedule(() => typePhase(parts, segIdx + 1, 0), speed)
      } else {
        schedule(() => typePhase(parts, segIdx, next), speed)
      }
    }

    function deletePhase(parts, segIdx) {
      if (cancelled) return
      setDone(false)
      if (segIdx < 0) {
        // All deleted - advance to next phrase and restart
        pIdx = (pIdx + 1) % allPhrases.length
        schedule(startCycle, startDelay)
        return
      }
      deleteSeg(parts, segIdx, parts[segIdx].length)
    }

    function deleteSeg(parts, segIdx, charCount) {
      if (cancelled) return
      const next = charCount - 1
      setDisplayed(prev => {
        const arr = [...prev]
        arr[segIdx] = parts[segIdx].slice(0, next)
        return arr
      })
      if (next <= 0) {
        schedule(() => deletePhase(parts, segIdx - 1), deleteSpeed)
      } else {
        schedule(() => deleteSeg(parts, segIdx, next), deleteSpeed)
      }
    }

    timer = setTimeout(startCycle, startDelay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allPhrases), speed, deleteSpeed, startDelay, holdDelay])

  return { displayed, done, phraseIndex }
}

