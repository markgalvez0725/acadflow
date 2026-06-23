// Lazily load the Jitsi Meet External API (meet.jit.si) once and hand back the
// global constructor. The script is injected on first use so the ~200KB payload
// only loads when a student/teacher actually opens an embedded meeting room.

const JITSI_DOMAIN = 'meet.jit.si'
const SCRIPT_SRC = `https://${JITSI_DOMAIN}/external_api.js`

let loaderPromise = null

export function loadJitsi() {
  if (typeof window !== 'undefined' && window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI)
  }
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    // Reuse an in-flight tag if one was already injected.
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    const onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI)
      else reject(new Error('Jitsi API failed to initialise.'))
    }
    if (existing) {
      existing.addEventListener('load', onload)
      existing.addEventListener('error', () => reject(new Error('Failed to load Jitsi.')))
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI)
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = onload
    s.onerror = () => { loaderPromise = null; reject(new Error('Failed to load Jitsi.')) }
    document.body.appendChild(s)
  })
  return loaderPromise
}

// Stable, hard-to-guess room name for a meeting. Persisted on the doc when
// scheduled; this fallback keeps older meetings (created before that field)
// working since both sides derive the same name from the immutable id.
export function meetingRoomName(meeting) {
  return meeting?.roomName || `AcadFlow-${meeting?.id || 'room'}`
}

export { JITSI_DOMAIN }
