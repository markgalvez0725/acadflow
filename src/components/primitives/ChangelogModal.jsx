import React from 'react'
import Modal from '@/components/primitives/Modal'
import AboutPanel from '@/components/primitives/AboutPanel'

// "What's new" dialog: the full AcadFlow release history. Opened from the
// clickable version text in either sidebar. Content lives in AboutPanel so the
// same view is reused as a Settings / Account panel.
export default function ChangelogModal({ onClose }) {
  return (
    <Modal onClose={onClose} size="sm">
      <div className="pr-8"><AboutPanel /></div>
    </Modal>
  )
}
