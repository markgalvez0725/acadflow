import React from 'react'
import Modal from '@/components/primitives/Modal'
import { Camera, ScanFace, Check } from 'lucide-react'

// Prompted on every load while the account isn't fully Active — a 2-step
// checklist (verify profile → set up Face ID). Each step's button routes to the
// matching flow; the modal updates live and closes itself once both are done.
function SetupStep({ n, done, current, Icon, title, desc, cta, onCta }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 0', opacity: (!done && !current) ? 0.55 : 1 }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? 'var(--green-l)' : current ? 'var(--accent-l)' : 'var(--surface2)',
        color: done ? 'var(--green)' : current ? 'var(--accent)' : 'var(--ink3)', fontWeight: 700, fontSize: 13,
      }}>
        {done ? <Check size={16} /> : n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Icon size={15} style={{ color: done ? 'var(--green)' : 'var(--accent)' }} /> {title}
          {done && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Done</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink3)', lineHeight: 1.5, marginTop: 3 }}>{desc}</div>
        {current && !done && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 9 }} onClick={onCta}>
            <Icon size={14} style={{ marginRight: 5 }} /> {cta}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ProfileSetupModal({ step1Done, step2Done, needsPhoto, onCompleteProfile, onSetupFace, onClose }) {
  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-base font-bold text-ink" style={{ marginBottom: 4 }}>Finish setting up your account</h3>
      <p className="text-xs text-ink2" style={{ marginBottom: 6, lineHeight: 1.55 }}>
        Two quick steps to activate your account and unlock your grades, quizzes, and activities.
      </p>

      <div style={{ borderTop: '1px solid var(--border)' }}>
        <SetupStep
          n={1}
          done={step1Done}
          current={!step1Done}
          Icon={Camera}
          title="Verify your profile"
          desc={needsPhoto ? 'Add a clear profile photo and confirm your details.' : 'Confirm your details so your teacher can verify you.'}
          cta="Complete profile"
          onCta={onCompleteProfile}
        />
        <div style={{ borderTop: '1px solid var(--border)' }} />
        <SetupStep
          n={2}
          done={step2Done}
          current={step1Done && !step2Done}
          Icon={ScanFace}
          title="Set up Face ID password reset"
          desc="So you can recover your account yourself if you ever forget your password. A device with a camera is required."
          cta="Set up Face ID"
          onCta={onSetupFace}
        />
      </div>

      <button className="btn btn-ghost btn-sm w-full" style={{ marginTop: 14 }} onClick={onClose}>Later</button>
    </Modal>
  )
}
