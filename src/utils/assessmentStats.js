// ── Assessment completion analytics ──────────────────────────────────────────
// Aggregates activity submission/grading status across the whole roster - data
// that lives in activity.submissions but is otherwise only visible one activity
// at a time. Pure functions; no Firebase, no React.

// A student is enrolled in an activity if the activity's classId is among the
// student's enrolled class ids (classIds[] preferred, classId as fallback).
function enrolledIn(student, classId) {
  const ids = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
  return ids.includes(classId)
}

function isSubmitted(sub) { return !!(sub && sub.link) }
function isGraded(sub)    { return !!(sub && (sub.graded === true || sub.score != null)) }

/**
 * NOTE: this deliberately does NOT count missing submissions on activities
 * whose deadline has already passed. An ended activity with non-submitters is
 * a settled outcome, not a professor to-do (the grading sheet's missed-work
 * defaults handle it), so surfacing it as an analyzer reminder was pure noise.
 *
 * @returns {{
 *   awaitingGrading: number,          // submissions handed in but not yet graded
 *   needsGrading: Array<{ id, title, subject, classId, ungraded, submitted, enrolled }>,
 * }}
 */
export function computeAssessmentStats(activities = [], students = [], classes = []) {
  const liveClassIds = new Set(classes.filter(c => !c.archived).map(c => c.id))

  let awaitingGrading = 0
  const needsGrading = []

  activities.forEach(act => {
    // Only score activities that belong to a live (non-archived) class.
    if (act.classId && classes.length && !liveClassIds.has(act.classId)) return

    const enrolled = students.filter(s => enrolledIn(s, act.classId))
    if (!enrolled.length) return

    const subs = act.submissions || {}
    let ungraded = 0, submitted = 0
    enrolled.forEach(s => {
      const sub = subs[s.id]
      if (isSubmitted(sub)) {
        submitted++
        if (!isGraded(sub)) ungraded++
      }
    })

    awaitingGrading += ungraded
    if (ungraded > 0) {
      needsGrading.push({ id: act.id, title: act.title, subject: act.subject, classId: act.classId, ungraded, submitted, enrolled: enrolled.length })
    }
  })

  needsGrading.sort((a, b) => b.ungraded - a.ungraded)

  return { awaitingGrading, needsGrading }
}
