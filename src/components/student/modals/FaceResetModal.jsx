import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from '@/components/primitives/Modal'
import { ScanFace, Lock, Loader2, AlertTriangle, RefreshCw, ShieldAlert, ArrowRight, Check } from 'lucide-react'
import { sanitizeSnum, validateSnum } from '@/utils/validate'
import {
  loadFaceModels, startCamera, stopStream, detectOnce, videoReady,
  friendlyCameraError, createFaceScan, FACE_POLICY,
} from '@/utils/faceId'

// Self-service password reset by face - self-contained and NON-DESTRUCTIVE.
// Flow: number → face scan (verify only) → choose a new password → one server
// call re-verifies the face AND sets the chosen password. No temp password, no
// token handoff. onSuccess(studentNumber, newPassword) fires once it's set.
export default function FaceResetModal({ initialNumber = '', onClose, onSuccess }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)
  const busyRef = useRef(false)
  const stateRef = useRef('number')
  const runIdRef = useRef(0)
  const snumRef = useRef('')
  const descriptorRef = useRef(null)
  const scanRef = useRef(createFaceScan())
  const loopStartRef = useRef(0)

  const [phase, setPhase] = useState('number') // number|init|position|challenge|capturing|verifying|password|nomatch|error
  const [snum, setSnum] = useState(sanitizeSnum(initialNumber || ''))
  const [numErr, setNumErr] = useState('')
  const [msg, setMsg] = useState('Loading face models…')
  const [err, setErr] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [passErr, setPassErr] = useState('')
  const [saving, setSaving] = useState(false)

  const go = (p) => { stateRef.current = p; setPhase(p) }

  const cleanup = useCallback(() => {
    runIdRef.current++
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    stopStream(streamRef.current); streamRef.current = null
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  // Step 1 - verify the face (no password change). On success → password step.
  async function verifyFace(descriptor) {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null }
    go('verifying'); setMsg('Matching your face…')
    try {
      const r = await fetch('/api/face-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentNumber: snumRef.current, descriptor, liveness: { passed: true, type: 'motion' } }),
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

  // Step 2 - re-verify the face AND set the chosen password in one call.
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
          liveness: { passed: true, type: 'motion' },
          newPassword: newPass,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setSaving(false); setErr(data.error || 'That face did not match.'); go('nomatch'); return }
      if (!r.ok) { setSaving(false); return setPassErr(data.error || 'Could not set your password. Please try again.') }
      if (data.ok) {
        onSuccess(snumRef.current, newPass)
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
      const elapsed = Date.now() - loopStartRef.current
      if (elapsed > FACE_POLICY.TIMING.OVERALL_MS) {
        setErr('Couldn’t complete the scan in time. Move somewhere brighter, center your face, and try again.')
        go('error'); return
      }
      const v = videoRef.current
      if (!videoReady(v)) return
      const det = await detectOnce(v)

      // Same centralized scanner as enrollment → the face that enrolled cleanly
      // is verified by the identical pipeline, so a real student isn't rejected.
      const out = scanRef.current.feed(det, v, elapsed)
      if ((out.phase === 'challenge' || out.phase === 'capturing') && out.phase !== stateRef.current) go(out.phase)
      if (out.msg) setMsg(out.msg)
      if (out.signature) await verifyFace(out.signature)
    } catch { /* transient frame error */ }
    finally { busyRef.current = false }
  }

  const begin = useCallback(async () => {
    cleanup()
    const myRun = ++runIdRef.current
    scanRef.current.reset()
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

  function confirmNumber(e) {
    e?.preventDefault?.()
    const clean = sanitizeSnum(snum)
    const ve = validateSnum(clean)
    if (ve) { setNumErr(ve); return }
    setNumErr(''); setSnum(clean); snumRef.current = clean
    begin()
  }

  // The reset cannot be interrupted once it's underway: no X / Escape / backdrop
  // / Cancel during the scan, verify, password, or save steps. It's only freely
  // closable before it starts (number step) or on a terminal error / no-match.
  const dismissable = phase === 'number' || phase === 'error' || phase === 'nomatch'

  return (
    <Modal onClose={dismissable ? onClose : null} size="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="text-base font-bold text-ink">Reset with Face ID</h3>
      </div>

      {phase === 'number' ? (
        <form onSubmit={confirmNumber}>
          <p className="text-xs text-ink2" style={{ marginBottom: 14, lineHeight: 1.55 }}>
            Enter your student number, then scan your face and choose a new password - no teacher needed.
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
            <Check size={16} /> <span className="text-sm" style={{ fontWeight: 600 }}>Face verified - set your new password</span>
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
            <span>Keep your face in view until it finishes - this step can’t be interrupted. Your password isn’t changed until you set a new one.</span>
          </div>
        </>
      )}
    </Modal>
  )
}
