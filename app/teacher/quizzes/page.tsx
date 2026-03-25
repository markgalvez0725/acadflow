import { quizzes, students, getClassAverage, getStudentById } from '@/lib/data'

export default function TeacherQuizzes() {
  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">Quizzes</h1>
        <p className="text-ink3 text-sm mt-0.5">{quizzes.length} quizzes this term</p>
      </div>

      <div className="space-y-5">
        {quizzes.map((q) => {
          const avg = getClassAverage(q.id)
          const highest = Math.max(...q.scores.map((s) => s.score))
          const lowest = Math.min(...q.scores.map((s) => s.score))

          return (
            <div key={q.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-border flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-ink font-display text-lg">{q.title}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs bg-royal/8 text-royal font-medium px-2 py-0.5 rounded">{q.subject}</span>
                    <span className="text-xs text-ink3">{q.date}</span>
                    <span className="text-xs text-ink3">{q.totalPoints} pts</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-royal">{avg}%</p>
                  <p className="text-xs text-ink3">class average</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                <div className="px-6 py-3 text-center">
                  <p className="text-xs text-ink3">Highest</p>
                  <p className="font-semibold text-green-700">{highest}%</p>
                </div>
                <div className="px-6 py-3 text-center">
                  <p className="text-xs text-ink3">Average</p>
                  <p className="font-semibold text-royal">{avg}%</p>
                </div>
                <div className="px-6 py-3 text-center">
                  <p className="text-xs text-ink3">Lowest</p>
                  <p className="font-semibold text-red-600">{lowest}%</p>
                </div>
              </div>

              {/* Score breakdown */}
              <div className="px-6 py-4">
                <p className="text-[10px] font-semibold text-ink3 uppercase tracking-widest mb-3">Individual Scores</p>
                <div className="space-y-2.5">
                  {q.scores.map((sc) => {
                    const student = getStudentById(sc.studentId)
                    const pct = sc.score
                    const barColor = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-sky' : 'bg-amber-400'
                    return (
                      <div key={sc.studentId} className="flex items-center gap-3">
                        <div className="w-24 text-sm text-ink truncate">{student?.name.split(' ')[0]}</div>
                        <div className="flex-1 bg-acadbg rounded-full h-2">
                          <div className={`${barColor} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="w-10 text-right text-sm font-semibold text-ink2">{pct}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
