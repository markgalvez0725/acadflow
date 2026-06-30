import React, { useState, useRef } from 'react'
import { Upload, FileText, X, CheckCircle2, Cloud } from 'lucide-react'
import { isConfigured as driveConfigured, getConnection as getDriveConnection, connect as driveConnect, SUBMISSION_MAX_BYTES } from '@/utils/googleDrive'
import { useUI } from '@/context/UIContext'

// Student submission file field: connect their OWN Google Drive once, pick a
// file (verified for size on pick, nothing uploads yet), and hand the File back
// to the parent. The parent uploads it on Submit via uploadSubmission() and
// stores the returned share link. Renders nothing when Drive is not configured
// for the site, so the card silently falls back to link-paste only.
function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

export default function SubmissionFileField({ file, onPick, progress, disabled }) {
  const { toast } = useUI()
  const [conn, setConn] = useState(() => getDriveConnection())
  const [connecting, setConnecting] = useState(false)
  const inputRef = useRef(null)

  if (!driveConfigured()) return null

  async function handleConnect() {
    setConnecting(true)
    try { await driveConnect(); setConn(getDriveConnection()) }
    catch (e) { toast('Could not connect Google Drive: ' + e.message, 'error') }
    finally { setConnecting(false) }
  }

  function handleFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > SUBMISSION_MAX_BYTES) { toast('That file is over the 25 MB limit.', 'warn'); return }
    if (f.size === 0) { toast('That file looks empty.', 'warn'); return }
    onPick(f)
  }

  // Uploading: show the file with a progress bar.
  if (progress != null) {
    return (
      <div className="sa-drive-file">
        <FileText size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sa-drive-name">{file?.name}</div>
          <div className="sa-drive-bar"><span style={{ width: progress + '%' }} /></div>
        </div>
        <span className="sa-drive-pct">{progress}%</span>
      </div>
    )
  }

  // A verified file is staged, ready to submit.
  if (file) {
    return (
      <div className="sa-drive-file">
        <FileText size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sa-drive-name">{file.name}</div>
          <div className="sa-drive-ok"><CheckCircle2 size={12} /> {fmtSize(file.size)} · verified</div>
        </div>
        <button type="button" className="sa-drive-x" onClick={() => onPick(null)} disabled={disabled} aria-label="Remove file"><X size={14} /></button>
      </div>
    )
  }

  if (!conn.connected) {
    return (
      <button type="button" className="sa-drive-connect" onClick={handleConnect} disabled={connecting || disabled}>
        <Cloud size={15} /> {connecting ? 'Connecting…' : 'Connect Google Drive to attach a file'}
      </button>
    )
  }

  return (
    <>
      <button type="button" className="sa-drive-pick" onClick={() => inputRef.current?.click()} disabled={disabled}>
        <Upload size={15} /> Attach a file (up to 25 MB) · uploads to your Drive
      </button>
      <input ref={inputRef} type="file" hidden onChange={handleFile} />
    </>
  )
}
