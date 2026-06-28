import React from 'react'
import { CalendarOff, Video, BookOpen, Library, FileText, ClipboardList, FileQuestion, CalendarCheck } from 'lucide-react'

// A compact preview of a Stream post, embedded inside a message bubble. Sent
// when a student taps "Message professor about this post": the professor (and
// the student) see what post the conversation is about, and tapping it opens
// the post. postRef = { id, type, title, classLabel, classId, thumb }.
const TYPE_ICON = {
  no_class: CalendarOff, online_class: Video, meeting_topics: BookOpen, resource_hub: Library,
  activity: ClipboardList, quiz: FileQuestion, grade: BookOpen, attendance: CalendarCheck,
}
const TYPE_LABEL = {
  no_class: 'No Class Today', online_class: 'Online Class', meeting_topics: 'Lesson topics', resource_hub: 'Resource Hub',
  activity: 'Activity', quiz: 'Quiz', grade: 'Grade', attendance: 'Attendance',
}

export default function PostRefCard({ postRef, onOpen }) {
  if (!postRef) return null
  const Icon = TYPE_ICON[postRef.type] || FileText
  const kicker = [TYPE_LABEL[postRef.type] || 'Post', postRef.classLabel].filter(Boolean).join(' · ')
  return (
    <button type="button" className="msg-postcard" onClick={onOpen} title="Open this post">
      <div className="msg-postcard-thumb">
        {postRef.thumb ? <img src={postRef.thumb} alt="" /> : <Icon size={20} />}
      </div>
      <div className="msg-postcard-body">
        <div className="msg-postcard-kicker"><Icon size={12} /> {kicker}</div>
        {postRef.title && <div className="msg-postcard-title">{postRef.title}</div>}
        <div className="msg-postcard-open">Open post</div>
      </div>
    </button>
  )
}
