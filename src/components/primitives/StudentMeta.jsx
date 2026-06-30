import React from 'react'
import { cn } from '@/utils/cn'
import { courseShort } from '@/constants/courses'

// One shared chip line for a student's academic context: course (short code) ·
// year · section · subject. Used everywhere a card identifies a student so the
// professor and student views read identically. Section defaults to the
// student's own enrolled section; pass `section` to override with a more
// specific class section, and `subject` to append the relevant subject.
//
// Accepts either a `student` object (preferred) or explicit course/year props.
// Renders nothing when there is nothing to show, so callers can drop it in
// unconditionally.
export default function StudentMeta({ student, course, year, section, subject, className }) {
  const courseLabel = courseShort(course ?? student?.course)
  const yearLabel   = year ?? student?.year
  const sectionVal  = section ?? student?.section

  const chips = []
  if (courseLabel)  chips.push({ k: 'course',  label: courseLabel,            tone: 'accent'  })
  if (yearLabel)    chips.push({ k: 'year',    label: yearLabel,              tone: 'plain'   })
  if (sectionVal)   chips.push({ k: 'section', label: `Section ${sectionVal}`, tone: 'plain'   })
  if (subject)      chips.push({ k: 'subject', label: subject,                tone: 'subject' })
  if (!chips.length) return null

  return (
    <div className={cn('smeta', className)}>
      {chips.map(c => (
        <span key={c.k} className={`smeta-chip smeta-${c.tone}`}>{c.label}</span>
      ))}
    </div>
  )
}
