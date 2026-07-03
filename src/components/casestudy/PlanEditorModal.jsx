import React, { useState } from 'react'
import Modal from '@/components/primitives/Modal'
import SuggestInput from '@/components/primitives/SuggestInput'
import { Plus, Trash2, CalendarDays, Loader2 } from 'lucide-react'
import {
  seedMilestones, planId, tsToDateInput, dateInputToStart, dateInputToDue,
  DEFAULT_CATEGORIES,
} from '@/utils/caseStudyPlan'

// ── Plan timeline editor (professor) ─────────────────────────────────────────
// Edits the milestone list of a case study plan: title, free-text category
// (with quick suggestions), start/due dates, and a note the professor writes
// for the groups. Opens pre-seeded with a starter template spread between
// today and the case study's due date when no plan exists yet. Steps are
// sorted by start date on save, so row order never needs managing.

export default function PlanEditorModal({ cs, plan, onSave, onClose }) {
  const [rows, setRows] = useState(() => {
    const src = plan?.milestones?.length ? plan.milestones : seedMilestones(Date.now(), cs?.dueAt)
    return src.map(m => ({
      id: m.id || planId('m'),
      title: m.title || '',
      category: m.category || '',
      note: m.note || '',
      start: tsToDateInput(m.startAt || Date.now()),
      due: tsToDateInput(m.dueAt || m.startAt || Date.now()),
    }))
  })
  const [saving, setSaving] = useState(false)
  const seeded = !plan?.milestones?.length

  function update(i, patch) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function remove(i) {
    setRows(rs => rs.filter((_, j) => j !== i))
  }

  function addRow() {
    setRows(rs => {
      const last = rs[rs.length - 1]
      const start = last?.due || tsToDateInput(Date.now())
      return [...rs, { id: planId('m'), title: '', category: '', note: '', start, due: start }]
    })
  }

  const catSuggestions = (() => {
    const out = []
    const seen = new Set()
    ;[...rows.map(r => r.category), ...DEFAULT_CATEGORIES].forEach(c => {
      const t = String(c || '').trim()
      if (!t) return
      const k = t.toLowerCase()
      if (!seen.has(k)) { seen.add(k); out.push(t) }
    })
    return out
  })()

  const valid = rows.length > 0 && rows.every(r => r.title.trim() && r.start && r.due)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    const milestones = rows
      .map(r => {
        const startAt = dateInputToStart(r.start)
        let dueAt = dateInputToDue(r.due)
        if (dueAt < startAt) dueAt = dateInputToDue(r.start)
        return {
          id: r.id,
          title: r.title.trim(),
          category: r.category.trim(),
          note: r.note.trim(),
          startAt,
          dueAt,
        }
      })
      .sort((a, b) => a.startAt - b.startAt || a.dueAt - b.dueAt)
    try {
      await onSave(milestones)
      onClose()
    } catch (e) {
      setSaving(false)
    }
  }

  return (
    <Modal
      size="lg"
      onClose={onClose}
      icon={<CalendarDays size={18} />}
      title="Plan timeline"
      subtitle={`${cs?.title || 'Case study'} · every group follows the same steps`}
      footer={<>
        <span className="text-xs text-ink3" style={{ marginRight: 'auto' }}>Students see the steps, categories, and notes.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={save}>
          {saving ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 5 }} /> : null}
          {saving ? 'Saving...' : 'Save plan'}
        </button>
      </>}
    >
      {seeded && (
        <div className="note-banner" style={{ marginBottom: 12 }}>
          A starter plan was laid out between today and the due date. Rename, re-date, add, or remove steps to match what you have in mind.
        </div>
      )}

      <div className="csp-ed-list">
        {rows.map((r, i) => (
          <div key={r.id} className="csp-ed-row">
            <div className="csp-ed-grid">
              <div>
                <label className="label">Step {i + 1}</label>
                <input
                  className="input"
                  placeholder="Research and data gathering"
                  value={r.title}
                  onChange={e => update(i, { title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Category</label>
                <SuggestInput
                  className="input"
                  placeholder="Documentation"
                  options={catSuggestions}
                  value={r.category}
                  onChange={v => update(i, { category: v })}
                />
              </div>
            </div>
            <div className="csp-ed-grid">
              <div>
                <label className="label">Starts</label>
                <input
                  className="input"
                  type="date"
                  value={r.start}
                  onChange={e => update(i, { start: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Due</label>
                <input
                  className="input"
                  type="date"
                  value={r.due}
                  onChange={e => update(i, { due: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Note to the groups (optional)</label>
              <textarea
                className="input csp-ed-note"
                rows={2}
                placeholder="What do you expect from this step? Students see this under the step."
                value={r.note}
                onChange={e => update(i, { note: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="csp-ed-del"
              aria-label={`Remove step ${i + 1}`}
              title="Remove this step"
              onClick={() => remove(i)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={addRow}>
        <Plus size={14} style={{ marginRight: 4 }} /> Add step
      </button>
      <div className="csp-ed-hint">
        Steps are shown to every group as a Gantt timeline. Categories get a consistent color, dates drive the behind/on-track status, and members check steps off as they finish them.
      </div>
    </Modal>
  )
}
