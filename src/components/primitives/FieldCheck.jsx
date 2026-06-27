import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Check, Sparkles } from 'lucide-react'

const STATE = {
  ok:    { color: 'var(--green)',  Icon: CheckCircle2 },
  warn:  { color: 'var(--yellow)', Icon: AlertTriangle },
  error: { color: 'var(--red)',    Icon: XCircle },
}

/**
 * Inline smart-check feedback for one field. Pass a { state, msg } result from
 * @/utils/settingsVerify. Renders nothing when idle or empty, so quiet fields
 * stay quiet. The leading sparkle marks this as the on-device "smart check".
 */
export default function FieldCheck({ result, showIcon = true }) {
  if (!result || result.state === 'idle' || !result.msg) return null
  const m = STATE[result.state]
  if (!m) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, marginTop: 5, color: m.color }}>
      {showIcon && <m.Icon size={13} style={{ flexShrink: 0 }} />}
      <span>{result.msg}</span>
    </div>
  )
}

/**
 * Auto-save status chip. status: 'idle' | 'saving' | 'saved'. Renders nothing
 * when idle so it doesn't take space until the first save begins.
 */
export function SaveStatus({ status, style }) {
  if (status === 'saving') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent)', ...style }}>
        <Loader2 size={12} className="spin" /> Saving…
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--green)', ...style }}>
        <Check size={12} /> Saved
      </span>
    )
  }
  return null
}

/** Small "Smart check" label/legend chip for a panel header. */
export function SmartCheckTag({ style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink3)', ...style }}>
      <Sparkles size={11} /> Smart check verifies on device
    </span>
  )
}
