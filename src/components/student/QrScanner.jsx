import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Camera } from 'lucide-react'

// Camera QR scanner (getUserMedia + window.jsQR). Calls onResult(text) once a
// code is decoded. Degrades gracefully when the camera is unavailable or
// permission is denied — the caller keeps a manual PIN entry as the fallback.
export default function QrScanner({ onResult, onClose, title = 'Scan QR to join' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const streamRef = useRef(null)
  const doneRef = useRef(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false

    function cleanup() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }

    function tick() {
      const v = videoRef.current, c = canvasRef.current
      if (!v || !c || doneRef.current) return
      if (v.readyState === v.HAVE_ENOUGH_DATA && window.jsQR) {
        c.width = v.videoWidth; c.height = v.videoHeight
        const ctx = c.getContext('2d')
        ctx.drawImage(v, 0, 0, c.width, c.height)
        try {
          const img = ctx.getImageData(0, 0, c.width, c.height)
          const code = window.jsQR(img.data, img.width, img.height)
          if (code && code.data) {
            doneRef.current = true
            cleanup()
            onResult(String(code.data).trim())
            return
          }
        } catch (e) { /* keep scanning */ }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('Camera not available on this device.'); return }
      if (!window.jsQR) { setErr('Scanner failed to load. Enter the PIN instead.'); return }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        v.srcObject = stream
        v.setAttribute('playsinline', 'true')
        await v.play()
        tick()
      } catch (e) {
        setErr(e?.name === 'NotAllowedError'
          ? 'Camera permission denied — enter the PIN instead.'
          : 'Could not open the camera. Enter the PIN instead.')
      }
    }

    start()
    return () => { cancelled = true; cleanup() }
  }, [])

  return createPortal(
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="onb-card" style={{ textAlign: 'center', maxWidth: 360 }}>
        <button className="onb-skip" onClick={onClose} aria-label="Close scanner"><X size={16} /></button>
        <div className="onb-title" style={{ marginBottom: 12 }}>{title}</div>
        {err ? (
          <div style={{ padding: '12px 4px' }}>
            <Camera size={28} style={{ color: 'var(--ink3)' }} />
            <div className="err-msg" style={{ marginTop: 8 }}>{err}</div>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
            <div style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,.9)', borderRadius: 12, boxShadow: '0 0 0 100vmax rgba(0,0,0,.25)' }} />
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body
  )
}
