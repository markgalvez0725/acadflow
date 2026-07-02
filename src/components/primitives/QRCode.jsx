import React, { useEffect, useRef, useState } from 'react'
import { waitForGlobal } from '@/utils/cdnLoader'

// Renders a QR code via the qrcodejs CDN global (window.QRCode), matching the
// app's other CDN libraries (XLSX, jsPDF). The index.html tag is deferred, so
// poll for the global and render as soon as it lands; degrades gracefully with
// a short note if the library never loads. Re-renders when `value` changes.
export default function QRCode({ value, size = 160, className, style }) {
  const ref = useRef(null)
  const [lib, setLib] = useState(() => (typeof window !== 'undefined' && window.QRCode) || null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (lib) return
    let alive = true
    waitForGlobal('QRCode', 5000)
      .then(QR => { if (alive) setLib(() => QR) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [lib])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    if (!lib || !value) return
    try {
      // eslint-disable-next-line no-new
      new lib(el, {
        text: value,
        width: size,
        height: size,
        correctLevel: lib.CorrectLevel ? lib.CorrectLevel.M : undefined,
      })
    } catch (e) { /* best-effort */ }
    return () => { el.innerHTML = '' }
  }, [lib, value, size])

  return (
    <div className={className} style={style}>
      <div
        ref={ref}
        role="img"
        aria-label="Attendance check-in QR code"
        style={{ width: size, height: size, lineHeight: 0, background: '#fff', borderRadius: 8, padding: 6 }}
      />
      {failed && !lib && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>QR code unavailable.</div>}
    </div>
  )
}
