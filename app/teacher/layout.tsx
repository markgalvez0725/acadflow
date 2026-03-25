import Sidebar from '@/components/Sidebar'

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar role="teacher" userName="Ms. Rivera" />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  )
}
