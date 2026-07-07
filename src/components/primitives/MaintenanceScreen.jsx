import React, { useRef } from 'react'
import { ShieldCheck, Link, KeyRound, Clock } from 'lucide-react'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'

// Maintenance screen shown while portal/publicStatus.maintenance is ON
// (professor toggle in Settings > Maintenance mode). AppRouter renders it
// instead of the student login and layouts, so no student Firestore write can
// happen during the migration freeze. The faculty door stays open: /faculty
// shows the admin login, and - for installed PWAs with no address bar - the
// same hidden gesture as the student login works here too: tap the logo 5
// times to reveal the faculty sign-in (onRevealFaculty).

const row = { display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0 }
const rowText = { fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink2)' }
const rowIcon = { flex: '0 0 auto', marginTop: 2 }

export default function MaintenanceScreen({ onRevealFaculty }) {
  // 5 taps on the logo within 2.5s = reveal the faculty sign-in (same gesture
  // as the student login screen, so the professor's muscle memory carries over).
  const taps = useRef({ n: 0, t: 0 })
  const handleLogoTap = () => {
    const now = Date.now()
    if (now - taps.current.t > 2500) taps.current.n = 0
    taps.current.t = now
    taps.current.n += 1
    if (taps.current.n >= 5) { taps.current.n = 0; onRevealFaculty?.() }
  }
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg)' }}>
      <div
        style={{
          width: '100%', maxWidth: 460, textAlign: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow)',
          padding: '40px 28px 32px',
        }}
      >
        <span onClick={handleLogoTap} style={{ display: 'inline-block', cursor: 'default', WebkitTapHighlightColor: 'transparent' }}>
          <AcadFlowLogo variant="stacked" size="sm" />
        </span>
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, margin: '18px auto 14px',
            background: 'var(--yellow-l)', color: 'var(--yellow)', fontSize: 12, fontWeight: 600,
            padding: '5px 14px', borderRadius: 999, fontFamily: 'var(--font-body)',
          }}
        >
          <Clock size={13} strokeWidth={2.4} /> Scheduled maintenance
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: '0 0 10px' }}>
          AcadFlow is moving to a new home
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.7, color: 'var(--ink2)', margin: '0 0 22px' }}>
          The portal is being migrated to a new server. Sign-in is temporarily disabled while we transfer everything.
        </p>
        <div
          style={{
            textAlign: 'left', display: 'grid', gap: 10, background: 'var(--bg2)',
            borderRadius: 'var(--radius-lg)', padding: '16px 18px', margin: '0 0 20px',
            fontFamily: 'var(--font-body)',
          }}
        >
          <p style={row}>
            <ShieldCheck size={16} style={{ ...rowIcon, color: 'var(--green)' }} />
            <span style={rowText}>Your grades, submissions, and records are safe and will carry over.</span>
          </p>
          <p style={row}>
            <Link size={16} style={{ ...rowIcon, color: 'var(--accent)' }} />
            <span style={rowText}>Your professor will share the new portal address once it is ready.</span>
          </p>
          <p style={row}>
            <KeyRound size={16} style={{ ...rowIcon, color: 'var(--ink3)' }} />
            <span style={rowText}>You will sign in with the same student number and password.</span>
          </p>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
          Questions? Ask your professor in class or through the class group chat.
        </p>
      </div>
    </div>
  )
}
