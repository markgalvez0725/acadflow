import React, { useState } from 'react'
import { Sparkles, CheckCircle2, AlertTriangle, AlertCircle, Info, ChevronDown } from 'lucide-react'

// Presentational card for the on-device insights engine. Pure UI: it renders
// whatever {headline, summary, items} it's given. No data logic here.
const TYPE_STYLE = {
  positive: { color: 'var(--green)',  Icon: CheckCircle2 },
  warn:     { color: 'var(--yellow)', Icon: AlertTriangle },
  risk:     { color: 'var(--red)',    Icon: AlertCircle },
  info:     { color: 'var(--accent)', Icon: Info },
}

const TONE_ACCENT = {
  good: 'var(--green)',
  warn: 'var(--yellow)',
  bad:  'var(--red)',
  info: 'var(--accent)',
}

export default function SmartInsights({
  title = 'Smart Insights',
  insights,
  collapsible = true,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!insights) return null
  const { tone = 'info', headline, summary, items = [] } = insights
  const accent = TONE_ACCENT[tone] || 'var(--accent)'

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderLeft: `3px solid ${accent}` }}>
      <button
        onClick={() => collapsible && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', padding: 0, cursor: collapsible ? 'pointer' : 'default',
          textAlign: 'left', color: 'var(--ink)',
        }}
      >
        <span style={{
          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent-l)', color: 'var(--accent)',
        }}>
          <Sparkles size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
            {title}
          </span>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
            {headline}
          </span>
        </span>
        {collapsible && (
          <ChevronDown
            size={18}
            style={{ color: 'var(--ink3)', flexShrink: 0, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        )}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {summary && (
            <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, marginBottom: items.length ? 12 : 0 }}>
              {summary}
            </p>
          )}
          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {items.map((it, i) => {
                const { color, Icon } = TYPE_STYLE[it.type] || TYPE_STYLE.info
                return (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <span style={{ color, flexShrink: 0, marginTop: 1 }}><Icon size={15} /></span>
                    <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>{it.text}</span>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Sparkles size={11} />
            Generated on your device from your data. No external AI.
          </div>
        </div>
      )}
    </div>
  )
}
