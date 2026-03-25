import { students, getStudentAvgScore, getAttendanceRate } from '@/lib/data'

export default function TeacherStudents() {
  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">Students</h1>
        <p className="text-ink3 text-sm mt-0.5">{students.length} students enrolled</p>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Student Roster</p>
          <span className="text-xs text-ink3">Q1 · 2026</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-acadbg">
              <th className="text-left px-6 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Student</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Section</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Avg Grade</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Attendance</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {students.map((s) => {
              const avg = getStudentAvgScore(s.id)
              const att = getAttendanceRate(s.id)
              const status = avg >= 85 ? 'Good Standing' : avg >= 75 ? 'Average' : 'At Risk'
              const statusStyle =
                status === 'Good Standing'
                  ? 'bg-green-50 text-green-700'
                  : status === 'Average'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700'

              return (
                <tr key={s.id} className="hover:bg-acadbg/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-royal/10 flex items-center justify-center text-xs font-bold text-royal flex-shrink-0">
                        {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium text-ink">{s.name}</p>
                        <p className="text-xs text-ink3">{s.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-ink2">{s.section}</td>
                  <td className="px-4 py-4">
                    <span className={`font-semibold ${avg >= 85 ? 'text-green-700' : avg >= 75 ? 'text-amber-700' : 'text-red-600'}`}>
                      {avg}%
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-acadbg rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${att >= 90 ? 'bg-green-500' : att >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${att}%` }}
                        />
                      </div>
                      <span className="text-xs text-ink2">{att}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyle}`}>{status}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
