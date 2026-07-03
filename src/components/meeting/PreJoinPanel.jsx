import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Mic, MicOff, Video, VideoOff, ChevronDown, AlertTriangle, X, Loader2 } from 'lucide-react'
import { rtcFetchParticipants, STALE_MS } from '@/firebase/rtc'

// Green room shown before entering the in-app classroom: a mirrored camera
// preview with the SAME round controls the room uses, mic/camera device
// pickers, a live mic-level check, a peek at who is already inside, and one
// Join button. Choices persist per device (localStorage) and are handed to
// the engine through onJoin(prefs) - the room then opens exactly as set here.
//
// The panel owns a private preview stream and ALWAYS stops it before joining
// (phones cannot hold the camera twice), so the engine's own getUserMedia
// never fights the preview for the device.
//
// Rendered only while useMeetingRoom idles in its 'prejoin' phase - that is,
// on deliberate room entries. Auto-reconnects, Try again, and the mini player
// never remount the engine, so they never pass through here.

const PREF_KEY = 'acadflow_prejoin'

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

export default function PreJoinPanel({ db, roomId, self, isAdmin, photo, label, onJoin, onCancel }) {
  const saved = useMemo(loadPrefs, [])
  const [micOn, setMicOn] = useState(saved.mic !== false)
  const [camOn, setCamOn] = useState(saved.cam !== false)
  const [micId, setMicId] = useState(saved.micId || '')
  const [camId, setCamId] = useState(saved.camId || '')
  const [mics, setMics] = useState([])
  const [cams, setCams] = useState([])
  const [stream, setStream] = useState(null)
  // '' = full preview | 'wait' = asking | 'cam' = camera blocked/busy | 'all' = no devices
  const [blocked, setBlocked] = useState('wait')
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const [already, setAlready] = useState(null) // null while the peek loads
  const [going, setGoing] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  // ── Preview stream (re-acquired when a picker changes) ───────────────────
  useEffect(() => {
    let dead = false
    async function acquire() {
      setBlocked('wait')
      const prev = streamRef.current
      if (prev) { prev.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } }); streamRef.current = null }
      const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      const VIDEO = { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' }
      const tries = [
        {
          audio: micId ? { ...AUDIO, deviceId: { exact: micId } } : AUDIO,
          video: camId ? { ...VIDEO, deviceId: { exact: camId } } : VIDEO,
          mode: '', clear: false,
        },
        // Chosen device unplugged since last time: fall back to defaults.
        { audio: AUDIO, video: VIDEO, mode: '', clear: true },
        // Camera blocked, busy, or missing: mic-only preview still works.
        { audio: AUDIO, video: false, mode: 'cam', clear: true },
      ]
      let got = null
      let used = null
      for (const t of tries) {
        try {
          got = await navigator.mediaDevices.getUserMedia({ audio: t.audio, video: t.video })
          used = t
          break
        } catch { got = null }
      }
      if (dead) {
        if (got) got.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } })
        return
      }
      if (!got) { setStream(null); setBlocked('all'); return }
      streamRef.current = got
      setStream(got)
      setBlocked(used.mode)
      // A fallback succeeded: drop the stale selections so the pickers tell
      // the truth (this re-runs the effect once, straight down the same path).
      if (used.clear && (micId || camId)) { setMicId(''); setCamId('') }
      // Device labels only populate after permission, so enumerate AFTER.
      try {
        const devs = await navigator.mediaDevices.enumerateDevices()
        if (dead) return
        setMics(devs.filter(d => d.kind === 'audioinput' && d.deviceId))
        setCams(devs.filter(d => d.kind === 'videoinput' && d.deviceId))
      } catch { /* pickers just stay generic */ }
    }
    acquire()
    return () => {
      dead = true
      const cur = streamRef.current
      if (cur) { cur.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } }); streamRef.current = null }
    }
  }, [micId, camId])

  // Toggles apply to the live preview tracks (video goes dark, meter stops).
  useEffect(() => {
    const s = streamRef.current
    if (!s) return
    const at = s.getAudioTracks()[0]
    if (at) at.enabled = micOn
    const vt = s.getVideoTracks()[0]
    if (vt) vt.enabled = camOn
  }, [micOn, camOn, stream])

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream || null
  }, [stream])

  // ── Mic check meter ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!stream || !micOn) { setLevel(0); return }
    const at = stream.getAudioTracks()[0]
    if (!at) { setLevel(0); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    let ac
    try { ac = new AC() } catch { return }
    try { ac.resume().catch(() => {}) } catch { /* older engines */ }
    let raf = 0
    try {
      const src = ac.createMediaStreamSource(new MediaStream([at]))
      const an = ac.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) {
          const d = Math.abs(buf[i] - 128)
          if (d > peak) peak = d
        }
        const lvl = Math.min(8, Math.round(peak / 5))
        setLevel(l => (l === lvl ? l : lvl))
        if (lvl >= 3) setHeard(true)
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* the meter is a nicety */ }
    return () => {
      cancelAnimationFrame(raf)
      try { ac.close() } catch { /* noop */ }
    }
  }, [stream, micOn])

  // ── One-shot peek at who is already in the room ───────────────────────────
  useEffect(() => {
    if (!db || !roomId) { setAlready([]); return }
    let dead = false
    rtcFetchParticipants(db, roomId)
      .then(list => {
        if (dead) return
        const now = Date.now()
        setAlready(list.filter(p => now - (p.lastSeen || 0) < STALE_MS && p.uid !== (self?.uid || '')))
      })
      .catch(() => { if (!dead) setAlready([]) })
    return () => { dead = true }
  }, [db, roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleJoin() {
    if (going) return
    setGoing(true)
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ mic: micOn, cam: camOn, micId, camId }))
    } catch { /* prefs are a nicety */ }
    // Free the devices BEFORE the engine grabs them (phones cannot hold the
    // camera twice); the engine re-acquires with the same device ids.
    const s = streamRef.current
    if (s) { s.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } }); streamRef.current = null }
    onJoin(blocked === 'all'
      ? { micOn: false, camOn: false, noMedia: true }
      : { micOn, camOn, audioId: micId || undefined, videoId: camId || undefined })
  }

  const camLive = !!stream && !!stream.getVideoTracks()[0] && camOn
  const who = already || []
  const names = who.slice(0, 2).map(p => firstName(p.name)).filter(Boolean)
  const whoText = already === null
    ? 'Checking the room…'
    : !who.length
      ? (isAdmin ? 'No one is in yet.' : 'No one is in yet - you are early.')
      : `${names.join(', ')}${who.length > names.length ? ` and ${who.length - names.length} more` : ''} ${who.length === 1 ? 'is' : 'are'} in the room${isAdmin ? ', waiting for you' : ''}.`

  return (
    <div className="mr-pre">
      <button className="mr-pre-close" onClick={onCancel} aria-label="Back without joining" title="Back without joining">
        <X size={20} />
      </button>
      <div className="mr-pre-card">
        <div className="mr-pre-stage">
          <div className="mr-pre-frame">
            <video ref={videoRef} autoPlay playsInline muted className="mr-pre-video" />
            {!camLive && (
              <div className="mr-pre-off">
                {blocked === 'wait' ? (
                  <>
                    <Loader2 size={22} className="animate-spin" />
                    <span className="mr-pre-off-note">Asking for your camera and mic…</span>
                  </>
                ) : (
                  <>
                    <span className="mr-pre-ava">{photo ? <img src={photo} alt="" /> : initials(self?.name)}</span>
                    <span className="mr-pre-off-note">
                      {blocked === 'all' ? 'Camera and mic unavailable' : blocked === 'cam' ? 'Camera blocked or busy' : 'Camera is off'}
                    </span>
                  </>
                )}
              </div>
            )}
            <span className="mr-pre-chip mr-pre-chip-tl">You</span>
            {camLive && <span className="mr-pre-chip mr-pre-chip-tr">Mirrored preview</span>}
            <div className="mr-pre-ctls">
              <button
                className={`mr-ctl${micOn && blocked !== 'all' ? '' : ' mr-ctl-off'}`}
                onClick={() => setMicOn(v => !v)}
                disabled={blocked === 'all'}
                aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
                title={micOn ? 'Turn microphone off' : 'Turn microphone on'}
              >
                {micOn && blocked !== 'all' ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
              <button
                className={`mr-ctl${camOn && camLive ? '' : ' mr-ctl-off'}`}
                onClick={() => setCamOn(v => !v)}
                disabled={blocked === 'all' || blocked === 'cam'}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                title={camOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {camOn && camLive ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>
          </div>
        </div>
        <div className="mr-pre-side">
          <div className="mr-pre-title">{isAdmin ? 'Ready to start?' : 'Ready to join?'}</div>
          <div className="mr-pre-meta">{label || 'Live class'}</div>
          {blocked === 'all' ? (
            <div className="mr-pre-blocked">
              <AlertTriangle size={16} />
              <span>
                Your camera and microphone are blocked or missing. Allow access from the camera icon in the address
                bar (or your browser's site settings), or join with both off - you can still watch and listen.
              </span>
            </div>
          ) : (
            <>
              <label className="mr-pre-dev">
                <Mic size={15} />
                <select value={micId} onChange={e => setMicId(e.target.value)} aria-label="Microphone">
                  <option value="">System default microphone</option>
                  {mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                </select>
                <ChevronDown size={14} className="mr-pre-dev-chev" />
              </label>
              {blocked !== 'cam' && (
                <label className="mr-pre-dev">
                  <Video size={15} />
                  <select value={camId} onChange={e => setCamId(e.target.value)} aria-label="Camera">
                    <option value="">System default camera</option>
                    {cams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                  </select>
                  <ChevronDown size={14} className="mr-pre-dev-chev" />
                </label>
              )}
              <div className="mr-pre-meter">
                <span className="mr-pre-meter-lab">Mic check</span>
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} className={`mr-pre-bar${micOn && level > i ? ' on' : ''}`} aria-hidden="true" />
                ))}
                <span className={`mr-pre-meter-say${micOn && heard ? ' ok' : ''}`}>
                  {!micOn ? 'Mic is off' : heard ? 'We can hear you' : 'Say something…'}
                </span>
              </div>
            </>
          )}
          <div className="mr-pre-who">
            {who.slice(0, 3).map(p => <span key={p.peerId} className="mr-pre-who-ava">{initials(p.name)}</span>)}
            <span className="mr-pre-who-text">{whoText}</span>
          </div>
          <button className="mr-pre-join" onClick={handleJoin} disabled={going}>
            {isAdmin ? (going ? 'Starting…' : 'Start class') : (going ? 'Joining…' : 'Join now')}
          </button>
          <div className="mr-pre-cap">
            {isAdmin
              ? 'Students can join the room and wait while you get set up.'
              : `Joining as ${self?.name || 'you'}`}
          </div>
        </div>
      </div>
    </div>
  )
}
