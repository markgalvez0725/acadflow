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

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const ROOT_NAME = 'AcadFlow'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

const LS_EMAIL = 'gdrive_email'
const DIR_PREFIX = 'gdrive_dir:' // + `${parentId}/${name}` -> folderId

let _gisPromise = null
let _tokenClient = null
let _token = null // { access_token, expires_at }

export function isConfigured() { return !!CLIENT_ID }

export function getConnection() {
  return {
    configured: isConfigured(),
    connected: !!localStorage.getItem(LS_EMAIL),
    email: localStorage.getItem(LS_EMAIL) || '',
  }
}

function loadGis() {
  if (_gisPromise) return _gisPromise
  _gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return }
    const s = document.createElement('script')
    s.src = GSI_SRC; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Google sign-in.'))
    document.head.appendChild(s)
  })
  return _gisPromise
}

async function getTokenClient() {
  await loadGis()
  if (!_tokenClient) {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
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
        _token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 }
        resolve(_token.access_token)
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
  localStorage.removeItem(LS_EMAIL)
  clearFolderCache()
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
