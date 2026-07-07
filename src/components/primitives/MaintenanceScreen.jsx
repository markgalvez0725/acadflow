import React from 'react'
import { ShieldCheck, Link, KeyRound, Clock } from 'lucide-react'
import AcadFlowLogo from '@/components/primitives/AcadFlowLogo'

// Full-freeze maintenance screen shown while the portal is being migrated to
// its new server. Rendered by AppRouter INSTEAD of every login screen and
// layout (no session path reaches the app), so no user-initiated Firestore
// write can happen while the freeze is on. The flag lives in AppRouter
// (VITE_MAINTENANCE); lifting the freeze is one env flip or one commit.

const row = { display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0 }
const rowText = { fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink2)' }
const rowIcon = { flex: '0 0 auto', marginTop: 2 }

export default function MaintenanceScreen() {
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
        <AcadFlowLogo variant="stacked" size="sm" />
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
