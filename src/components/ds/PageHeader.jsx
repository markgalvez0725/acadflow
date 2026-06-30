import React from 'react'

// Shared page-header pattern: optional breadcrumb, title, subtitle, and a
// right-aligned actions slot. Used at the top of tab content.
export default function PageHeader({ crumb, title, subtitle, actions, children }) {
  return (
    <div className="ds-page-head">
      <div className="ds-ph-main">
        {crumb && <div className="ds-crumb">{crumb}</div>}
        {title && <h2>{title}</h2>}
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="ds-ph-actions">{actions}</div>}
    </div>
  )
}
