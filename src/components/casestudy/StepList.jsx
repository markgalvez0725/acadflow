import React from 'react'
import { Check } from 'lucide-react'
import { stepState, stepMetaText, categoryColorMap, catColor, STEP_CLS } from '@/utils/caseStudyPlan'

// ── Step checklist for ONE group ─────────────────────────────────────────────
// The check-off surface under the Gantt: the professor toggles any group's
// steps; on the student side any member of the group toggles their own group.
// `onToggle(milestone, done)` does the write; status text is derived here so
// both roles always read the same truth.

export default function StepList({ plan, gid, canToggle = false, onToggle }) {
  const milestones = plan?.milestones || []
  if (!milestones.length || !gid) return null
  const colors = categoryColorMap(plan)
  const now = Date.now()

  return (
    <div className="csp-steps">
      {milestones.map(m => {
        const rec = plan?.progress?.[gid]?.[m.id]
        const st = stepState(m, rec, now)
        const isDone = st === 'done' || st === 'doneLate'
        return (
          <div key={m.id} className={`csp-step${isDone ? ' is-done' : ''}`}>
            <button
              type="button"
              className={`csp-check${isDone ? ' on' : ''}`}
              disabled={!canToggle}
              aria-label={isDone ? `Mark "${m.title}" as not done` : `Mark "${m.title}" as done`}
              title={canToggle ? (isDone ? 'Mark as not done' : 'Mark as done') : undefined}
              onClick={() => canToggle && onToggle?.(m, !isDone)}
            >
              {isDone && <Check size={11} />}
            </button>
            <span className="csp-dot" style={{ background: catColor(colors, m.category) }} />
            <div className="csp-step-main">
              <div className="csp-step-t">
                <span className="csp-step-title">{m.title}</span>
                <span className={`csp-chip csp-t-${STEP_CLS[st]}`}>{stepMetaText(m, rec, st, now)}</span>
              </div>
              {m.note && <div className="csp-step-note">Prof: {m.note}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
