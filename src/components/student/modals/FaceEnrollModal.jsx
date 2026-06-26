import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { useUI } from '@/context/UIContext'
import { getIdToken } from '@/firebase/firebaseInit'
import { ScanFace, ShieldCheck, Lock, Check, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  loadFaceModels, startCamera, stopStream, detectOnce,
  eyeAspect, headYaw, descriptorArray, averageDescriptors, friendlyCameraError,
} from '@/utils/faceId'

// Liveness thresholds (tuned conservatively; see faceId.js).
const EAR_OPEN = 0.26, EAR_CLOSED = 0.18
const YAW_TURN = 0.16, YAW_BACK = 0.07
const SAMPLES = 4 // descriptors averaged for a steady signature

const CHALLENGES = [
  { key: 'blink', prompt: 'Blink slowly, twice' },
  { key: 'turn',  prompt: 'Turn your head to one side, then back' },
]

export default function FaceEnrollModal({ student, onClose }) {
  const { toast } = useUI()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('init')

  // liveness + capture accumulators (refs so the loop reads fresh values)
  const sawOpenRef = useRef(false)
  const blinkRef = useRef(0)
  const yawSeenRef = useRef(false)
  const samplesRef = useRef([])

  const [phase, setPhase] = useState('init')        // init|position|challenge|capturing|saving|done|error
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [challenge, setChallenge] = useState(() => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])

  const go = (p) => { stateRef.current = p; setPhase(p) }

  const cleanup = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const begin = useCallback(async () => {
    // reset accumulators
    sawOpenRef.current = false; blinkRef.current = 0; yawSeenRef.current = false; samplesRef.current = []
    setErr(''); go('init'); setMsg('Loading face models…')
    setChallenge(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])
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
      const det = await detectOnce(videoRef.current)
      if (!det) { if (st === 'position') setMsg('Center your face in the circle'); return }

      if (st === 'position') {
        go('challenge'); setMsg(challenge.prompt)
        return
      }

      if (st === 'challenge') {
        if (challenge.key === 'blink') {
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
        await save(averageDescriptors(samplesRef.current))
      }
    } catch { /* transient frame error — keep looping */ }
    finally { busyRef.current = false }
  }

  const showCam = phase === 'position' || phase === 'challenge' || phase === 'capturing'

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
              {phase === 'init'
                ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> {msg}</>
                : phase === 'capturing' || phase === 'saving'
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
