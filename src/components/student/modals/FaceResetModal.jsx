import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { ScanFace, Lock, Loader2, AlertTriangle, RefreshCw, ShieldAlert, ArrowRight, Check } from 'lucide-react'
import { sanitizeSnum, validateSnum } from '@/utils/validate'
import {
  loadFaceModels, startCamera, stopStream, detectOnce, videoReady,
  eyeAspect, headYaw, descriptorArray, averageDescriptors, friendlyCameraError,
  LIVENESS, SAMPLES, CHALLENGES, TIMING,
} from '@/utils/faceId'

// Self-service password reset by face — fully self-contained and NON-DESTRUCTIVE.
// Flow: number → face scan (verify only) → choose a new password → one server
// call re-verifies the face AND sets the chosen password. The current password
// is only ever replaced by the one the student deliberately picks. No temp
// password, no token handoff. `onSuccess(studentNumber, newPassword)` fires once
// the server confirms the change; the parent signs in with the new password.
export default function FaceResetModal({ initialNumber = '', onClose, onSuccess }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('number')
  const runIdRef = useRef(0)
  const snumRef = useRef('')
  const descriptorRef = useRef(null) // the verified descriptor, reused for the set call

  const sawOpenRef = useRef(false)
  const blinkRef = useRef(0)
  const yawSeenRef = useRef(false)
  const samplesRef = useRef([])
  const loopStartRef = useRef(0)
  const challengeStartRef = useRef(0)
  const switchedRef = useRef(false)
  const challengeRef = useRef(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])

  const [phase, setPhase] = useState('number') // number|init|position|challenge|capturing|verifying|password|nomatch|error
  const [snum, setSnum] = useState(sanitizeSnum(initialNumber || ''))
  const [numErr, setNumErr] = useState('')
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [passErr, setPassErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [, setChallengeLabel] = useState(challengeRef.current.prompt)

  const go = (p) => { stateRef.current = p; setPhase(p) }
  const setChallenge = (ch) => { challengeRef.current = ch; setChallengeLabel(ch.prompt) }

  const cleanup = useCallback(() => {
    runIdRef.current++
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  // Step 1 — verify the face (no password change). On success → password step.
  async function verifyFace(descriptor) {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    go('verifying'); setMsg('Matching your face…')
    try {
      const r = await fetch('/api/face-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentNumber: snumRef.current, descriptor, liveness: { passed: true, type: challengeRef.current.key } }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setErr(data.error || 'That face did not match.'); go('nomatch'); return }
      if (!r.ok) { setErr(data.error || 'Reset failed. Try again or ask your teacher.'); go('error'); return }
      if (data.match) {
        stopStream(streamRef.current); streamRef.current = null
        descriptorRef.current = descriptor
        setNewPass(''); setNewPass2(''); setPassErr('')
        go('password')
      } else {
        setErr('Couldn’t verify your face. Please try again.'); go('error')
      }
    } catch (e) {
      setErr(e.message || 'Network error. Check your connection and try again.'); go('error')
    }
  }

  // Step 2 — re-verify the face AND set the chosen password in one call.
  async function submitNewPassword(e) {
    e?.preventDefault?.()
    if (newPass.length < 8) return setPassErr('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(newPass) || !/[0-9]/.test(newPass)) return setPassErr('Include at least one uppercase letter and one number.')
    if (newPass !== newPass2) return setPassErr('Passwords do not match.')
    setPassErr(''); setSaving(true)
    try {
      const r = await fetch('/api/face-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentNumber: snumRef.current,
          descriptor: descriptorRef.current,
          liveness: { passed: true, type: challengeRef.current.key },
          newPassword: newPass,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setSaving(false); setErr(data.error || 'That face did not match.'); go('nomatch'); return }
      if (!r.ok) { setSaving(false); return setPassErr(data.error || 'Could not set your password. Please try again.') }
      if (data.ok) {
        onSuccess(snumRef.current, newPass) // parent closes the modal + signs in
      } else {
        setSaving(false); setPassErr('Unexpected response. Please try again.')
      }
    } catch (e) {
      setSaving(false); setPassErr(e.message || 'Network error. Check your connection and try again.')
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
      if (samplesRef.current.length >= SAMPLES) await verifyFace(averageDescriptors(samplesRef.current))
    } catch { /* transient frame error */ }
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

  const camPhase = phase === 'init' || phase === 'position' || phase === 'challenge' || phase === 'capturing' || phase === 'verifying'

  return (
    <Modal onClose={onClose} size="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="text-base font-bold text-ink">Reset with Face ID</h3>
      </div>

      {phase === 'number' ? (
        <form onSubmit={confirmNumber}>
          <p className="text-xs text-ink2" style={{ marginBottom: 14, lineHeight: 1.55 }}>
            Enter your student number, then scan your face and choose a new password — no teacher needed.
            (Only works if you set up Face ID reset beforehand.)
          </p>
          <div className="field-float">
            <input type="text" placeholder=" " value={snum}
              onChange={e => { setSnum(sanitizeSnum(e.target.value)); if (numErr) setNumErr('') }}
              autoComplete="off" autoFocus inputMode="text" />
            <label>Student Number</label>
          </div>
          {numErr && <div role="alert" className="err-msg" style={{ display: 'block', marginTop: 6 }}>{numErr}</div>}
          <button type="submit" className="btn btn-primary btn-full mt-3" disabled={!snum.trim()}>
            Continue <ArrowRight size={15} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm w-full mt-2" onClick={onClose}>Cancel</button>
        </form>
      ) : phase === 'password' ? (
        <form onSubmit={submitNewPassword}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--green)' }}>
            <Check size={16} /> <span className="text-sm" style={{ fontWeight: 600 }}>Face verified — set your new password</span>
          </div>
          <div className="field-float">
            <input type="password" placeholder=" " value={newPass}
              onChange={e => { setNewPass(e.target.value); if (passErr) setPassErr('') }}
              autoComplete="new-password" autoFocus />
            <label>New Password</label>
          </div>
          <p className="text-xs text-ink3 -mt-1 mb-2">Min. 8 characters, 1 uppercase, 1 number.</p>
          <div className="field-float">
            <input type="password" placeholder=" " value={newPass2}
              onChange={e => { setNewPass2(e.target.value); if (passErr) setPassErr('') }}
              autoComplete="new-password" />
            <label>Confirm Password</label>
          </div>
          {passErr && <div role="alert" className="err-msg" style={{ display: 'block', marginTop: 6 }}>{passErr}</div>}
          <button type="submit" className="btn btn-primary btn-full mt-3" disabled={saving}>
            {saving ? 'Saving…' : <>Set password &amp; sign in</>}
          </button>
          <button type="button" className="btn btn-ghost btn-sm w-full mt-2" onClick={onClose} disabled={saving}>Cancel</button>
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
            Verifying <strong>{snum}</strong>. Look at the camera and follow the prompt.
          </p>
          <div className="faceid-cam" style={{ height: 280, marginBottom: 12 }}>
            <video ref={videoRef} autoPlay muted playsInline className="faceid-video" />
            <div className={`faceid-oval ${phase === 'capturing' || phase === 'verifying' ? 'is-ok' : ''}`} />
            <div className="faceid-prompt">
              {phase === 'init' || phase === 'capturing' || phase === 'verifying'
                ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> {msg}</>
                : <><ScanFace size={14} style={{ marginRight: 6 }} /> {msg}</>}
            </div>
          </div>

          <div className="faceid-note" style={{ marginBottom: 12 }}>
            <Lock size={14} />
            <span>The match is verified on the server. Your current password isn’t changed until you set a new one.</span>
          </div>

          <button className="btn btn-ghost btn-sm w-full" onClick={onClose} disabled={phase === 'verifying'}>Cancel</button>
        </>
      )}
    </Modal>
  )
}
