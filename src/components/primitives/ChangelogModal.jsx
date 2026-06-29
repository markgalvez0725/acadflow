import React from 'react'
import Modal from '@/components/primitives/Modal'
import { Sparkles, Check } from 'lucide-react'
import { CHANGELOG } from '@/constants/changelog'

// "What's new" dialog: the full AcadFlow release history (newest first). Opened
// from the clickable version text in either sidebar. Data lives in
// src/constants/changelog.js so the version + notes stay in one place.
export default function ChangelogModal({ onClose }) {
  return (
    <Modal onClose={onClose} size="sm">
      <div className="pr-8 mb-4">
        <h3 className="text-lg font-bold text-ink font-display" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} /> What&apos;s new
        </h3>
        <p className="text-xs text-ink2 mt-1">AcadFlow release notes</p>
      </div>

      <div className="changelog-list">
        {CHANGELOG.map((rel, i) => (
          <div key={rel.version} className="changelog-rel">
            <div className="changelog-rel-head">
              <span className={`changelog-ver${i === 0 ? ' current' : ''}`}>v{rel.version}</span>
              {i === 0 && <span className="changelog-current-tag">current</span>}
              {rel.date && <span className="changelog-date">{rel.date}</span>}
            </div>
            {rel.title && <div className="changelog-title">{rel.title}</div>}
            <ul className="changelog-changes">
              {rel.changes.map((c, j) => (
                <li key={j}><Check size={13} /> <span>{c}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
