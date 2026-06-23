import React, { useMemo } from 'react'
import { useData } from '@/context/DataContext'
import PageHeader from '@/components/ds/PageHeader'
import { Library, ExternalLink, BookOpen } from 'lucide-react'
import { resourceType } from '@/utils/resourceTypes'
import { activeClassIds, activeSubjects } from '@/utils/active'
import { subjectColor } from '@/utils/subjectColor'

export default function ResourcesTab({ student: s, viewClassId, classes }) {
  const { resources, semester, fbReady } = useData()

  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])
  const allSubs = useMemo(() => activeSubjects(s, classes, semester), [s, classes, semester])

  // Respect the class switcher: when a specific class is in view, scope to it.
  const viewCls = classes.find(c => c.id === viewClassId)
  const subs = viewCls ? (viewCls.subjects || []) : allSubs

  // Resources for the student's active classes + visible subjects, grouped by subject.
  const grouped = useMemo(() => {
    const mine = resources.filter(r =>
      enrolledIds.includes(r.classId) &&
      subs.includes(r.subject) &&
      (!viewClassId || r.classId === viewClassId)
    )
    const bySub = {}
    for (const r of mine) (bySub[r.subject] ||= []).push(r)
    for (const k of Object.keys(bySub)) bySub[k].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return bySub
  }, [resources, enrolledIds, subs, viewClassId])

  const subjectsWithResources = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
  const total = subjectsWithResources.reduce((n, k) => n + grouped[k].length, 0)

  if (!fbReady) return null

  return (
    <div className="student-resources">
      <PageHeader
        crumb={<><Library size={13} /> Resources</>}
        title="Resource Hub"
        subtitle={`${total} material${total === 1 ? '' : 's'} from your teacher`}
      />

      {!subjectsWithResources.length ? (
        <div className="empty">
          <div className="empty-icon"><Library size={40} /></div>
          No resources posted yet. Your teacher's modules, slides, and links will appear here.
        </div>
      ) : (
        subjectsWithResources.map(subject => (
          <div key={subject} style={{ marginBottom: 22 }}>
            <div className="sec-hdr" style={{ marginBottom: 12 }}>
              <div className="sec-title sec-title-ic" style={{ color: subjectColor(subject).color }}><BookOpen /> {subject}</div>
            </div>
            <div className="res-list">
              {grouped[subject].map(r => {
                const { Icon, label } = resourceType(r.type)
                return (
                  <a
                    key={r.id}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="res-item res-item--link"
                  >
                    <span className="res-ic" aria-hidden="true"><Icon size={18} /></span>
                    <div className="res-main">
                      <div className="res-title">{r.title}</div>
                      <div className="res-meta">
                        <span className="badge badge-blue">{label}</span>
                        {r.description && <span className="res-desc">{r.description}</span>}
                      </div>
                    </div>
                    <span className="res-open" aria-hidden="true"><ExternalLink size={16} /></span>
                  </a>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
