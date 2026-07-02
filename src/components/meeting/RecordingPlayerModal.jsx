import React from 'react'
import { ExternalLink } from 'lucide-react'
import Modal from '@/components/primitives/Modal'

// Resolve the Drive file id of a meeting's recording. The id alone is enough
// for both the embedded player and a view link, even on older docs that
// saved without webViewLink.
export function recordingDriveId(m) {
  const rec = m?.recording
  if (!rec) return ''
  if (rec.driveId) return rec.driveId
  const match = String(rec.link || '').match(/\/file\/d\/([\w-]+)/)
  return match ? match[1] : ''
}

// Watch a class recording INSIDE AcadFlow: embeds Drive's own player (the
// same Drive embed the Stream tab already renders; the deployed CSP allows
// https frames). Students only reach this after Share to class flips the
// file to anyone-with-link, so playback needs no Google sign-in.
export default function RecordingPlayerModal({ meeting, onClose }) {
  const id = recordingDriveId(meeting)
  const link = meeting?.recording?.link || (id ? `https://drive.google.com/file/d/${id}/view` : '')
  const dt = new Date(meeting?.endedAt || meeting?.scheduledAt || Date.now())
  const durMs = meeting?.endedAt && meeting?.scheduledAt ? meeting.endedAt - meeting.scheduledAt : 0
  const durMin = durMs > 0 && durMs < 12 * 3600000 ? Math.max(1, Math.round(durMs / 60000)) : null
  const sub = [
    meeting?.className,
    meeting?.subject,
    dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    durMin ? `${durMin} min` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Modal
      onClose={onClose}
      size="lg"
      padded={false}
      title={meeting?.title || 'Class recording'}
      subtitle={sub}
      footer={(
        <>
          <span className="recplay-note">Streams from the professor's Drive</span>
          {link && (
            <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} style={{ marginRight: 4 }} /> Open in Drive
            </a>
          )}
        </>
      )}
    >
      {id ? (
        <iframe
          className="recplay-frame"
          src={`https://drive.google.com/file/d/${id}/preview`}
          title="Class recording"
          allow="autoplay; fullscreen"
          allowFullScreen
        />
      ) : (
        <div className="recplay-missing">The recording file could not be found.</div>
      )}
    </Modal>
  )
}
