// ── Deadline reminder cron (Vercel Cron) ─────────────────────────────────
// Runs on a schedule (see vercel.json `crons`). Finds activities due within the
// next 24 hours, and for each enrolled student who hasn't submitted, sends a
// web-push reminder via FCM. Activities are marked with `reminderSentAt` so a
// reminder fires at most once per ~day even if the cron runs again.
//
// Setup (one-time):
//   1. Vercel → Settings → Environment Variables → add CRON_SECRET = <random string>.
//      Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>`.
//   2. FB_ADMIN_SERVICE_ACCOUNT (or FCM_SERVICE_ACCOUNT) must already be set -
//      the same service account used by /api/send-push works here.
//
// This endpoint only sends WEB PUSH (best-effort). The in-app notification +
// push "Remind Missing" button in the Activities tab covers the manual path.
import { loadServiceAccount, getAccessToken } from './_fbadmin.js'

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
}

// ── Firestore REST value parsing ──────────────────────────────────────────
function fsVal(v) {
  if (v == null) return null
  if ('stringValue'    in v) return v.stringValue
  if ('integerValue'   in v) return Number(v.integerValue)
  if ('doubleValue'    in v) return v.doubleValue
  if ('booleanValue'   in v) return v.booleanValue
  if ('timestampValue' in v) return v.timestampValue
  if ('nullValue'      in v) return null
  if ('mapValue'       in v) return fsFields(v.mapValue.fields || {})
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fsVal)
  return null
}
function fsFields(fields) {
  const o = {}
  for (const k in fields) o[k] = fsVal(fields[k])
  return o
}

// List every document in a collection, following pagination.
async function listCollection(projectId, accessToken, coll) {
  const out = []
  let pageToken = ''
  do {
    const url = `${fsBase(projectId)}/${coll}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data = await r.json()
    if (!r.ok) throw new Error(data?.error?.message || `list ${coll} failed`)
    for (const doc of data.documents || []) {
      const id = doc.name.split('/').pop()
      out.push({ _id: id, ...fsFields(doc.fields || {}) })
    }
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return out
}

function enrolledIdsOf(s) {
  return (s.classIds && s.classIds.length) ? s.classIds : (s.classId ? [s.classId] : [])
}

export default async function handler(req, res) {
  // Auth: when CRON_SECRET is set, Vercel sends it as a Bearer token.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || req.headers.Authorization || ''
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })
  }

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Not configured (service account missing)' })
  const projectId = sa.project_id

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Auth failed: ' + e.message }) }

  const now = Date.now()
  const WINDOW = 24 * 60 * 60 * 1000          // remind for deadlines within 24h
  const COOLDOWN = 20 * 60 * 60 * 1000        // don't re-remind within 20h

  let activities, students, tokenDocs
  try {
    [activities, students, tokenDocs] = await Promise.all([
      listCollection(projectId, accessToken, 'activities'),
      listCollection(projectId, accessToken, 'students'),
      listCollection(projectId, accessToken, 'pushTokens'),
    ])
  } catch (e) {
    return res.status(502).json({ error: 'Firestore read failed: ' + e.message })
  }

  // Index push tokens by owner id.
  const tokensByOwner = {}
  for (const t of tokenDocs) {
    if (!t.token || !t.ownerId) continue
    ;(tokensByOwner[t.ownerId] || (tokensByOwner[t.ownerId] = [])).push(t.token)
  }

  const messages = []          // { token, title, body }
  const activitiesToMark = []

  for (const act of activities) {
    const deadline = Number(act.deadline) || 0
    if (!deadline || deadline <= now || deadline > now + WINDOW) continue
    if (act.reminderSentAt && now - Number(act.reminderSentAt) < COOLDOWN) continue

    const subs = act.submissions || {}
    const missing = students.filter(s => {
      const sid = s.id || s._id
      if (!enrolledIdsOf(s).includes(act.classId)) return false
      if (!(s.account && s.account.registered)) return false
      const sub = subs[sid]
      return !(sub && sub.link)
    })
    if (!missing.length) continue

    const dlLabel = new Date(deadline).toLocaleString('en-US', {
      timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    for (const s of missing) {
      const toks = tokensByOwner[s.id || s._id] || []
      for (const tk of toks) {
        messages.push({
          token: tk,
          title: `Reminder: ${act.title}`,
          body: `${act.subject || ''} - due ${dlLabel}. Don't forget to submit.`,
        })
      }
    }
    activitiesToMark.push(act._id)
  }

  // Send web push (best-effort).
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
  const results = await Promise.allSettled(messages.slice(0, 500).map(m =>
    fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: { url: 'activities', tag: 'deadline-reminder' },
          webpush: {
            notification: { icon: '/icon-192.png', badge: '/icon-192.png' },
            fcmOptions: { link: 'activities' },
          },
        },
      }),
    }).then(r => r.ok)
  ))
  const sent = results.filter(r => r.status === 'fulfilled' && r.value).length

  // Mark the activities we reminded for - updateMask touches only this field.
  await Promise.allSettled(activitiesToMark.map(id =>
    fetch(`${fsBase(projectId)}/activities/${encodeURIComponent(id)}?updateMask.fieldPaths=reminderSentAt`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { reminderSentAt: { integerValue: String(now) } } }),
    })
  ))

  return res.status(200).json({
    ok: true,
    activitiesReminded: activitiesToMark.length,
    candidates: messages.length,
    pushSent: sent,
  })
}
