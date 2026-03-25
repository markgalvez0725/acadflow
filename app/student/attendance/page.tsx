import { attendance, getStudentAttendanceSummary } from '@/lib/data'

const STUDENT_ID = 's1'

export default function StudentAttendance() {
  const { present, absent, late, total } = getStudentAttendanceSummary(STUDENT_ID)
  const rate = Math.round(((present + late) / total) * 100)

  const myRecords = attendance.map((d) => ({
    date: d.date,
    status: d.records.find((r) => r.studentId === STUDENT_ID)?.status ?? null,
  }))

  const statusConfig = {
    present: { label: 'Present', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', short: 'P' },
    absent: { label: 'Absent', bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', short: 'A' },
    late: { label: 'Late', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', short: 'L' },
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">My Attendance</h1>
        <p className="text-ink3 text-sm mt-0.5">March 2026 · {total} school days</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-7">
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Rate</p>
          <p className={`text-3xl font-bold ${rate >= 90 ? 'text-green-700' : rate >= 75 ? 'text-amber-600' : 'text-red-600'}`}>{rate}%</p>
          <div className="mt-2 w-full bg-acadbg rounded-full h-1.5">
            <div className={`h-1.5 rounded-full ${rate >= 90 ? 'bg-green-500' : rate >= 75 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${rate}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Present</p>
          <p className="text-3xl font-bold text-green-700">{present}</p>
          <p className="text-ink3 text-xs mt-1">out of {total} days</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Late</p>
          <p className="text-3xl font-bold text-amber-600">{late}</p>
          <p className="text-ink3 text-xs mt-1">day{late !== 1 ? 's' : ''} late</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-5">
          <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">Absent</p>
          <p className="text-3xl font-bold text-red-600">{absent}</p>
          <p className="text-ink3 text-xs mt-1">day{absent !== 1 ? 's' : ''} missed</p>
        </div>
      </div>

      {/* Daily log */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-sm font-semibold text-ink">Daily Record</p>
        </div>
        <ul className="divide-y divide-border">
          {myRecords.map((rec) => {
            const cfg = rec.status ? statusConfig[rec.status] : null
            const dayName = new Date(rec.date).toLocaleDateString('en-US', { weekday: 'long' })
            return (
              <li key={rec.date} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${cfg?.dot ?? 'bg-gray-300'}`} />
                  <div>
                    <p className="text-sm font-medium text-ink">{dayName}</p>
                    <p className="text-xs text-ink3">{rec.date}</p>
                  </div>
                </div>
                {cfg ? (
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
                    {cfg.label}
                  </span>
                ) : (
                  <span className="text-xs text-ink3">No record</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
