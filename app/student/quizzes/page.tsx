import { getStudentQuizResults, getLetterGrade, getClassAverage } from '@/lib/data'

const STUDENT_ID = 's1'

export default function StudentQuizzes() {
  const quizResults = getStudentQuizResults(STUDENT_ID).filter((q) => q.studentScore !== null)
  const totalTaken = quizResults.length
  const avg = totalTaken
    ? Math.round(quizResults.reduce((a, q) => a + (q.studentScore ?? 0), 0) / totalTaken)
    : 0

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-ink font-display">My Quizzes</h1>
        <p className="text-ink3 text-sm mt-0.5">{totalTaken} quizzes taken · {avg}% average</p>
      </div>

      <div className="space-y-4">
        {quizResults.map((q) => {
          const score = q.studentScore ?? 0
          const classAvg = getClassAverage(q.id)
          const diff = score - classAvg
          const grade = getLetterGrade(score)
          const scoreColor = score >= 90 ? 'text-green-700' : score >= 75 ? 'text-royal' : 'text-red-600'
          const scoreBg = score >= 90 ? 'bg-green-50' : score >= 75 ? 'bg-royal/8' : 'bg-red-50'

          return (
            <div key={q.id} className="bg-white rounded-xl border border-border shadow-sm p-6 flex items-center gap-6">
              {/* Score circle */}
              <div className={`w-16 h-16 rounded-full ${scoreBg} flex flex-col items-center justify-center flex-shrink-0`}>
                <span className={`text-xl font-bold ${scoreColor}`}>{score}</span>
                <span className="text-xs text-ink3">/{q.totalPoints}</span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-ink font-display text-lg">{q.title}</h2>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs bg-royal/8 text-royal font-medium px-2 py-0.5 rounded">{q.subject}</span>
                  <span className="text-xs text-ink3">{q.date}</span>
                </div>
                <div className="mt-3 w-full bg-acadbg rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${score >= 90 ? 'bg-green-500' : score >= 75 ? 'bg-sky' : 'bg-amber-400'}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>

              {/* Right side stats */}
              <div className="text-right flex-shrink-0 space-y-1.5">
                <div>
                  <span className={`text-2xl font-bold ${scoreColor}`}>{grade}</span>
                </div>
                <div className="text-xs text-ink3">
                  Class avg: <span className="font-semibold text-ink2">{classAvg}%</span>
                </div>
                <div className={`text-xs font-semibold ${diff >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {diff >= 0 ? '+' : ''}{diff} vs class
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
