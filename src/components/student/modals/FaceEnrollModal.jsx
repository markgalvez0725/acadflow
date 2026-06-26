import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { useUI } from '@/context/UIContext'
import { getIdToken } from '@/firebase/firebaseInit'
import { ScanFace, Lock, Check, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  loadFaceModels, startCamera, stopStream, detectOnce, videoReady,
  eyeAspect, headYaw, descriptorArray, averageDescriptors, friendlyCameraError,
  LIVENESS, SAMPLES, CHALLENGES, TIMING,
} from '@/utils/faceId'

export default function FaceEnrollModal({ student, onClose }) {
  const { toast } = useUI()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('init')
  const runIdRef = useRef(0) // abort token — supersedes any in-flight begin()

  // liveness + capture accumulators + timers (refs so the loop reads fresh values)
  const sawOpenRef = useRef(false)
  const blinkRef = useRef(0)
  const yawSeenRef = useRef(false)
  const samplesRef = useRef([])
  const loopStartRef = useRef(0)
  const challengeStartRef = useRef(0)
  const switchedRef = useRef(false)
  const challengeRef = useRef(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])

  const [phase, setPhase] = useState('init') // init|position|challenge|capturing|saving|done|error
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [, setChallengeLabel] = useState(challengeRef.current.prompt)

  const go = (p) => { stateRef.current = p; setPhase(p) }
  const setChallenge = (ch) => { challengeRef.current = ch; setChallengeLabel(ch.prompt) }

  const cleanup = useCallback(() => {
    runIdRef.current++ // any in-flight begin() is now stale and must bail
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  async function save(descriptor) {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    go('saving'); setMsg('Saving your face signature…')
    try {
      const idToken = await getIdToken()
      if (!idToken) throw new Error('Your session expired. Please sign in again.')
      const r = await fetch('/api/enroll-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, descriptor }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Could not save your face. Please try again.')
      stopStream(streamRef.current); streamRef.current = null
      go('done')
      toast('Face ID password reset is set up.', 'success')
    } catch (e) {
      setErr(e.message || 'Enrollment failed.'); go('error')
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

      // capturing
      const arr = descriptorArray(det)
      if (arr) samplesRef.current.push(arr)
      if (samplesRef.current.length >= SAMPLES) await save(averageDescriptors(samplesRef.current))
    } catch { /* transient frame error — keep looping */ }
    finally { busyRef.current = false }
  }

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
      if (myRun !== runIdRef.current) { stopStream(stream); return } // superseded mid-await → don't leak
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
  useEffect(() => { begin() }, [begin])

  return (
    <Modal onClose={onClose} size="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="text-base font-bold text-ink">Set up Face ID reset</h3>
      </div>
      <p className="text-xs text-ink2" style={{ marginBottom: 14 }}>
        Enroll your face once so you can reset your own password later — no teacher needed.
      </p>

      {phase === 'done' ? (
        <div style={{ textAlign: 'center', padding: '18px 8px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-l)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Check size={28} style={{ color: 'var(--green)' }} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Face ID reset is ready</div>
          <p className="text-xs text-ink3" style={{ marginBottom: 18 }}>
            If you ever forget your password, choose “Reset with Face ID” on the login screen.
          </p>
          <button className="btn btn-primary w-full" onClick={onClose}>Done</button>
        </div>
      ) : phase === 'error' ? (
        <div style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--red-l)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <AlertTriangle size={26} style={{ color: 'var(--red)' }} />
          </div>
          <p className="text-sm text-ink" style={{ marginBottom: 16, lineHeight: 1.5 }}>{err}</p>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm flex-1" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm flex-1" onClick={begin}><RefreshCw size={14} style={{ marginRight: 6 }} /> Try again</button>
          </div>
        </div>
      ) : (
        <>
          <div className="faceid-cam" style={{ height: 280, marginBottom: 12 }}>
            <video ref={videoRef} autoPlay muted playsInline className="faceid-video" />
            <div className={`faceid-oval ${phase === 'capturing' ? 'is-ok' : ''}`} />
            <div className="faceid-prompt">
              {phase === 'init' || phase === 'capturing' || phase === 'saving'
                ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> {msg}</>
                : <><ScanFace size={14} style={{ marginRight: 6 }} /> {msg}</>}
            </div>
          </div>

          <div className="faceid-note" style={{ marginBottom: 12 }}>
            <Lock size={14} />
            <span>Only a math signature of your face is saved — never the photo. The camera runs entirely on your device.</span>
          </div>

          <button className="btn btn-ghost btn-sm w-full" onClick={onClose} disabled={phase === 'saving'}>Cancel</button>
        </>
      )}
    </Modal>
  )
}
