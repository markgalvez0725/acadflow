import React, { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import CaseStudyGantt from '@/components/casestudy/CaseStudyGantt'
import StepList from '@/components/casestudy/StepList'
import TaskBoard from '@/components/casestudy/TaskBoard'
import { activeClassIds } from '@/utils/active'
import { myPlanGroup, groupStepStats, fmtShortDay, isLeadRole, planId } from '@/utils/caseStudyPlan'

// ── Student case study project page ──────────────────────────────────────────
// Renders one project card per case study plan where this student belongs to a
// group: the group Gantt, the step checklist (any member can mark a step done
// for the group), and the member task board (only your own tasks are tickable;
// the group Lead can assign tasks). Writes touch ONLY the `progress` and
// `tasks` keys of the plan doc - that is all the Firestore rule allows a
// student to change. Returns null when the student has no case studies, so
// the Activities tab looks exactly like before for everyone else.

export default function CaseStudySection({ student: s }) {
  const { caseStudyPlans, saveCaseStudyPlan, deletePlanTask, students, classes, semester } = useData()
  const { toast } = useUI()

  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])
  const mine = useMemo(() =>
    (caseStudyPlans || [])
      .filter(p => enrolledIds.includes(p.classId))
      .map(p => ({ plan: p, group: myPlanGroup(p, s.id) }))
      .filter(x => x.group)
      .sort((a, b) => (b.plan.createdAt || 0) - (a.plan.createdAt || 0)),
    [caseStudyPlans, enrolledIds, s.id]
  )
  const byId = useMemo(() => new Map((students || []).map(x => [x.id, x])), [students])

  if (!mine.length) return null

  const writeFailed = () => toast('Could not save the change. Check your connection.', 'error')

  function markStep(plan, gid, m, done) {
    saveCaseStudyPlan({
      id: plan.id,
      progress: { [gid]: { [m.id]: { done, at: Date.now(), byName: s.name || 'Student' } } },
    })
      .then(() => toast(done ? `"${m.title}" marked done for your group.` : `"${m.title}" reopened.`, 'success'))
      .catch(writeFailed)
  }

  function toggleTask(plan, gid, t, done) {
    saveCaseStudyPlan({
      id: plan.id,
      tasks: { [gid]: { [t.id]: { done, at: Date.now(), byName: s.name || 'Student' } } },
    }).catch(writeFailed)
  }

  function assignTask(plan, gid, { assigneeId, title, category }) {
    saveCaseStudyPlan({
      id: plan.id,
      tasks: { [gid]: { [planId('t')]: { title, category, assigneeId, done: false, createdAt: Date.now(), addedByName: s.name || 'Student' } } },
    }).catch(writeFailed)
  }

  function removeTask(plan, gid, t) {
    deletePlanTask(plan.id, gid, t.id).catch(writeFailed)
  }

  return (
    <section className="csp-sec">
      <div className="csp-sec-h">
        <ListChecks size={17} />
        <b>Case studies</b>
        <span>your group's project tracker</span>
      </div>

      {mine.map(({ plan, group }) => {
        const members = (group.memberIds || []).map(id => byId.get(id)).filter(Boolean)
        const stats = groupStepStats(plan, group.id)
        const role = plan.roles?.[s.id] || ''
        const hasPlan = (plan.milestones?.length || 0) > 0
        return (
          <div key={plan.id} className="card csp-scard">
            <div className="csp-shead">
              <div className="csp-shead-t">
                <b>{plan.title || 'Case study'}</b>
                <span>
                  {plan.subject ? `${plan.subject} · ` : ''}
                  {plan.term === 'finals' ? 'Finals' : 'Midterm'} practical
                  {plan.dueAt ? ` · Due ${fmtShortDay(plan.dueAt)}` : ''}
                </span>
              </div>
              <span className={`csp-gchip${stats.behind ? ' behind' : ''}`}>
                {group.name}
                {hasPlan ? ` · ${stats.done} of ${stats.total} steps` : ''}
              </span>
              {role && <span className={`csp-you${isLeadRole(role) ? ' lead' : ''}`}>You: {role}</span>}
            </div>

            {hasPlan ? (
              <>
                <CaseStudyGantt plan={plan} gid={group.id} />
                <div className="csp-sub">Timeline steps</div>
                <StepList
                  plan={plan}
                  gid={group.id}
                  canToggle
                  onToggle={(m, done) => markStep(plan, group.id, m, done)}
                />
              </>
            ) : (
              <div className="csp-plan-hint">Your professor has not planned the timeline yet. Roles and tasks still work below.</div>
            )}

            <TaskBoard
              plan={plan}
              group={group}
              members={members}
              viewerId={s.id}
              onToggleTask={(t, done) => toggleTask(plan, group.id, t, done)}
              onAssignTask={p => assignTask(plan, group.id, p)}
              onDeleteTask={t => removeTask(plan, group.id, t)}
            />

            <div className="csp-foot-note">
              Anyone in your group can mark a step done. Only your own task boxes are tappable
              {isLeadRole(role) ? '; as the Lead you can also assign tasks to members' : ''}. Your professor sees every change live.
            </div>
          </div>
        )
      })}
    </section>
  )
}
