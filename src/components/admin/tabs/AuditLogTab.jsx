import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import Pagination from '@/components/primitives/Pagination'
import { SkeletonRows } from '@/components/primitives/SkeletonLoader'
import { History, Search, GraduationCap, ClipboardList, Trash2, RefreshCw, ShieldCheck } from 'lucide-react'

const PER_PAGE = 12

// Map an action prefix to an icon + accent colour for quick visual scanning.
function actionVisual(action = '') {
  if (action.startsWith('grade'))    return { Icon: GraduationCap, color: 'var(--accent)' }
  if (action.startsWith('activity')) return { Icon: ClipboardList, color: 'var(--purple)' }
  if (action.startsWith('regrade'))  return { Icon: RefreshCw,     color: 'var(--green)' }
  if (action.includes('delete'))     return { Icon: Trash2,        color: 'var(--red)' }
  return { Icon: ShieldCheck, color: 'var(--ink2)' }
}

export default function AuditLogTab() {
  const { auditLog = [], fbReady } = useData()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const sorted = [...auditLog].sort((a, b) => (b.ts || 0) - (a.ts || 0))
    if (!term) return sorted
    return sorted.filter(e =>
      `${e.action || ''} ${e.target || ''} ${e.summary || ''} ${e.actor || ''}`.toLowerCase().includes(term)
    )
  }, [auditLog, q])

  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  if (!fbReady) return <SkeletonRows />

  return (
    <div className="audit-log-tab">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Audit Log</div>
        <div style={{ position: 'relative', width: 'min(280px, 50vw)' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            placeholder="Search actions…"
            aria-label="Search audit log"
            style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
          />
        </div>
      </div>

      {!filtered.length ? (
        <div className="empty">
          <div className="empty-icon"><History size={40} /></div>
          {q ? 'No matching audit entries.' : 'No audit entries yet.'}<br />
          <span style={{ fontSize: 12 }}>Grade edits, deletions, and regrade decisions are recorded here.</span>
        </div>
      ) : (
        <>
          <div className="notif-list">
            {slice.map(e => {
              const { Icon, color } = actionVisual(e.action)
              const date = new Date(e.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
              return (
                <div key={e.id} className="notif-item" style={{ cursor: 'default' }}>
                  <div className="ni-icon" style={{ color }}><Icon size={16} /></div>
                  <div className="ni-body">
                    <div className="ni-title">{e.summary || e.action}</div>
                    <div className="ni-sub">
                      {e.target ? e.target + ' · ' : ''}<code style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.action}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                    <div className="ni-time">{date}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.actor}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination total={filtered.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}
    </div>
  )
}
