import { students, attendance, quizzes, activities, getClassAverage, getStudentById } from '@/lib/data'

export default function TeacherDashboard() {
  const today = attendance[attendance.length - 1]
  const presentToday = today.records.filter((r) => r.status === 'present').length
  const allScores = quizzes.flatMap((q) => q.scores.map((s) => s.score))
  const classAvg = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)

  const typeColors: Record<string, string> = {
    quiz: 'bg-blue-50 text-cobalt',
    attendance: 'bg-amber-50 text-amber-700',
    grade: 'bg-green-50 text-green-700',
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">Dashboard</h1>
        <p className="text-ink3 text-sm mt-0.5">Welcome back, Ms. Rivera</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-7">
        <StatCard label="Total Students" value={students.length} sub="enrolled" accent="royal" />
        <StatCard label="Class Average" value={`${classAvg}%`} sub="all subjects" accent="green" />
        <StatCard label="Present Today" value={`${presentToday}/${students.length}`} sub={today.date} accent="gold" />
        <StatCard label="Quizzes Given" value={quizzes.length} sub="this term" accent="cobalt" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <h2 className="font-semibold text-ink font-display text-xl mb-4">Recent Activity</h2>
          <ul className="space-y-3">
            {activities.slice(0, 6).map((a) => {
              const student = getStudentById(a.studentId)
              return (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-royal/10 flex items-center justify-center text-xs font-bold text-royal flex-shrink-0">
                    {student?.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink leading-snug">{a.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${typeColors[a.type] ?? 'bg-gray-100 text-ink2'}`}>
                        {a.type}
                      </span>
                      <span className="text-xs text-ink3">{student?.name} · {a.date}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Quiz Performance */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <h2 className="font-semibold text-ink font-display text-xl mb-4">Quiz Performance</h2>
          <ul className="space-y-4">
            {quizzes.map((q) => {
              const avg = getClassAverage(q.id)
              const barColor = avg >= 90 ? 'bg-green-500' : avg >= 75 ? 'bg-sky' : 'bg-amber-400'
              return (
                <li key={q.id}>
                  <div className="flex justify-between mb-1.5">
                    <div>
                      <span className="text-sm font-medium text-ink">{q.title}</span>
                      <span className="text-xs text-ink3 ml-2">{q.subject}</span>
                    </div>
                    <span className="text-sm font-semibold text-royal">{avg}%</span>
                  </div>
                  <div className="w-full bg-acadbg rounded-full h-1.5">
                    <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${avg}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>

          {/* At-risk students */}
          <div className="mt-6 pt-5 border-t border-border">
            <p className="text-xs font-semibold text-ink2 uppercase tracking-wide mb-3">At-Risk Students</p>
            {students
              .map((s) => {
                const scores = quizzes.flatMap((q) => q.scores.filter((sc) => sc.studentId === s.id).map((sc) => sc.score))
                const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
                return { ...s, avg }
              })
              .filter((s) => s.avg < 80)
              .map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-ink">{s.name}</span>
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{s.avg}%</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent: string }) {
  const styles: Record<string, { text: string; bg: string }> = {
    royal:  { text: 'text-royal',  bg: 'bg-royal/8' },
    green:  { text: 'text-green-700', bg: 'bg-green-50' },
    gold:   { text: 'text-gold-d', bg: 'bg-gold-l' },
    cobalt: { text: 'text-cobalt', bg: 'bg-cobalt/8' },
  }
  const s = styles[accent] ?? styles.royal
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5">
      <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-bold ${s.text}`}>{value}</p>
      <p className="text-ink3 text-xs mt-1">{sub}</p>
    </div>
  )
}
