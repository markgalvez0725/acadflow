// Meeting chimes: join / leave / raise-hand, played LOCALLY on every device
// off the roster it already listens to (nothing is transmitted - the same way
// Meet does it, which is why the whole class hears a chime at once). Files
// are small synthesized bells in public/sounds/.
//
// Throttled per sound: when twenty students pile in at the start of class the
// joins collapse into one chime instead of a bell concert. Playback happens
// after the user clicked into the meeting, so autoplay policy allows it; any
// rejection is swallowed.

const MIN_GAP_MS = 1400
const _els = new Map()   // name -> HTMLAudioElement
const _last = new Map()  // name -> last play time

export function playMeetingSound(name) {
  if (typeof Audio === 'undefined') return
  const now = Date.now()
  if (now - (_last.get(name) || 0) < MIN_GAP_MS) return
  _last.set(name, now)
  try {
    let el = _els.get(name)
    if (!el) {
      el = new Audio(`/sounds/${name}.wav`)
      el.preload = 'auto'
      el.volume = 0.5
      _els.set(name, el)
    }
    el.currentTime = 0
    el.play().catch(() => { /* autoplay blocked or device muted */ })
  } catch { /* best-effort */ }
}

// Warm the cache so the first chime is not late.
export function preloadMeetingSounds() {
  if (typeof Audio === 'undefined') return
  for (const name of ['join', 'leave', 'hand']) {
    if (!_els.has(name)) {
      try {
        const el = new Audio(`/sounds/${name}.wav`)
        el.preload = 'auto'
        el.volume = 0.5
        _els.set(name, el)
      } catch { /* best-effort */ }
    }
  }
}
