// Browser-only Google Drive integration for teacher file uploads on the Stream.
//
// Uses Google Identity Services (GIS) token client with the `drive.file` scope -
// the app can ONLY see files/folders it creates, so the consent is light and no
// Google verification is needed. No server and no refresh token: the access
// token lives in memory for ~1 hour and is re-requested (silently when the
// teacher has already consented) on demand. $0 - files live in the teacher's own
// Drive and students only ever load the public preview link.
//
// Files are filed into a nested tree the app builds and reuses:
//   AcadFlow / {Class label} / {Photos | Modules} / file
// (images -> Photos, everything else -> Modules). Each folder id is cached in
// localStorage keyed by its parent so the tree is only looked up once.
//
// Requires VITE_GOOGLE_CLIENT_ID. When unset, isConfigured() is false and the
// UI shows a "not configured" hint instead of a dead button.

import { loadScriptOnce } from '@/utils/cdnLoader'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const ROOT_NAME = 'AcadFlow'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

const LS_EMAIL = 'gdrive_email'
const SS_TOKEN = 'gdrive_token' // sessionStorage: { access_token, expires_at }
const DIR_PREFIX = 'gdrive_dir:' // + `${parentId}/${name}` -> folderId

let _tokenClient = null

// The access token is cached in sessionStorage (not just memory) so a page
// reload within the ~1h lifetime reuses it instead of re-prompting Google. It is
// scoped to the tab and cleared on disconnect.
function loadStoredToken() {
  try {
    const raw = sessionStorage.getItem(SS_TOKEN)
    if (raw) {
      const t = JSON.parse(raw)
      if (t && t.access_token && Date.now() < t.expires_at - 60000) return t
    }
  } catch { /* ignore */ }
  return null
}
let _token = loadStoredToken() // { access_token, expires_at }

function storeToken(access_token, expires_in) {
  _token = { access_token, expires_at: Date.now() + (Number(expires_in) || 3600) * 1000 }
  try { sessionStorage.setItem(SS_TOKEN, JSON.stringify(_token)) } catch { /* ignore */ }
  return _token.access_token
}

export function isConfigured() { return !!CLIENT_ID }

export function getConnection() {
  return {
    configured: isConfigured(),
    connected: !!localStorage.getItem(LS_EMAIL),
    email: localStorage.getItem(LS_EMAIL) || '',
  }
}

function loadGis() {
  // loadScriptOnce never caches a failure, so a blocked/offline first attempt
  // retries on the next call (the old promise cached its rejection forever)
  // and a stalled CDN now times out instead of hanging. No mirror exists for
  // Google Identity Services - it must come from accounts.google.com.
  return loadScriptOnce(GSI_SRC, { globalKey: 'google' })
    .catch(() => { throw new Error('Could not load Google sign-in.') })
}

async function getTokenClient() {
  await loadGis()
  if (!_tokenClient) {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      // login_hint = the already-connected account, so a silent refresh skips the
      // account chooser instead of prompting the teacher to pick/sign in again.
      hint: localStorage.getItem(LS_EMAIL) || undefined,
      callback: () => {},
    })
  }
  return _tokenClient
}

function tokenValid() {
  return _token && _token.access_token && Date.now() < _token.expires_at - 60000
}

// interactive=true forces the account/consent popup; false attempts a silent grant.
function requestToken(interactive) {
  return new Promise((resolve, reject) => {
    getTokenClient().then(client => {
      client.callback = resp => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return }
        resolve(storeToken(resp.access_token, resp.expires_in))
      }
      try { client.requestAccessToken({ prompt: interactive ? 'consent' : '' }) }
      catch (e) { reject(e) }
    }).catch(reject)
  })
}

async function getToken() {
  if (tokenValid()) return _token.access_token
  try { return await requestToken(false) }
  catch { return await requestToken(true) }
}

async function driveFetch(url, opts = {}) {
  const token = await getToken()
  const resp = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`Drive error ${resp.status}: ${txt.slice(0, 160)}`)
  }
  return resp.json()
}

// Find-or-create a single folder `name` under `parentId` ('root' for My Drive).
async function ensureFolder(name, parentId) {
  const key = DIR_PREFIX + parentId + '/' + name
  const cached = localStorage.getItem(key)
  if (cached) return cached
  const safe = String(name).replace(/'/g, "\\'")
  const q = encodeURIComponent(`name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`)
  const found = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)
  let id = found?.files?.[0]?.id
  if (!id) {
    const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    })
    id = created.id
  }
  if (id) localStorage.setItem(key, id)
  return id
}

