import { getStudentGrades, getLetterGrade, grades, subjects } from '@/lib/data'

const STUDENT_ID = 's1'

export default function StudentGrades() {
  const studentGrades = getStudentGrades(STUDENT_ID)
  const gwa = Math.round(studentGrades.reduce((a, b) => a + b.score, 0) / studentGrades.length)

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">My Grades</h1>
        <p className="text-ink3 text-sm mt-0.5">Q1 · 2026 — GWA: <span className={`font-semibold ${gwa >= 90 ? 'text-green-700' : gwa >= 75 ? 'text-royal' : 'text-red-600'}`}>{gwa}% ({getLetterGrade(gwa)})</span></p>
      </div>

      {/* GWA card */}
      <div className="bg-royal rounded-xl p-6 mb-7 text-white flex items-center justify-between">
        <div>
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-1">General Weighted Average</p>
          <p className="text-5xl font-bold font-display">{gwa}%</p>
          <p className="text-white/60 text-sm mt-1">Q1 · 2026 · {studentGrades.length} subjects</p>
        </div>
        <div className="text-right">
          <p className="text-6xl font-bold text-gold font-display">{getLetterGrade(gwa)}</p>
          <p className="text-white/50 text-xs mt-1">{gwa >= 90 ? 'Excellent' : gwa >= 85 ? 'Very Good' : gwa >= 75 ? 'Satisfactory' : 'Needs Improvement'}</p>
        </div>
      </div>

      {/* Subject cards */}
      <div className="grid grid-cols-2 gap-4 mb-7">
        {studentGrades.map((g) => {
          const classAvgForSubject = Math.round(
            grades.filter((gr) => gr.subject === g.subject).reduce((a, b) => a + b.score, 0) /
            grades.filter((gr) => gr.subject === g.subject).length
          )
          const diff = g.score - classAvgForSubject
          const letter = getLetterGrade(g.score)
          const color = g.score >= 90 ? 'text-green-700' : g.score >= 75 ? 'text-royal' : 'text-red-600'
          const barColor = g.score >= 90 ? 'bg-green-500' : g.score >= 75 ? 'bg-sky' : 'bg-amber-400'

          return (
            <div key={g.subject} className="bg-white rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-ink font-display text-lg">{g.subject}</h3>
                  <p className="text-xs text-ink3">{g.term} · 2026</p>
                </div>
                <span className={`text-2xl font-bold font-display ${color}`}>{letter}</span>
              </div>

              <div className="flex items-end justify-between mb-2">
                <span className={`text-3xl font-bold ${color}`}>{g.score}%</span>
                <span className={`text-xs font-semibold ${diff >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {diff >= 0 ? '+' : ''}{diff} vs class avg
                </span>
              </div>

              <div className="w-full bg-acadbg rounded-full h-2">
                <div className={`${barColor} h-2 rounded-full`} style={{ width: `${g.score}%` }} />
              </div>

              <p className="text-xs text-ink3 mt-1.5">Class avg: {classAvgForSubject}%</p>
            </div>
          )
        })}
      </div>

      {/* Summary table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-sm font-semibold text-ink">Grade Summary</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-acadbg">
              <th className="text-left px-6 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Subject</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Score</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Grade</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Class Avg</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Standing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {studentGrades.map((g) => {
              const classAvgForSubject = Math.round(
                grades.filter((gr) => gr.subject === g.subject).reduce((a, b) => a + b.score, 0) /
                grades.filter((gr) => gr.subject === g.subject).length
              )
              const standing = g.score >= 90 ? 'Excellent' : g.score >= 85 ? 'Very Good' : g.score >= 75 ? 'Satisfactory' : 'At Risk'
              const standingStyle =
                g.score >= 90 ? 'bg-green-50 text-green-700'
                : g.score >= 85 ? 'bg-cobalt/8 text-cobalt'
                : g.score >= 75 ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-600'

              return (
                <tr key={g.subject} className="hover:bg-acadbg/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-ink">{g.subject}</td>
                  <td className={`px-4 py-4 text-center font-semibold ${g.score >= 90 ? 'text-green-700' : g.score >= 75 ? 'text-royal' : 'text-red-600'}`}>{g.score}%</td>
                  <td className="px-4 py-4 text-center font-bold text-ink">{getLetterGrade(g.score)}</td>
                  <td className="px-4 py-4 text-center text-ink2">{classAvgForSubject}%</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${standingStyle}`}>{standing}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-acadbg border-t-2 border-border">
              <td className="px-6 py-3 font-semibold text-ink2 text-xs uppercase tracking-wide">GWA</td>
              <td className={`px-4 py-3 text-center font-bold ${gwa >= 90 ? 'text-green-700' : gwa >= 75 ? 'text-royal' : 'text-red-600'}`}>{gwa}%</td>
              <td className="px-4 py-3 text-center font-bold text-ink">{getLetterGrade(gwa)}</td>
              <td className="px-4 py-3 text-center text-ink2">
                {Math.round(grades.reduce((a, b) => a + b.score, 0) / grades.length)}%
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gwa >= 90 ? 'bg-green-50 text-green-700' : gwa >= 75 ? 'bg-royal/8 text-royal' : 'bg-red-50 text-red-600'}`}>
                  {gwa >= 90 ? 'Excellent' : gwa >= 85 ? 'Very Good' : gwa >= 75 ? 'Satisfactory' : 'At Risk'}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
