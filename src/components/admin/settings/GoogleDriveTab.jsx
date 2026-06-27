import React, { useState } from 'react'
import { useUI } from '@/context/UIContext'
import { HardDrive, CheckCircle2, FolderOpen, AlertTriangle } from 'lucide-react'
import { getConnection, connect, disconnect } from '@/utils/googleDrive'

// Settings panel for the teacher's Google Drive connection. Browser-only:
// connecting consents once via Google, then Stream uploads land in the teacher's
// own /AcadFlow Stream folder. See src/utils/googleDrive.js.
export default function GoogleDriveTab() {
  const { toast } = useUI()
  const [conn, setConn] = useState(getConnection())
  const [busy, setBusy] = useState(false)

  async function handleConnect() {
    setBusy(true)
    try {
      const c = await connect()
      setConn(c)
      toast('Google Drive connected.', 'success')
    } catch (e) {
      toast(e?.message || 'Could not connect to Google Drive.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function handleDisconnect() {
    disconnect()
    setConn(getConnection())
    toast('Google Drive disconnected.')
  }

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, background: conn.connected ? 'rgba(16,185,129,.14)' : 'var(--bg2)', color: conn.connected ? '#10b981' : 'var(--ink2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <HardDrive size={20} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Google Drive</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Upload files and photos to Stream posts</div>
      </div>
    </div>
  )

  if (!conn.configured) {
    return (
      <div>
        {head}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--yellow-l, rgba(245,158,11,.12))', borderRadius: 10, padding: '12px 14px' }}>
          <AlertTriangle size={16} style={{ color: 'var(--yellow, #f59e0b)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.55 }}>
            Google Drive is not configured for this deployment. Add a <code>VITE_GOOGLE_CLIENT_ID</code> environment variable (a free Google OAuth client) in your hosting settings, then redeploy. Until then, you can still paste a Drive or Docs link into a post and it previews inline.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {head}
      <p style={{ fontSize: 12.5, color: 'var(--ink3)', lineHeight: 1.55, margin: '0 0 14px' }}>
        Files you attach to a Stream post are stored in your own Drive under <strong style={{ color: 'var(--ink2)' }}>AcadFlow / program / Photos or Modules</strong> (grouped by program like BSIT, photos in Photos, documents in Modules), and shared as view-only. Students only ever see the preview, never your other files.
      </p>

      {conn.connected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#10b981', fontWeight: 600 }}>
            <CheckCircle2 size={16} /> Connected
            <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>· {conn.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg2)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--ink2)' }}>
            <FolderOpen size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} /> AcadFlow <span style={{ color: 'var(--ink3)' }}>· by program, then Photos / Modules</span>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', color: 'var(--red)' }} onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={handleConnect} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Connecting…' : 'Connect Google Drive'}
        </button>
      )}
    </div>
  )
}