// Walk/create a path of folder names; returns the leaf folder id.
async function ensureFolderPath(segments) {
  let parent = 'root'
  for (const seg of segments.filter(Boolean)) parent = await ensureFolder(seg, parent)
  return parent
}

function clearFolderCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && k.startsWith(DIR_PREFIX)) localStorage.removeItem(k)
  }
}

// Connect: interactive consent, cache the user's email, pre-create the root.
export async function connect() {
  if (!isConfigured()) throw new Error('Google Drive is not configured.')
  await requestToken(true)
  try {
    const about = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')
    localStorage.setItem(LS_EMAIL, about?.user?.emailAddress || 'Connected')
  } catch { localStorage.setItem(LS_EMAIL, 'Connected') }
  await ensureFolderPath([ROOT_NAME])
  return getConnection()
}

export function disconnect() {
  try {
    if (_token?.access_token && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(_token.access_token, () => {})
    }
  } catch { /* ignore */ }
  _token = null
  try { sessionStorage.removeItem(SS_TOKEN) } catch { /* ignore */ }
  localStorage.removeItem(LS_EMAIL)
  clearFolderCache()
}

// List files AcadFlow previously uploaded so a teacher can re-attach one without
// re-uploading. Under the drive.file scope the app can ONLY see files it created,
// so a plain "not a folder, not trashed" query returns exactly those files - no
// need to walk the folder tree. They were shared "anyone with link" on upload, so
// the same preview/download pipeline works. Returns attachment-shaped descriptors.
export async function listDriveFiles({ pageSize = 100 } = {}) {
  const q = encodeURIComponent("mimeType != 'application/vnd.google-apps.folder' and trashed = false")
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime)')
  const data = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=${pageSize}&spaces=drive`
  )
  return (data.files || []).map(f => ({
    driveId: f.id,
    name: f.name || 'File',
    mimeType: f.mimeType || '',
    size: Number(f.size) || 0,
    modifiedTime: f.modifiedTime || '',
  }))
}

// Max size accepted for a student activity submission.
export const SUBMISSION_MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const SUBMISSION_ROOT = 'AcadFlow Submissions'

// Upload one student submission File into
//   AcadFlow Submissions / {folderPath...} / file
// in the STUDENT's own Drive, make it "anyone with link can view" so the
// professor can open it, and resolve with the shareable webViewLink (stored as
// the submission link, so the professor's view is unchanged). Distinct root
// from uploadFile() so a student's submissions never mix with teacher Stream
// uploads. The caller verifies size/type first; the size cap is re-checked here.
export function uploadSubmission(file, { onProgress, folderPath } = {}) {
  return new Promise((resolve, reject) => {
    (async () => {
      if (!file) throw new Error('No file selected.')
      if (file.size > SUBMISSION_MAX_BYTES) throw new Error('That file is over the 25 MB limit.')
      const token = await getToken()
      const folderId = await ensureFolderPath([SUBMISSION_ROOT, ...(folderPath || []).filter(Boolean)])
      const meta = { name: file.name, ...(folderId ? { parents: [folderId] } : {}) }
      const boundary = 'acadflow' + Math.random().toString(36).slice(2)
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
      const tail = `\r\n--${boundary}--`
      const body = new Blob([head, file, tail], { type: `multipart/related; boundary=${boundary}` })

      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink')
      xhr.setRequestHeader('Authorization', 'Bearer ' + token)
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('Upload failed (' + xhr.status + ').')); return }
        const f = JSON.parse(xhr.responseText)
        const link = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
        driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        }).catch(() => { /* link-sharing best-effort */ }).finally(() => {
          resolve({ driveId: f.id, name: f.name || file.name, link })
        })
      }
      xhr.onerror = () => reject(new Error('Upload failed.'))
      xhr.send(body)
    })().catch(reject)
  })
}

// ── Resumable upload: stream a class RECORDING into Drive while it records ──
// Drive's resumable protocol lets us upload an open-ended file in ordered
// chunks: every non-final chunk must be a multiple of 256 KiB (we send 8 MiB),
// the final chunk declares the total size. The professor's recorder appends
// MediaRecorder blobs as the class runs, so ending the class only has the
// small tail left to upload - and a crash mid-class loses nothing already
// sent. The session URI itself carries the grant, so an expiring OAuth token
// cannot break an hour-long upload. The file stays PRIVATE in the
// professor's Drive (no anyone-with-link permission is added).
export function startResumableUpload({ name, mimeType = 'video/webm', folderPath = [] }) {
  const CHUNK = 8 * 1024 * 1024
  let sessionUri = null
  let buffer = []      // pending blobs, in order
  let buffered = 0
  let offset = 0       // bytes confirmed sent to Drive
  let aborted = false

  let fileId = ''
  let fileLink = ''

  async function init() {
    const token = await getToken()
    const folderId = await ensureFolderPath([ROOT_NAME, ...folderPath.filter(Boolean)])
    // Create the (empty) file FIRST so its id + view link are known up front -
    // the recording link must never depend on parsing the final chunk's
    // response. The resumable session then streams content INTO that file.
    const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, ...(folderId ? { parents: [folderId] } : {}) }),
    })
    fileId = created.id
    fileLink = created.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '')
    if (!fileId) throw new Error('Drive did not create the recording file.')
    const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=resumable`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({}),
    })
    if (!resp.ok) throw new Error(`Could not start the Drive upload (${resp.status}).`)
    sessionUri = resp.headers.get('Location')
    if (!sessionUri) throw new Error('Drive did not return an upload session.')
  }

  async function putChunk(blob, isLast, total) {
    const end = offset + blob.size - 1
    const range = blob.size
      ? `bytes ${offset}-${end}/${isLast ? total : '*'}`
      : `bytes */${total}` // zero-byte finalize
    let resp = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await fetch(sessionUri, {
          method: 'PUT',
          headers: { 'Content-Range': range },
          ...(blob.size ? { body: blob } : {}),
        })
        if (resp.status === 308 || resp.ok) break
      } catch { resp = null }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
    }
    if (!resp || (resp.status !== 308 && !resp.ok)) throw new Error('Drive upload failed mid-recording.')
    offset += blob.size
    return resp
  }

  // All puts are serialized on this chain - resumable chunks must arrive in
  // order, and the chain starts only after the session exists.
  let chain = init()

  function drain() {
    if (buffered < CHUNK) return
    const all = new Blob(buffer, { type: mimeType })
    const sendSize = Math.floor(all.size / CHUNK) * CHUNK
    const head = all.slice(0, sendSize)
    const rest = all.slice(sendSize)
    buffer = rest.size ? [rest] : []
    buffered = rest.size
    chain = chain.then(() => { if (!aborted) return putChunk(head, false) })
  }

  return {
    append(blob) {
      if (aborted || !blob || !blob.size) return
      buffer.push(blob)
      buffered += blob.size
      drain()
    },
    // Uploads the tail, finalizes, and resolves { driveId, link, bytes }.
    // id/link come from the up-front file creation, never from response parsing.
    async finish() {
      const tail = new Blob(buffer.splice(0), { type: mimeType })
      buffered = 0
      chain = chain.then(async () => {
        const total = offset + tail.size
        await putChunk(tail, true, total)
      })
      await chain
      return { driveId: fileId, link: fileLink, bytes: offset }
    },
    abort() {
      aborted = true
      buffer = []
      buffered = 0
      chain.then(() => { if (sessionUri) fetch(sessionUri, { method: 'DELETE' }).catch(() => {}) }).catch(() => {})
    },
  }
}

