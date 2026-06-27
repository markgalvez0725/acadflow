import React, { useState, useRef } from 'react'
import { KeyRound, Camera, ScanFace, Check, ShieldCheck, MessageSquare, Sparkles } from 'lucide-react'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import EditProfileModal from './EditProfileModal'
import FaceEnrollModal from './FaceEnrollModal'
import ForceChangePasswordModal from './ForceChangePasswordModal'
import {
  applicableSteps, activeStep, stepViews, verificationGuidance, firstNameOf,
} from '@/utils/verificationGuide'

// Guided, step-by-step account verification - the single home for everything a
// student must do to become Active (own password → complete profile → identity
// check → Face-ID enrollment → verified badge). Lives as a panel inside the
// shared SettingsShell. Each step REUSES its existing modal in `embedded` mode;
// this component only narrates (on-device AI guidance) and advances. Advancement
// is driven by LIVE student state from the roster listener - when a step's write
// lands (e.g. faceResetEnabled flips), the active step recomputes automatically.

const ICONS = { KeyRound, Camera, ScanFace }

function Stepper({ views }) {
  const dot = status => ({
    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700,
    background: status === 'done' ? 'var(--green)' : status === 'current' ? 'var(--accent)' : 'var(--surface2)',
    color: status === 'done' || status === 'current' ? '#fff' : 'var(--ink3)',
    border: status === 'todo' ? '1px solid var(--border)' : 'none',
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
      {views.map((v, i) => {
        const Icon = ICONS[v.icon]
        return (
          <React.Fragment key={v.key}>
            <div style={dot(v.status)} title={v.label}>
              {v.status === 'done' ? <Check size={14} /> : (Icon ? <Icon size={13} /> : i + 1)}
            </div>
            {i < views.length - 1 && (
              <div style={{ flex: 1, height: 2, background: v.status === 'done' ? 'var(--green)' : 'var(--border)' }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Bubble({ tone, text }) {
  const map = {
    accent:  { bg: 'var(--accent-l)', fg: 'var(--accent)', bd: 'var(--accent)' },
    warn:    { bg: 'var(--yellow-l)', fg: 'var(--yellow)', bd: 'var(--yellow)' },
    success: { bg: 'var(--green-l)',  fg: 'var(--green)',  bd: 'var(--green)' },
  }
  const c = map[tone] || map.accent
  return (
    <div style={{ display: 'flex', gap: 9, padding: 12, background: c.bg, border: `1px solid ${c.bd}33`, borderRadius: 12, marginBottom: 16 }}>
      <Sparkles size={17} style={{ color: c.fg, flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12.5, lineHeight: 1.55, color: c.fg }}>{text}</span>
    </div>
  )
}

function Congrats({ student, onDone }) {
  const fn = firstNameOf(student?.name)
  const CONFETTI = Array.from({ length: 16 })
  return (
    <div style={{ position: 'relative', textAlign: 'center', padding: '28px 12px 8px', overflow: 'hidden' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {CONFETTI.map((_, i) => (
          <span key={i} style={{
            position: 'absolute', top: -8, left: `${(i * 61) % 100}%`,
            width: 7, height: 7, borderRadius: 2,
            background: ['var(--accent)', 'var(--green)', 'var(--yellow)', '#1d9bf0'][i % 4],
            animation: `vcFall ${2.2 + (i % 5) * 0.35}s linear ${(i % 8) * 0.12}s infinite`,
          }} />
        ))}
      </div>
      <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--green-l)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', position: 'relative' }}>
        <ShieldCheck size={44} style={{ color: 'var(--green)' }} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>You're verified{fn ? `, ${fn}` : ''}!</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{student?.name || 'Student'}</span>
        <VerifiedBadge student={student} size={18} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 auto 22px', maxWidth: 320 }}>
        {verificationGuidance(student, 'done').text}
      </p>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Let's go</button>
      <style>{`@keyframes vcFall{to{transform:translateY(360px) rotate(220deg);opacity:.2}}`}</style>
    </div>
  )
}

export default function VerificationCenter({ student, onDone, onContact }) {
  const [triedVerify, setTriedVerify] = useState(false)
  const frozen = useRef(applicableSteps(student)).current
  const active = activeStep(student, { triedVerify })
  const views = stepViews(student, frozen, active)
  const guide = verificationGuidance(student, active)

  if (active === 'done') return <Congrats student={student} onDone={onDone} />

  return (
    <div>
      <Stepper views={views} />
      <Bubble tone={guide.tone} text={guide.text} />
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 12 }}>{guide.title}</div>

      <div key={active} style={{ animation: 'vcPush .22s ease both' }}>
        {active === 'password' && (
          <ForceChangePasswordModal embedded hideCancel student={student} onClose={() => {}} />
        )}
        {active === 'profile' && (
          <EditProfileModal embedded hideCancel student={student} onClose={() => setTriedVerify(true)} />
        )}
        {active === 'awaiting' && (
          <div style={{ textAlign: 'center', padding: '4px 4px 8px' }}>
            <button className="btn btn-ghost btn-sm" onClick={onContact}>
              <MessageSquare size={14} style={{ marginRight: 6 }} /> Message your teacher
            </button>
          </div>
        )}
        {active === 'face' && (
          <FaceEnrollModal embedded hideCancel student={student} onClose={() => {}} />
        )}
      </div>

      <style>{`@keyframes vcPush{from{transform:translateX(20px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  )
}
