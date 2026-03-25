import { students, attendance } from '@/lib/data'

export default function TeacherAttendance() {
  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">Attendance</h1>
        <p className="text-ink3 text-sm mt-0.5">March 2026 · {attendance.length} school days recorded</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        {students.map((s) => {
          const present = attendance.filter((d) => d.records.find((r) => r.studentId === s.id && r.status === 'present')).length
          const absent = attendance.filter((d) => d.records.find((r) => r.studentId === s.id && r.status === 'absent')).length
          const late = attendance.filter((d) => d.records.find((r) => r.studentId === s.id && r.status === 'late')).length
          const rate = Math.round(((present + late) / attendance.length) * 100)
          return (
            <div key={s.id} className="bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-full bg-royal/10 flex items-center justify-center text-xs font-bold text-royal flex-shrink-0">
                  {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{s.name}</p>
                  <p className="text-xs text-ink3">{s.section}</p>
                </div>
              </div>
              <div className="flex gap-2 text-xs mb-2">
                <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded font-semibold">{present}P</span>
                <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded font-semibold">{absent}A</span>
                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-semibold">{late}L</span>
              </div>
              <div className="w-full bg-acadbg rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${rate >= 90 ? 'bg-green-500' : rate >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${rate}%` }}
                />
              </div>
              <p className="text-xs text-ink3 mt-1">{rate}% attendance rate</p>
            </div>
          )
        })}
      </div>

      {/* Attendance log table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-sm font-semibold text-ink">Daily Attendance Log</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-acadbg">
                <th className="text-left px-6 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest">Student</th>
                {attendance.map((d) => (
                  <th key={d.date} className="px-3 py-3 text-[10px] font-semibold text-ink3 uppercase tracking-widest text-center">
                    {d.date.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-acadbg/50 transition-colors">
                  <td className="px-6 py-3 font-medium text-ink whitespace-nowrap">{s.name}</td>
                  {attendance.map((d) => {
                    const rec = d.records.find((r) => r.studentId === s.id)
                    const status = rec?.status ?? '—'
                    const style =
                      status === 'present'
                        ? 'bg-green-50 text-green-700'
                        : status === 'absent'
                        ? 'bg-red-50 text-red-600'
                        : status === 'late'
                        ? 'bg-amber-50 text-amber-700'
                        : 'text-ink3'
                    return (
                      <td key={d.date} className="px-3 py-3 text-center">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${style}`}>
                          {status === 'present' ? 'P' : status === 'absent' ? 'A' : status === 'late' ? 'L' : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
