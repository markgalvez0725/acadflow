import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { ScanFace, Lock, Loader2, AlertTriangle, RefreshCw, ShieldAlert, ArrowRight } from 'lucide-react'
import { sanitizeSnum, validateSnum } from '@/utils/validate'
import {
  loadFaceModels, startCamera, stopStream, detectOnce, videoReady,
  eyeAspect, headYaw, descriptorArray, averageDescriptors, friendlyCameraError,
  LIVENESS, SAMPLES, CHALLENGES, TIMING,
} from '@/utils/faceId'

// Self-service password reset by face. The modal owns the student-number step so
// the camera can NEVER start without a valid number. `onMatched(tempPassword,
// studentNumber)` fires when the SERVER confirms the match (the browser never
// decides); the parent signs in with the temp password and forces a new one.
export default function FaceResetModal({ initialNumber = '', onClose, onMatched }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('number')
  const runIdRef = useRef(0)
  const snumRef = useRef('') // the confirmed student number used for the request

  const sawOpenRef = useRef(false)
  const blinkRef = useRef(0)
  const yawSeenRef = useRef(false)
  const samplesRef = useRef([])
  const loopStartRef = useRef(0)
  const challengeStartRef = useRef(0)
  const switchedRef = useRef(false)
  const challengeRef = useRef(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])

  const [phase, setPhase] = useState('number') // number|init|position|challenge|capturing|matching|nomatch|error
  const [snum, setSnum] = useState(sanitizeSnum(initialNumber || ''))
  const [numErr, setNumErr] = useState('')
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [, setChallengeLabel] = useState(challengeRef.current.prompt)

  const go = (p) => { stateRef.current = p; setPhase(p) }
  const setChallenge = (ch) => { challengeRef.current = ch; setChallengeLabel(ch.prompt) }

  const cleanup = useCallback(() => {
    runIdRef.current++
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  async function matchAndReset(descriptor) {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    go('matching'); setMsg('Matching your face…')
    try {
      const r = await fetch('/api/face-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentNumber: snumRef.current,
          descriptor,
          liveness: { passed: true, type: challengeRef.current.key },
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setErr(data.error || 'That face did not match.'); go('nomatch'); return }
      if (!r.ok) { setErr(data.error || 'Reset failed. Try again or ask your teacher.'); go('error'); return }
      if (data.tempPassword) {
        stopStream(streamRef.current); streamRef.current = null
        onMatched(data.tempPassword, snumRef.current)
      } else {
        setErr('Unexpected response from the server.'); go('error')
      }
    } catch (e) {
      setErr(e.message || 'Network error. Check your connection and try again.'); go('error')
    }
  }

  async function tick() {
    if (busyRef.current) return
    const st = stateRef.current
    if (st !== 'position' && st !== 'challenge' && st !== 'capturing') return
    busyRef.current = true
    try {
      if (Date.now() - loopStartRef.current > TIMING.OVERALL_MS) {
        setErr('Couldn’t complete the scan in time. Make sure your face is well-lit and centered, then try again.')
        go('error'); return
      }
      const v = videoRef.current
      if (!videoReady(v)) return
      const det = await detectOnce(v)
      if (!det) {
        if (st === 'position') {
          setMsg(Date.now() - loopStartRef.current > TIMING.POSITION_HINT_MS
            ? 'Make sure your face is centered and well-lit'
            : 'Center your face in the circle')
        }
        return
      }

      if (st === 'position') { challengeStartRef.current = Date.now(); go('challenge'); setMsg(challengeRef.current.prompt); return }

      if (st === 'challenge') {
        if (!switchedRef.current && Date.now() - challengeStartRef.current > TIMING.CHALLENGE_SWITCH_MS) {
          switchedRef.current = true
          const other = CHALLENGES.find(c => c.key !== challengeRef.current.key) || challengeRef.current
          setChallenge(other)
          sawOpenRef.current = false; blinkRef.current = 0; yawSeenRef.current = false
          challengeStartRef.current = Date.now()
          setMsg('Let’s try another check — ' + other.prompt)
          return
        }
        if (challengeRef.current.key === 'blink') {
          const ear = eyeAspect(det.landmarks)
          if (ear > LIVENESS.EAR_OPEN) sawOpenRef.current = true
          else if (sawOpenRef.current && ear < LIVENESS.EAR_CLOSED) { blinkRef.current += 1; sawOpenRef.current = false }
          if (blinkRef.current >= 2) { go('capturing'); setMsg('Great — hold still…') }
        } else {
          const yaw = Math.abs(headYaw(det.landmarks))
          if (yaw > LIVENESS.YAW_TURN) yawSeenRef.current = true
          else if (yawSeenRef.current && yaw < LIVENESS.YAW_BACK) { go('capturing'); setMsg('Great — hold still…') }
        }
        return
      }

      const arr = descriptorArray(det)
      if (arr) samplesRef.current.push(arr)
      if (samplesRef.current.length >= SAMPLES) await matchAndReset(averageDescriptors(samplesRef.current))
    } catch { /* transient frame error */ }
    finally { busyRef.current = false }
  }

  // Start (or restart) the camera + liveness flow. Only ever called after a
  // valid student number is confirmed.
  const begin = useCallback(async () => {
    cleanup()
    const myRun = ++runIdRef.current
    sawOpenRef.current = false; blinkRef.current = 0; yawSeenRef.current = false; samplesRef.current = []
    switchedRef.current = false
    setErr(''); go('init'); setMsg('Loading face models…')
    setChallenge(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])
    try {
      await loadFaceModels()
      if (myRun !== runIdRef.current) return
      setMsg('Starting camera…')
      const stream = await startCamera(videoRef.current)
      if (myRun !== runIdRef.current) { stopStream(stream); return }
      streamRef.current = stream
      loopStartRef.current = Date.now()
      go('position'); setMsg('Center your face in the circle')
      loopRef.current = setInterval(tick, 130)
    } catch (e) {
      if (myRun !== runIdRef.current) return
      setErr(friendlyCameraError(e)); go('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup])

  function confirmNumber(e) {
    e?.preventDefault?.()
    const clean = sanitizeSnum(snum)
    const ve = validateSnum(clean) // returns an error string, or null when valid
    if (ve) { setNumErr(ve); return }
    setNumErr(''); setSnum(clean); snumRef.current = clean
    begin()
  }

  return (
    <Modal onClose={onClose} size="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="text-base font-bold text-ink">Reset with Face ID</h3>
      </div>

      {phase === 'number' ? (
        <form onSubmit={confirmNumber}>
          <p className="text-xs text-ink2" style={{ marginBottom: 14, lineHeight: 1.55 }}>
            Enter your student number, then scan your face to reset your password — no teacher needed.
            (Only works if you set up Face ID reset beforehand.)
          </p>
          <div className="field-float">
            <input
              type="text"
              placeholder=" "
              value={snum}
              onChange={e => { setSnum(sanitizeSnum(e.target.value)); if (numErr) setNumErr('') }}
              autoComplete="off"
              autoFocus
              inputMode="text"
            />
            <label>Student Number</label>
          </div>
          {numErr && <div role="alert" className="err-msg" style={{ display: 'block', marginTop: 6 }}>{numErr}</div>}
          <button type="submit" className="btn btn-primary btn-full mt-3" disabled={!snum.trim()}>
            Continue <ArrowRight size={15} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm w-full mt-2" onClick={onClose}>Cancel</button>
        </form>
      ) : phase === 'error' || phase === 'nomatch' ? (
        <div style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: phase === 'nomatch' ? 'var(--yellow-l)' : 'var(--red-l)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            {phase === 'nomatch'
              ? <ShieldAlert size={26} style={{ color: 'var(--gold-var)' }} />
              : <AlertTriangle size={26} style={{ color: 'var(--red)' }} />}
          </div>
          <p className="text-sm text-ink" style={{ marginBottom: 16, lineHeight: 1.5 }}>{err}</p>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm flex-1" onClick={() => go('number')}>Change number</button>
            <button className="btn btn-primary btn-sm flex-1" onClick={begin}><RefreshCw size={14} style={{ marginRight: 6 }} /> Try again</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-ink2" style={{ marginBottom: 12 }}>
            Resetting the password for <strong>{snum}</strong>. Look at the camera and follow the prompt.
          </p>
          <div className="faceid-cam" style={{ height: 280, marginBottom: 12 }}>
            <video ref={videoRef} autoPlay muted playsInline className="faceid-video" />
            <div className={`faceid-oval ${phase === 'capturing' || phase === 'matching' ? 'is-ok' : ''}`} />
            <div className="faceid-prompt">
              {phase === 'init' || phase === 'capturing' || phase === 'matching'
                ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> {msg}</>
                : <><ScanFace size={14} style={{ marginRight: 6 }} /> {msg}</>}
            </div>
          </div>

          <div className="faceid-note" style={{ marginBottom: 12 }}>
            <Lock size={14} />
            <span>The match is verified on the server. Your teacher is notified of every Face ID reset.</span>
          </div>

          <button className="btn btn-ghost btn-sm w-full" onClick={onClose} disabled={phase === 'matching'}>Cancel</button>
        </>
      )}
    </Modal>
  )
}
