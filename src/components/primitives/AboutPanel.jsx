import React from 'react'
import { Sparkles, Check } from 'lucide-react'
import { APP_VERSION, CHANGELOG } from '@/constants/changelog'

// "About AcadFlow / What's new" content: current version + full release history.
// Rendered both inside ChangelogModal and as a Settings/Account panel, so the
// version and notes always live in one place (src/constants/changelog.js).
export default function AboutPanel() {
  return (
    <div>
      <div className="about-head">
        <div className="about-logo"><Sparkles size={18} /></div>
        <div>
          <div className="about-title">What&apos;s new</div>
          <div className="about-sub">AcadFlow v{APP_VERSION}</div>
        </div>
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
    </div>
  )
}
