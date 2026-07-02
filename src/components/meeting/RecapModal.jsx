import React, { useState, useEffect } from 'react'
import { Sparkles, FileText, RefreshCw, Share2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import Modal from '@/components/primitives/Modal'
import RichText from '@/components/primitives/RichText'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

// Viewer for a meeting's Smart Recap (meeting.recap, written at End class).
// Shared by the professor and student Online Classes tabs. The professor also
// gets Regenerate and Post to Stream; the full transcript is collapsible and
// fetched only when opened.
//   meeting - onlineMeetings doc with .recap
//   canManage - professor-only actions
export default function RecapModal({ meeting, canManage, onClose }) {
  const { generateMeetingRecap, fetchMeetingTranscript, saveAnnouncement, pushAnnouncementNotifs } = useData()
  const { toast } = useUI()
  const [busy, setBusy] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcript, setTranscript] = useState(null) // null = not fetched yet

  const recap = meeting?.recap

  useEffect(() => {
    if (!transcriptOpen || transcript !== null || !meeting?.id) return
    let dead = false
    fetchMeetingTranscript(meeting.id).then(segs => { if (!dead) setTranscript(segs) })
    return () => { dead = true }
  }, [transcriptOpen, transcript, meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRegenerate() {
    setBusy('regen')
    try {
      const r = await generateMeetingRecap(meeting)
      toast(r ? 'Recap regenerated.' : 'No transcript found for this class.', r ? 'success' : 'error')
    } catch {
      toast('Failed to regenerate the recap.', 'error')
    } finally {
      setBusy('')
    }
  }

  async function handlePostToStream() {
    if (!recap?.html) return
    setBusy('post')
    try {
      const announcement = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        type: 'general',
        classId: meeting.classId,
        classIds: [meeting.classId],
        subject: meeting.subject || null,
        title: `Class recap: ${meeting.title || meeting.className || 'Online class'}`,
        message: recap.html,
        meetingLink: null,
        moduleLink: null,
        referenceVideo: null,
        topics: null,
        createdAt: Date.now(),
        active: true,
        expiresAt: null,
        comments: [],
        attachments: [],
        pinned: false,
        publishAt: null,
      }
      await saveAnnouncement(announcement)
      await pushAnnouncementNotifs(announcement)
      toast('Recap posted to the class Stream.', 'success')
    } catch {
      toast('Failed to post the recap.', 'error')
    } finally {
      setBusy('')
    }
  }

  const meta = recap ? [
    recap.durationMin ? `${recap.durationMin} min` : null,
    recap.speakers ? `${recap.speakers} speaker${recap.speakers !== 1 ? 's' : ''}` : null,
    recap.lines ? `${recap.lines} lines transcribed` : null,
    recap.engine === 'smart' ? 'Smart summary' : 'Smart Recap · on-device',
  ].filter(Boolean).join(' · ') : ''

  return (
    <Modal
      onClose={onClose}
      sheetOnMobile
      icon={<Sparkles size={18} />}
      title={`Class recap - ${meeting?.title || meeting?.className || 'Online class'}`}
      subtitle={meta}
      footer={canManage ? (
        <>
          <button className="btn btn-ghost" onClick={handleRegenerate} disabled={!!busy}>
            {busy === 'regen' ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> : <RefreshCw size={14} style={{ marginRight: 6 }} />}
            Regenerate
          </button>
          <button className="btn btn-primary" onClick={handlePostToStream} disabled={!!busy || !recap}>
            {busy === 'post' ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> : <Share2 size={14} style={{ marginRight: 6 }} />}
            Post to Stream
          </button>
        </>
      ) : (
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      )}
    >
      {recap ? (
        <RichText html={recap.html} />
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink3)' }}>
          No recap yet for this class{canManage ? ' - use Regenerate to build one from the transcript.' : '.'}
        </p>
      )}

      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 14 }}
        onClick={() => setTranscriptOpen(o => !o)}
      >
        {transcriptOpen ? <ChevronUp size={14} style={{ marginRight: 5 }} /> : <ChevronDown size={14} style={{ marginRight: 5 }} />}
        <FileText size={14} style={{ marginRight: 5 }} />
        {transcriptOpen ? 'Hide transcript' : 'View full transcript'}
      </button>

      {transcriptOpen && (
        <div style={{ marginTop: 10, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
          {transcript === null ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)' }}><Loader2 size={13} className="animate-spin" style={{ marginRight: 6, verticalAlign: -2 }} />Loading transcript…</p>
          ) : transcript.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No transcript was captured for this class.</p>
          ) : (
            transcript.map((seg, i) => (
              <p key={i} style={{ fontSize: 12.5, margin: '0 0 7px', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--ink3)', fontSize: 11 }}>
                  {new Date(seg.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
                </span>{' '}
                <strong>{seg.name}:</strong> {seg.text}
              </p>
            ))
          )}
        </div>
      )}
    </Modal>
  )
}
