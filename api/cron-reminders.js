// ── Deadline reminder cron (Vercel Cron) ─────────────────────────────────
// Runs on a schedule (see vercel.json `crons`). Finds activities due and
// quizzes closing within the next 24 hours, and for each enrolled student who
// hasn't submitted, sends a web-push reminder via FCM. A student with several
// deadlines gets ONE grouped digest push instead of a ping per item. Each
// activity/quiz is marked with `reminderSentAt` so a reminder fires at most
// once per ~day even if the cron runs again.
//
// Setup (one-time):
//   1. Vercel → Settings → Environment Variables → add CRON_SECRET = <random string>.
//      Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>`.
//   2. FB_ADMIN_SERVICE_ACCOUNT (or FCM_SERVICE_ACCOUNT) must already be set -
//      the same service account used by /api/send-push works here.
//
// This endpoint only sends WEB PUSH (best-effort). The in-app notification
// path (useReminders + utils/reminders.js) covers the app-open case for both
// activities and quizzes; the "Remind Missing" button covers the manual path.
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

function whenLabel(ts) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
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

  let activities, quizzes, students, tokenDocs
  try {
    [activities, quizzes, students, tokenDocs] = await Promise.all([
      listCollection(projectId, accessToken, 'activities'),
      listCollection(projectId, accessToken, 'quizzes'),
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

  const inWindow = ts => ts && ts > now && ts <= now + WINDOW
  const cooledDown = doc => !(doc.reminderSentAt && now - Number(doc.reminderSentAt) < COOLDOWN)
  const registered = s => !!(s.account && s.account.registered)

  // Collect each student's due items so one push covers all of them.
  const itemsByStudent = {}   // sid -> [{ kind, title, subject, when, tab }]
  const activitiesToMark = []
  const quizzesToMark = []

  for (const act of activities) {
    const deadline = Number(act.deadline) || 0
    if (!inWindow(deadline) || !cooledDown(act)) continue
    const subs = act.submissions || {}
    let any = false
    for (const s of students) {
      const sid = s.id || s._id
      if (!enrolledIdsOf(s).includes(act.classId) || !registered(s)) continue
      if (subs[sid] && subs[sid].link) continue
      any = true
      ;(itemsByStudent[sid] || (itemsByStudent[sid] = [])).push({
        kind: 'activity', title: act.title || 'Activity', subject: act.subject || '',
        when: deadline, tab: 'activities',
      })
    }
    if (any) activitiesToMark.push(act._id)
  }

  for (const quiz of quizzes) {
    const closeAt = Number(quiz.closeAt) || 0
    // Mirrors the student-side visibility predicate: drafts are invisible.
    if (quiz.status === 'draft' || !inWindow(closeAt) || !cooledDown(quiz)) continue
    const classIds = quiz.classIds || []
    const subs = quiz.submissions || {}
    let any = false
    for (const s of students) {
      const sid = s.id || s._id
      if (!enrolledIdsOf(s).some(id => classIds.includes(id)) || !registered(s)) continue
      if (subs[sid]) continue
      any = true
      ;(itemsByStudent[sid] || (itemsByStudent[sid] = [])).push({
        kind: 'quiz', title: quiz.title || 'Quiz', subject: quiz.subject || '',
        when: closeAt, tab: 'quizzes',
      })
    }
    if (any) quizzesToMark.push(quiz._id)
  }

  // One push per device: a single item keeps the familiar wording; several
  // items collapse into a digest so a busy day is one notification, not five.
  const messages = []          // { token, title, body, url }
  for (const sid in itemsByStudent) {
    const toks = tokensByOwner[sid] || []
    if (!toks.length) continue
    const items = itemsByStudent[sid].sort((a, b) => a.when - b.when)
    let title, body, url
    if (items.length === 1) {
      const it = items[0]
      title = `Reminder: ${it.title}`
      body = `${it.subject ? it.subject + ' - ' : ''}${it.kind === 'quiz' ? 'closes' : 'due'} ${whenLabel(it.when)}. Don't forget to submit.`
      url = it.tab
    } else {
      const shown = items.slice(0, 3)
        .map(it => `${it.title} (${it.kind === 'quiz' ? 'closes' : 'due'} ${whenLabel(it.when)})`)
      const more = items.length - shown.length
      title = `${items.length} deadlines in the next 24 hours`
      body = shown.join(' · ') + (more > 0 ? ` · and ${more} more` : '')
      url = items.some(it => it.kind === 'quiz') && items.every(it => it.kind === 'quiz') ? 'quizzes' : 'activities'
    }
    for (const tk of toks) messages.push({ token: tk, title, body, url })
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
          data: { url: m.url, tag: 'deadline-reminder' },
          webpush: {
            notification: { icon: '/icon-192.png', badge: '/icon-192.png' },
            fcmOptions: { link: m.url },
          },
        },
      }),
    }).then(r => r.ok)
  ))
  const sent = results.filter(r => r.status === 'fulfilled' && r.value).length

  // Mark what we reminded for - updateMask touches only this field.
  const mark = (coll, id) =>
    fetch(`${fsBase(projectId)}/${coll}/${encodeURIComponent(id)}?updateMask.fieldPaths=reminderSentAt`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { reminderSentAt: { integerValue: String(now) } } }),
    })
  await Promise.allSettled([
    ...activitiesToMark.map(id => mark('activities', id)),
    ...quizzesToMark.map(id => mark('quizzes', id)),
  ])

  return res.status(200).json({
    ok: true,
    activitiesReminded: activitiesToMark.length,
    quizzesReminded: quizzesToMark.length,
    studentsNotified: Object.keys(itemsByStudent).length,
    pushSent: sent,
  })
}
