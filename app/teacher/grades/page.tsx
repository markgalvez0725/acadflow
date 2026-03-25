import { students, subjects, grades, getLetterGrade } from '@/lib/data'

export default function TeacherGrades() {
  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">Grades</h1>
        <p className="text-ink3 text-sm mt-0.5">Q1 · 2026 — All subjects</p>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Grade Sheet</p>
          <span className="text-xs bg-royal/8 text-royal font-medium px-2.5 py-1 rounded">Q1 · 2026</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-acadbg">
                <th className="text-left px-6 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Student</th>
                {subjects.map((sub) => (
                  <th key={sub} className="px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest text-center">
                    {sub.slice(0, 4)}
                  </th>
                ))}
                <th className="px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest text-center">GWA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((s) => {
                const studentGrades = subjects.map((sub) => {
                  const g = grades.find((gr) => gr.studentId === s.id && gr.subject === sub)
                  return g?.score ?? null
                })
                const validGrades = studentGrades.filter((g): g is number => g !== null)
                const gwa = validGrades.length
                  ? Math.round(validGrades.reduce((a, b) => a + b, 0) / validGrades.length)
                  : 0

                return (
                  <tr key={s.id} className="hover:bg-acadbg/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-royal/10 flex items-center justify-center text-xs font-bold text-royal flex-shrink-0">
                          {s.name.charAt(0)}
                        </div>
                        <span className="font-medium text-ink">{s.name}</span>
                      </div>
                    </td>
                    {studentGrades.map((score, i) => (
                      <td key={i} className="px-4 py-4 text-center">
                        {score !== null ? (
                          <div>
                            <span className={`font-semibold ${score >= 90 ? 'text-green-700' : score >= 75 ? 'text-cobalt' : 'text-red-600'}`}>
                              {score}
                            </span>
                            <span className="text-ink3 text-xs ml-1">({getLetterGrade(score)})</span>
                          </div>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-4 text-center">
                      <span className={`font-bold text-base ${gwa >= 90 ? 'text-green-700' : gwa >= 75 ? 'text-royal' : 'text-red-600'}`}>
                        {gwa}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Subject averages */}
            <tfoot>
              <tr className="bg-acadbg border-t-2 border-border">
                <td className="px-6 py-3 text-xs font-semibold text-ink2 uppercase tracking-wide">Class Avg</td>
                {subjects.map((sub) => {
                  const subGrades = grades.filter((g) => g.subject === sub).map((g) => g.score)
                  const avg = subGrades.length
                    ? Math.round(subGrades.reduce((a, b) => a + b, 0) / subGrades.length)
                    : 0
                  return (
                    <td key={sub} className="px-4 py-3 text-center text-xs font-semibold text-royal">
                      {avg}%
                    </td>
                  )
                })}
                <td className="px-4 py-3 text-center text-xs font-bold text-royal">
                  {Math.round(grades.reduce((a, b) => a + b.score, 0) / grades.length)}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
