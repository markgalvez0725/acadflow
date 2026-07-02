import React, { lazy, Suspense, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

// Layout-level host for the in-app classroom. Rendered ONCE in AdminLayout and
// StudentLayout (never inside a tab), so navigating between tabs while in a
// class keeps the call alive - the tabs only set meetingRoomId via
// useUI().openMeetingRoom(id). Minimizing swaps the full room for the floating
// mini player without unmounting the engine.
const MeetingRoom = lazy(() => import('@/components/meeting/MeetingRoom'))

export default function MeetingHost({ role, student }) {
  const { meetings, admin, endMeeting } = useData()
  const { meetingRoomId, meetingMinimized, closeMeetingRoom, setMeetingMinimized, toast } = useUI()

  // Logging out (or the layout otherwise unmounting) must not leave a stale
  // room id behind for the next session.
  useEffect(() => () => closeMeetingRoom(), [closeMeetingRoom])

  if (!meetingRoomId) return null
  const meeting = meetings.find(m => m.id === meetingRoomId) || null
  const self = role === 'admin'
    ? { uid: 'admin', name: admin?.name || 'Professor', role: 'admin' }
    : { uid: student?.id || '', name: student?.name || 'Student', role: 'student' }
  if (role === 'student' && !student) return null

  async function handleEndClass() {
    if (!meeting) return
    try {
      await endMeeting(meeting)
      toast('Class ended for everyone.', 'success')
    } catch (e) {
      toast('Failed to end the class.', 'error')
    }
  }

  return (
    <Suspense fallback={null}>
      <MeetingRoom
        meeting={meeting}
        self={self}
        minimized={meetingMinimized}
        onMinimize={setMeetingMinimized}
        onClose={closeMeetingRoom}
        onEndClass={role === 'admin' ? handleEndClass : undefined}
      />
    </Suspense>
  )
}