// Make an existing Drive file (e.g. a class recording) viewable by anyone
// with the link, so the professor can share it to students. Deliberately a
// separate, explicit action - recordings stay private until shared.
export async function shareDriveFile(driveId) {
  if (!driveId) throw new Error('No Drive file to share.')
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

// Upload one File into AcadFlow / {classLabel} / {Photos|Modules}, make it
// "anyone with link can view", and return an attachment descriptor.
export function uploadFile(file, { onProgress, classLabel } = {}) {
  return new Promise((resolve, reject) => {
    (async () => {
      const token = await getToken()
      const kind = /^image\//.test(file.type || '') ? 'Photos' : 'Modules'
      const folderId = await ensureFolderPath([ROOT_NAME, classLabel || 'General', kind])
      const meta = { name: file.name, ...(folderId ? { parents: [folderId] } : {}) }
      const boundary = 'acadflow' + Math.random().toString(36).slice(2)
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
      const tail = `\r\n--${boundary}--`
      const body = new Blob([head, file, tail], { type: `multipart/related; boundary=${boundary}` })

      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size')
      xhr.setRequestHeader('Authorization', 'Bearer ' + token)
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('Upload failed (' + xhr.status + ').')); return }
        const f = JSON.parse(xhr.responseText)
        driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        }).catch(() => { /* link-sharing best-effort */ }).finally(() => {
          resolve({ driveId: f.id, name: f.name || file.name, mimeType: f.mimeType || file.type || '', size: Number(f.size) || file.size || 0 })
        })
      }
      xhr.onerror = () => reject(new Error('Upload failed.'))
      xhr.send(body)
    })().catch(reject)
  })
}
