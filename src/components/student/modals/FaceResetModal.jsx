import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { ScanFace, Lock, Loader2, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  loadFaceModels, startCamera, stopStream, detectOnce,
  eyeAspect, headYaw, descriptorArray, averageDescriptors, friendlyCameraError,
} from '@/utils/faceId'

// Liveness thresholds — must mirror the enrollment modal.
const EAR_OPEN = 0.26, EAR_CLOSED = 0.18
const YAW_TURN = 0.16, YAW_BACK = 0.07
const SAMPLES = 4

const CHALLENGES = [
  { key: 'blink', prompt: 'Blink slowly, twice' },
  { key: 'turn',  prompt: 'Turn your head to one side, then back' },
]

// Self-service password reset by face. `onMatched(tempPassword)` is called when
// the SERVER confirms the match (the browser never decides). The parent signs in
// with the temp password and forces a new one.
export default function FaceResetModal({ studentNumber, onClose, onMatched }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('init')

  const sawOpenRef = useRef(false)
  const blinkRef = useRef(0)
  const yawSeenRef = useRef(false)
  const samplesRef = useRef([])

  const [phase, setPhase] = useState('init') // init|position|challenge|capturing|matching|nomatch|error
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [, setChallenge] = useState(() => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])
  const challengeRef = useRef(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])

  const go = (p) => { stateRef.current = p; setPhase(p) }

  const cleanup = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  const begin = useCallback(async () => {
    sawOpenRef.current = false; blinkRef.current = 0; yawSeenRef.current = false; samplesRef.current = []
    setErr(''); go('init'); setMsg('Loading face models…')
    const ch = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]
    challengeRef.current = ch; setChallenge(ch)
    try {
      await loadFaceModels()
      setMsg('Starting camera…')
      streamRef.current = await startCamera(videoRef.current)
      go('position'); setMsg('Center your face in the circle')
      if (loopRef.current) clearInterval(loopRef.current)
      loopRef.current = setInterval(tick, 130)
    } catch (e) {
      setErr(friendlyCameraError(e)); go('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { begin() }, [begin])

  async function matchAndReset(descriptor) {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    go('matching'); setMsg('Matching your face…')
    try {
      const r = await fetch('/api/face-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentNumber,
          descriptor,
          liveness: { passed: true, type: challengeRef.current.key },
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setErr(data.error || 'That face did not match.'); go('nomatch'); return }
      if (!r.ok) { setErr(data.error || 'Reset failed. Try again or ask your teacher.'); go('error'); return }
      if (data.tempPassword) {
        stopStream(streamRef.current); streamRef.current = null
        onMatched(data.tempPassword)
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
      const det = await detectOnce(videoRef.current)
      if (!det) { if (st === 'position') setMsg('Center your face in the circle'); return }

      if (st === 'position') { go('challenge'); setMsg(challengeRef.current.prompt); return }

      if (st === 'challenge') {
        if (challengeRef.current.key === 'blink') {
          const ear = eyeAspect(det.landmarks)
          if (ear > EAR_OPEN) sawOpenRef.current = true
          else if (sawOpenRef.current && ear < EAR_CLOSED) { blinkRef.current += 1; sawOpenRef.current = false }
          if (blinkRef.current >= 2) { go('capturing'); setMsg('Great — hold still…') }
        } else {
          const yaw = Math.abs(headYaw(det.landmarks))
          if (yaw > YAW_TURN) yawSeenRef.current = true
          else if (yawSeenRef.current && yaw < YAW_BACK) { go('capturing'); setMsg('Great — hold still…') }
        }
        return
      }

      // capturing
      const arr = descriptorArray(det)
      if (arr) samplesRef.current.push(arr)
      if (samplesRef.current.length >= SAMPLES) {
        await matchAndReset(averageDescriptors(samplesRef.current))
      }
    } catch { /* transient frame error */ }
    finally { busyRef.current = false }
  }

  return (
    <Modal onClose={onClose} size="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="text-base font-bold text-ink">Reset with Face ID</h3>
      </div>
      <p className="text-xs text-ink2" style={{ marginBottom: 14 }}>
        Resetting the password for <strong>{studentNumber}</strong>. Look at the camera and follow the prompt.
      </p>

      {phase === 'error' || phase === 'nomatch' ? (
        <div style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: phase === 'nomatch' ? 'var(--yellow-l)' : 'var(--red-l)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            {phase === 'nomatch'
              ? <ShieldAlert size={26} style={{ color: 'var(--gold-var)' }} />
              : <AlertTriangle size={26} style={{ color: 'var(--red)' }} />}
          </div>
          <p className="text-sm text-ink" style={{ marginBottom: 16, lineHeight: 1.5 }}>{err}</p>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm flex-1" onClick={begin}><RefreshCw size={14} style={{ marginRight: 6 }} /> Try again</button>
          </div>
        </div>
      ) : (
        <>
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
