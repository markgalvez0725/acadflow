export const students = [
  { id: 's1', name: 'Maria Santos', section: '10-A', email: 'maria@acadflow.edu' },
  { id: 's2', name: 'Juan dela Cruz', section: '10-A', email: 'juan@acadflow.edu' },
  { id: 's3', name: 'Ana Reyes', section: '10-B', email: 'ana@acadflow.edu' },
  { id: 's4', name: 'Carlos Mendoza', section: '10-B', email: 'carlos@acadflow.edu' },
  { id: 's5', name: 'Lea Garcia', section: '10-C', email: 'lea@acadflow.edu' },
]

export const subjects = ['Mathematics', 'Science', 'English', 'History', 'Filipino']

export const quizzes = [
  {
    id: 'q1',
    title: 'Algebra Basics',
    subject: 'Mathematics',
    date: '2026-03-10',
    totalPoints: 100,
    scores: [
      { studentId: 's1', score: 92 },
      { studentId: 's2', score: 78 },
      { studentId: 's3', score: 85 },
      { studentId: 's4', score: 70 },
      { studentId: 's5', score: 88 },
    ],
  },
  {
    id: 'q2',
    title: 'Cell Biology',
    subject: 'Science',
    date: '2026-03-12',
    totalPoints: 100,
    scores: [
      { studentId: 's1', score: 95 },
      { studentId: 's2', score: 82 },
      { studentId: 's3', score: 79 },
      { studentId: 's4', score: 91 },
      { studentId: 's5', score: 76 },
    ],
  },
  {
    id: 'q3',
    title: 'Reading Comprehension',
    subject: 'English',
    date: '2026-03-14',
    totalPoints: 100,
    scores: [
      { studentId: 's1', score: 88 },
      { studentId: 's2', score: 75 },
      { studentId: 's3', score: 93 },
      { studentId: 's4', score: 80 },
      { studentId: 's5', score: 84 },
    ],
  },
  {
    id: 'q4',
    title: 'World War II',
    subject: 'History',
    date: '2026-03-17',
    totalPoints: 100,
    scores: [
      { studentId: 's1', score: 84 },
      { studentId: 's2', score: 90 },
      { studentId: 's3', score: 72 },
      { studentId: 's4', score: 88 },
      { studentId: 's5', score: 95 },
    ],
  },
]

export const attendance: { date: string; records: { studentId: string; status: 'present' | 'absent' | 'late' }[] }[] = [
  {
    date: '2026-03-18',
    records: [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'absent' },
      { studentId: 's3', status: 'present' },
      { studentId: 's4', status: 'late' },
      { studentId: 's5', status: 'present' },
    ],
  },
  {
    date: '2026-03-19',
    records: [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'present' },
      { studentId: 's3', status: 'late' },
      { studentId: 's4', status: 'present' },
      { studentId: 's5', status: 'absent' },
    ],
  },
  {
    date: '2026-03-20',
    records: [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'present' },
      { studentId: 's3', status: 'present' },
      { studentId: 's4', status: 'absent' },
      { studentId: 's5', status: 'present' },
    ],
  },
  {
    date: '2026-03-21',
    records: [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'late' },
      { studentId: 's3', status: 'present' },
      { studentId: 's4', status: 'present' },
      { studentId: 's5', status: 'present' },
    ],
  },
  {
    date: '2026-03-24',
    records: [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'present' },
      { studentId: 's3', status: 'absent' },
      { studentId: 's4', status: 'present' },
      { studentId: 's5', status: 'present' },
    ],
  },
]

