import {
  getStudentById,
  getStudentGrades,
  getStudentAttendanceSummary,
  getStudentQuizResults,
  getLetterGrade,
  activities,
} from '@/lib/data'

const STUDENT_ID = 's1'

export default function StudentDashboard() {
  const student = getStudentById(STUDENT_ID)!
  const studentGrades = getStudentGrades(STUDENT_ID)
  const { present, absent, late, total } = getStudentAttendanceSummary(STUDENT_ID)
  const quizResults = getStudentQuizResults(STUDENT_ID).filter((q) => q.studentScore !== null)
  const attRate = Math.round(((present + late) / total) * 100)
  const gwa = Math.round(studentGrades.reduce((a, b) => a + b.score, 0) / studentGrades.length)
  const myActivities = activities.filter((a) => a.studentId === STUDENT_ID).slice(0, 4)

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">My Dashboard</h1>
        <p className="text-ink3 text-sm mt-0.5">Welcome back, {student.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-7">
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">GWA</p>
          <p className={`text-3xl font-bold ${gwa >= 90 ? 'text-green-700' : gwa >= 75 ? 'text-royal' : 'text-red-600'}`}>{gwa}%</p>
          <p className="text-ink3 text-xs mt-1">{getLetterGrade(gwa)} — Q1 2026</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Attendance</p>
          <p className={`text-3xl font-bold ${attRate >= 90 ? 'text-green-700' : attRate >= 75 ? 'text-amber-600' : 'text-red-600'}`}>{attRate}%</p>
          <p className="text-ink3 text-xs mt-1">{present}P · {late}L · {absent}A</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Quizzes</p>
          <p className="text-3xl font-bold text-royal">{quizResults.length}</p>
          <p className="text-ink3 text-xs mt-1">taken this term</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Section</p>
          <p className="text-3xl font-bold text-cobalt">{student.section}</p>
          <p className="text-ink3 text-xs mt-1">Q1 · 2026</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Grade summary */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <h2 className="font-semibold text-ink font-display text-xl mb-4">Grades by Subject</h2>
          <ul className="space-y-3.5">
            {studentGrades.map((g) => (
              <li key={g.subject}>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-ink">{g.subject}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-semibold ${g.score >= 90 ? 'text-green-700' : g.score >= 75 ? 'text-royal' : 'text-red-600'}`}>
                      {g.score}%
                    </span>
                    <span className="text-xs text-ink3">({getLetterGrade(g.score)})</span>
                  </div>
                </div>
                <div className="w-full bg-acadbg rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${g.score >= 90 ? 'bg-green-500' : g.score >= 75 ? 'bg-sky' : 'bg-amber-400'}`}
                    style={{ width: `${g.score}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Recent quizzes + activity */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-border shadow-sm p-6">
            <h2 className="font-semibold text-ink font-display text-xl mb-4">Recent Quizzes</h2>
            <ul className="space-y-3">
              {quizResults.map((q) => (
                <li key={q.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">{q.title}</p>
                    <p className="text-xs text-ink3">{q.subject} · {q.date}</p>
                  </div>
                  <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
                    (q.studentScore ?? 0) >= 90
                      ? 'bg-green-50 text-green-700'
                      : (q.studentScore ?? 0) >= 75
                      ? 'bg-royal/8 text-royal'
                      : 'bg-red-50 text-red-600'
                  }`}>
                    {q.studentScore}/{q.totalPoints}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm p-6">
            <h2 className="font-semibold text-ink font-display text-xl mb-4">Recent Activity</h2>
            <ul className="space-y-2.5">
              {myActivities.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-gold mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-ink">{a.description}</p>
                    <p className="text-xs text-ink3">{a.date}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
