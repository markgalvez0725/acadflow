import React from 'react'
import { Sparkles, Cpu } from 'lucide-react'

// On-device "AI analyzer" card - a $0, deterministic synthesizer that turns the
// numbers already on the page into plain-English findings with one-tap actions.
// It recomputes from the same data the dashboard renders, so it can never
// disagree with the cards below it. Shared by the professor dashboard and the
// student overview.
const SEV = {
  danger:  'var(--red)',
  warning: 'var(--gold-var, #ca8a04)',
  success: 'var(--green)',
  info:    'var(--accent)',
}

export default function AiAnalyzer({ title = 'AI analyzer', headline, findings = [] }) {
  return (
    <div className="ai-card mb-4">
      <div className="ai-head">
        <Sparkles size={18} style={{ color: 'var(--accent)' }} />
        <span className="ai-title">{title}</span>
        <span className="ai-pill"><Cpu size={12} /> on-device · live</span>
      </div>

      {headline && <p className="ai-headline">{headline}</p>}

      {findings.length > 0 && (
        <div className="ai-find-grid">
          {findings.map((f, i) => (
            <div className="ai-find" key={i}>
              <f.Icon size={18} className="ai-find-lead" style={{ color: SEV[f.sev] || SEV.info }} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ai-find-txt">{f.text}</div>
                {f.source && <div className="ai-find-src">{f.source}</div>}
              </div>
              {f.actionLabel && (
                <button className="btn btn-sm ai-find-act" onClick={f.onAction}>{f.actionLabel}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