export const grades = [
  { studentId: 's1', subject: 'Mathematics', score: 92, term: 'Q1' },
  { studentId: 's2', subject: 'Mathematics', score: 78, term: 'Q1' },
  { studentId: 's3', subject: 'Mathematics', score: 85, term: 'Q1' },
  { studentId: 's4', subject: 'Mathematics', score: 70, term: 'Q1' },
  { studentId: 's5', subject: 'Mathematics', score: 88, term: 'Q1' },

  { studentId: 's1', subject: 'Science', score: 95, term: 'Q1' },
  { studentId: 's2', subject: 'Science', score: 82, term: 'Q1' },
  { studentId: 's3', subject: 'Science', score: 79, term: 'Q1' },
  { studentId: 's4', subject: 'Science', score: 91, term: 'Q1' },
  { studentId: 's5', subject: 'Science', score: 76, term: 'Q1' },

  { studentId: 's1', subject: 'English', score: 88, term: 'Q1' },
  { studentId: 's2', subject: 'English', score: 75, term: 'Q1' },
  { studentId: 's3', subject: 'English', score: 93, term: 'Q1' },
  { studentId: 's4', subject: 'English', score: 80, term: 'Q1' },
  { studentId: 's5', subject: 'English', score: 84, term: 'Q1' },

  { studentId: 's1', subject: 'History', score: 84, term: 'Q1' },
  { studentId: 's2', subject: 'History', score: 90, term: 'Q1' },
  { studentId: 's3', subject: 'History', score: 72, term: 'Q1' },
  { studentId: 's4', subject: 'History', score: 88, term: 'Q1' },
  { studentId: 's5', subject: 'History', score: 95, term: 'Q1' },

  { studentId: 's1', subject: 'Filipino', score: 91, term: 'Q1' },
  { studentId: 's2', subject: 'Filipino', score: 86, term: 'Q1' },
  { studentId: 's3', subject: 'Filipino', score: 88, term: 'Q1' },
  { studentId: 's4', subject: 'Filipino', score: 77, term: 'Q1' },
  { studentId: 's5', subject: 'Filipino', score: 82, term: 'Q1' },
]

export const activities = [
  { id: 'a1', studentId: 's1', type: 'quiz', description: 'Scored 92/100 on Algebra Basics', date: '2026-03-10' },
  { id: 'a2', studentId: 's2', type: 'attendance', description: 'Marked absent', date: '2026-03-18' },
  { id: 'a3', studentId: 's3', type: 'grade', description: 'Grade updated: English Q1 — 93%', date: '2026-03-15' },
  { id: 'a4', studentId: 's4', type: 'quiz', description: 'Scored 91/100 on Cell Biology', date: '2026-03-12' },
  { id: 'a5', studentId: 's5', type: 'quiz', description: 'Scored 95/100 on World War II', date: '2026-03-17' },
  { id: 'a6', studentId: 's1', type: 'attendance', description: 'Perfect attendance this week', date: '2026-03-21' },
  { id: 'a7', studentId: 's2', type: 'quiz', description: 'Scored 90/100 on World War II', date: '2026-03-17' },
  { id: 'a8', studentId: 's3', type: 'attendance', description: 'Marked late', date: '2026-03-19' },
]

// Helpers
export function getLetterGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 67) return 'D+'
  return 'F'
}

export function getStudentById(id: string) {
  return students.find((s) => s.id === id)
}

export function getClassAverage(quizId: string): number {
  const quiz = quizzes.find((q) => q.id === quizId)
  if (!quiz || quiz.scores.length === 0) return 0
  return Math.round(quiz.scores.reduce((sum, s) => sum + s.score, 0) / quiz.scores.length)
}

export function getStudentAttendanceSummary(studentId: string) {
  let present = 0, absent = 0, late = 0
  for (const day of attendance) {
    const record = day.records.find((r) => r.studentId === studentId)
    if (record?.status === 'present') present++
    else if (record?.status === 'absent') absent++
    else if (record?.status === 'late') late++
  }
  return { present, absent, late, total: attendance.length }
}

export function getStudentGrades(studentId: string) {
  return grades.filter((g) => g.studentId === studentId)
}

export function getStudentQuizResults(studentId: string) {
  return quizzes.map((q) => ({
    ...q,
    studentScore: q.scores.find((s) => s.studentId === studentId)?.score ?? null,
  }))
}

export function getStudentAvgScore(studentId: string): number {
  const studentGrades = getStudentGrades(studentId)
  if (studentGrades.length === 0) return 0
  return Math.round(studentGrades.reduce((sum, g) => sum + g.score, 0) / studentGrades.length)
}

export function getAttendanceRate(studentId: string): number {
  const { present, late, total } = getStudentAttendanceSummary(studentId)
  return Math.round(((present + late) / total) * 100)
}
