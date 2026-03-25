import Sidebar from '@/components/Sidebar'

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar role="student" userName="Maria Santos" />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  )
}
