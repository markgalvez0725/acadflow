import React, { useEffect, useRef, useState } from 'react'

// Renders a QR code via the qrcodejs CDN global (window.QRCode), matching the
// app's other CDN libraries (XLSX, jsPDF). Re-renders when `value` changes and
// degrades gracefully with a short note if the library hasn't loaded.
export default function QRCode({ value, size = 160, className, style }) {
  const ref = useRef(null)
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.QRCode)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const QR = typeof window !== 'undefined' ? window.QRCode : null
    if (!QR || !value) return
    setReady(true)
    try {
      // eslint-disable-next-line no-new
      new QR(el, {
        text: value,
        width: size,
        height: size,
        correctLevel: QR.CorrectLevel ? QR.CorrectLevel.M : undefined,
      })
    } catch (e) { /* best-effort */ }
    return () => { el.innerHTML = '' }
  }, [value, size])

  return (
    <div className={className} style={style}>
      <div
        ref={ref}
        role="img"
        aria-label="Attendance check-in QR code"
        style={{ width: size, height: size, lineHeight: 0, background: '#fff', borderRadius: 8, padding: 6 }}
      />
      {!ready && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>QR code unavailable.</div>}
    </div>
  )
}
