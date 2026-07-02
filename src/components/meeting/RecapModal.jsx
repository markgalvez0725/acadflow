import React, { useState, useEffect, useMemo } from 'react'
import { Sparkles, FileText, ListChecks, RefreshCw, Share2, Download, Search, Loader2 } from 'lucide-react'
import Modal from '@/components/primitives/Modal'
import RichText from '@/components/primitives/RichText'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

// The class panel for a past in-app meeting: one modal, two tabs.
//   Summary    - the rich-text Smart Recap (meeting.recap)
//   Transcript - the full timestamped discussion (searchable)
// Shared by the professor and student Online Classes tabs. The professor also
// gets Regenerate, Download, Post to Stream and the transcript .txt export;
// students get a read-only view. `initialTab` lets the row buttons land on
// either tab ("Recap" -> summary, "Transcript" -> transcript).
//   meeting - onlineMeetings doc (recap optional)
//   canManage - professor-only actions
//   initialTab - 'summary' | 'transcript'

function two(n) { return String(n).padStart(2, '0') }

function segTime(seg) {
  const t = new Date(seg.at || 0)
  return `${two(t.getHours())}:${two(t.getMinutes())}`
}

// Full transcript as "[hh:mm] Name: text" lines (no length cap - this is the
// download, unlike utils/meetingRecap's server-bound transcriptToText).
function transcriptToTxt(segs) {
  return (segs || []).map(seg => `[${segTime(seg)}] ${seg.name}: ${seg.text}`).join('\n')
}

// Plain-text version of the recap HTML for download. DOMParser documents are
// inert (nothing executes or loads), so this is a safe way to walk the markup.
function recapToText(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    const out = []
    doc.body.querySelectorAll('h4, p, li').forEach(el => {
      const t = (el.textContent || '').trim()
      if (!t) return
      if (el.tagName === 'H4') { out.push('', t.toUpperCase(), '') }
      else if (el.tagName === 'LI') { out.push('- ' + t) }
      else { out.push(t) }
    })
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch { return '' }
}

function downloadText(filename, text) {
  const safe = String(filename).replace(/[^\p{L}\p{N} ().-]/gu, '-')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = safe
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function RecapModal({ meeting, canManage, onClose, initialTab = 'summary' }) {
  const { generateMeetingRecap, fetchMeetingTranscript, saveAnnouncement, pushAnnouncementNotifs } = useData()
  const { toast } = useUI()
  const [tab, setTab] = useState(initialTab === 'transcript' ? 'transcript' : 'summary')
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [transcript, setTranscript] = useState(null) // null = not fetched yet

  const recap = meeting?.recap
  const title = meeting?.title || meeting?.className || 'Online class'

  useEffect(() => {
    if (tab !== 'transcript' || transcript !== null || !meeting?.id) return
    let dead = false
    fetchMeetingTranscript(meeting.id).then(segs => { if (!dead) setTranscript(segs) })
    return () => { dead = true }
  }, [tab, transcript, meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (!Array.isArray(transcript)) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return transcript
    return transcript.filter(seg =>
      String(seg.text || '').toLowerCase().includes(needle)
      || String(seg.name || '').toLowerCase().includes(needle)
    )
  }, [transcript, q])

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

  function handleDownloadRecap() {
    if (!recap?.html) return
    const text = recapToText(recap.html)
    if (!text) { toast('Nothing to download yet.', 'error'); return }
    downloadText(`Recap - ${title}.txt`, `Class recap - ${title}\n\n${text}\n`)
  }

  async function handleDownloadTranscript() {
    let segs = transcript
    if (!Array.isArray(segs)) {
      segs = await fetchMeetingTranscript(meeting.id)
      setTranscript(segs)
    }
    if (!segs.length) { toast('No transcript was captured for this class.', 'error'); return }
    downloadText(`Transcript - ${title}.txt`, transcriptToTxt(segs) + '\n')
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
      draggable
      icon={<Sparkles size={18} />}
      title={`Class recap - ${title}`}
      subtitle={meta}
      footer={canManage ? (
        <>
          <div style={{ display: 'flex', gap: 8, marginRight: 'auto', flex: '1 1 auto' }}>
            <button className="btn btn-ghost" onClick={handleRegenerate} disabled={!!busy}>
              {busy === 'regen' ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> : <RefreshCw size={14} style={{ marginRight: 6 }} />}
              Regenerate
            </button>
            <button
              className="btn btn-ghost"
              onClick={tab === 'transcript' ? handleDownloadTranscript : handleDownloadRecap}
              disabled={tab === 'summary' && !recap}
              title={tab === 'transcript' ? 'Download the full transcript as .txt' : 'Download the recap as .txt'}
            >
              <Download size={14} style={{ marginRight: 6 }} /> Download
            </button>
          </div>
          <button className="btn btn-primary" onClick={handlePostToStream} disabled={!!busy || !recap}>
            {busy === 'post' ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> : <Share2 size={14} style={{ marginRight: 6 }} />}
            Post to Stream
          </button>
        </>
      ) : (
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      )}
    >
      <div className="seg-filter" style={{ marginBottom: 14 }}>
        <button className={`seg-btn${tab === 'summary' ? ' active' : ''}`} onClick={() => setTab('summary')}>
          <ListChecks size={14} /> Summary
        </button>
        <button className={`seg-btn${tab === 'transcript' ? ' active' : ''}`} onClick={() => setTab('transcript')}>
          <FileText size={14} /> Transcript
        </button>
      </div>

      {tab === 'summary' ? (
        recap ? (
          <RichText html={recap.html} />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink3)' }}>
            No recap yet for this class{canManage ? ' - use Regenerate to build one from the transcript.' : '.'}
          </p>
        )
      ) : (
        <>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Search the discussion"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Search the transcript"
            />
          </div>
          {transcript === null ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
              <Loader2 size={13} className="animate-spin" style={{ marginRight: 6, verticalAlign: -2 }} />Loading transcript…
            </p>
          ) : transcript.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No transcript was captured for this class.</p>
          ) : shown.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No lines match "{q.trim()}".</p>
          ) : (
            <div>
              {shown.map((seg, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', paddingTop: 2 }}>
                    {segTime(seg)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: seg.role === 'admin' ? 'var(--accent)' : 'var(--ink2)' }}>
                      {seg.name}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{seg.text}</div>
                  </div>
                </div>
              ))}
              <p style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 10, textAlign: 'center' }}>
                {q.trim() ? `${shown.length} of ${transcript.length}` : `${transcript.length}`} line{(q.trim() ? shown.length : transcript.length) !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
