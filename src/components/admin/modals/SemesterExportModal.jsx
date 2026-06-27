import React, { useState } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { Sparkles, AlertTriangle, Cpu } from 'lucide-react'

/**
 * On-device semester check shown before a student-level export when the
 * student's grades span more than one semester. Deterministic - the analysis is
 * computed by analyzeStudentSemesters() and passed in; this only renders it.
 *
 * Props:
 *  - student   {object}
 *  - analysis  {object}  from analyzeStudentSemesters()
 *  - kind      {string}  e.g. 'report card' / 'student report'
 *  - onConfirm {(key:string) => void}  key = a semester label or 'all'
 *  - onClose   {() => void}
 */
export default function SemesterExportModal({ student, analysis, kind = 'report card', onConfirm, onClose }) {
  const [key, setKey] = useState(analysis?.recommended || 'all')

  const groups = analysis?.groups || []
  const allSubjects = [...new Set(groups.flatMap(g => g.subjects))]
  const allGraded = groups.reduce((n, g) => n + g.gradedCount, 0)
  const options = [
    ...groups.map(g => ({
      key: g.label, label: g.isCurrent ? 'Current semester' : 'Past semester',
      term: g.label, isCurrent: g.isCurrent, subjects: g.subjects, count: g.gradedCount,
    })),
    { key: 'all', label: 'All semesters', term: 'Everything on record, grouped by term', isCurrent: false, all: true, subjects: allSubjects, count: allGraded },
  ]
  const sel = options.find(o => o.key === key)
  const selIsPast = sel && !sel.all && !sel.isCurrent

  return (
    <Modal onClose={onClose} size="md" zIndex={1200}>
      <ModalHeader
        title={`Export ${kind}`}
        subtitle={student?.name || ''}
        onClose={onClose}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--accent-l)', borderRadius: 10, padding: '11px 13px', margin: '4px 2px 14px' }}>
        <Cpu size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--accent)', lineHeight: 1.55 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, marginRight: 4 }}>
            <Sparkles size={12} /> On-device check:
          </span>
          {analysis?.narration || 'Pick a term to export.'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map(o => {
          const selected = o.key === key
          const recommended = o.key === analysis?.recommended
          const empty = !o.count
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => !empty && setKey(o.key)}
              disabled={empty}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 11, textAlign: 'left', width: '100%',
                border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: selected ? 'var(--accent-l)' : 'var(--surface)',
                opacity: empty ? 0.55 : 1, cursor: empty ? 'not-allowed' : 'pointer',
                borderRadius: 10, padding: '12px 14px',
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2, border: `2px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{o.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: recommended ? 'var(--accent-l)' : 'var(--surface2)', color: recommended ? 'var(--accent)' : 'var(--ink3)' }}>
                    {recommended ? 'Recommended · ' : ''}{o.count} subject{o.count === 1 ? '' : 's'}
                  </span>
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
                  {o.all ? o.term : `${o.term}${empty ? ' · nothing to export yet' : ' · ' + o.subjects.slice(0, 4).join(', ')}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selIsPast && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--yellow-l)', color: 'var(--yellow-d, #854d0e)', fontSize: 11.5, borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>You're exporting a <strong>past semester</strong> ({sel.term}). The header will show that term, not the current one.</span>
        </div>
      )}

      <div className="modal-footer" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onConfirm?.(key)} disabled={!sel || !sel.subjects.length}>
          Export PDF
        </button>
      </div>
    </Modal>
  )
}
