// Browser-only Google Drive integration for teacher file uploads on the Stream.
//
// Uses Google Identity Services (GIS) token client with the `drive.file` scope -
// the app can ONLY see files it creates, so the consent is light and no Google
// verification is needed. No server and no refresh token: the access token lives
// in memory for ~1 hour and is re-requested (silently when the teacher has
// already consented) on demand. $0 - files live in the teacher's own Drive and
// students only ever load the public preview link.
//
// Requires VITE_GOOGLE_CLIENT_ID. When it is unset, isConfigured() is false and
// the UI shows a "not configured" hint instead of a dead button.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'AcadFlow Stream'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

const LS_EMAIL = 'gdrive_email'
const LS_FOLDER = 'gdrive_folder'

let _gisPromise = null
let _tokenClient = null
let _token = null // { access_token, expires_at }

export function isConfigured() { return !!CLIENT_ID }

export function getConnection() {
  return {
    configured: isConfigured(),
    connected: !!localStorage.getItem(LS_EMAIL),
    email: localStorage.getItem(LS_EMAIL) || '',
    folderId: localStorage.getItem(LS_FOLDER) || '',
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

// Find or create the /AcadFlow Stream folder; cache its id locally.
async function ensureFolder() {
  const cached = localStorage.getItem(LS_FOLDER)
  if (cached) return cached
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const found = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`)
  let id = found?.files?.[0]?.id
  if (!id) {
    const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })
    id = created.id
  }
  if (id) localStorage.setItem(LS_FOLDER, id)
  return id
}

// Connect: interactive consent, then cache the user's email + ensure the folder.
export async function connect() {
  if (!isConfigured()) throw new Error('Google Drive is not configured.')
  await requestToken(true)
  try {
    const about = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')
    localStorage.setItem(LS_EMAIL, about?.user?.emailAddress || 'Connected')
  } catch { localStorage.setItem(LS_EMAIL, 'Connected') }
  await ensureFolder()
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
  localStorage.removeItem(LS_FOLDER)
}

// Upload one File to the folder, make it "anyone with link can view", and
// return an attachment descriptor for announcement.attachments[].
export function uploadFile(file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    (async () => {
      const token = await getToken()
      const folderId = await ensureFolder()
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
