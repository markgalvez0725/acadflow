import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { useUI } from '@/context/UIContext'
import { getIdToken } from '@/firebase/firebaseInit'
import { ScanFace, Lock, Check, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  loadFaceModels, startCamera, stopStream, detectOnce, videoReady,
  descriptorArray, faceQuality, buildSignature, friendlyCameraError, createLivenessTracker,
  ENROLL, TIMING,
} from '@/utils/faceId'

const LIVENESS_PROMPT = 'Slowly turn your head a little, or blink'

export default function FaceEnrollModal({ student, onClose }) {
  const { toast } = useUI()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('init')
  const runIdRef = useRef(0)
  const liveRef = useRef(createLivenessTracker())
  const samplesRef = useRef([])
  const loopStartRef = useRef(0)

  const [phase, setPhase] = useState('init') // init|position|challenge|capturing|saving|done|error
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')

  const go = (p) => { stateRef.current = p; setPhase(p) }

  const cleanup = useCallback(() => {
    runIdRef.current++
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
        setErr('Couldn’t complete the scan in time. Move somewhere brighter, center your face, and try again.')
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

      if (st === 'position') { liveRef.current.reset(); go('challenge'); setMsg(LIVENESS_PROMPT); return }

      if (st === 'challenge') {
        const r = liveRef.current.update(det.landmarks)
        if (r.passed) { samplesRef.current = []; go('capturing'); setMsg('Great — look straight ahead and hold still…') }
        return
      }

      // capturing — keep only high-quality, eyes-open, frontal frames, then build
      // an outlier-rejected signature. A noisy frame is skipped (with a hint),
      // never averaged in, so the stored signature reliably matches at reset.
      const q = faceQuality(det, v)
      if (q.ok) {
        const arr = descriptorArray(det)
        if (arr) samplesRef.current.push(arr)
        setMsg(`Hold still — captured ${Math.min(samplesRef.current.length, ENROLL.TARGET)} of ${ENROLL.TARGET}`)
      } else if (q.hint) {
        setMsg(q.hint)
      }

      const n = samplesRef.current.length
      if (n >= ENROLL.TARGET) {
        const sig = buildSignature(samplesRef.current, { minInliers: ENROLL.MIN_INLIERS, maxSpread: ENROLL.MAX_SPREAD })
        if (sig) { await save(sig.descriptor); return }
        // Not consistent enough yet. Keep collecting; near the cap, accept the
        // densest cluster with relaxed bounds rather than failing a real student.
        if (n >= ENROLL.HARD_CAP) {
          const relaxed = buildSignature(samplesRef.current, { minInliers: 3, maxSpread: 0.6 })
          if (relaxed) { await save(relaxed.descriptor); return }
          samplesRef.current = samplesRef.current.slice(-ENROLL.TARGET) // drop oldest, keep trying until timeout
        }
      }
    } catch { /* transient frame error — keep looping */ }
    finally { busyRef.current = false }
  }

  const begin = useCallback(async () => {
    cleanup()
    const myRun = ++runIdRef.current
    liveRef.current.reset(); samplesRef.current = []
    setErr(''); go('init'); setMsg('Loading face models…')
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
