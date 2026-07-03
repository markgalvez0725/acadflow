import { guard } from './_guard.js'
import { requireUser } from './_fbadmin.js'

// The app's single Groq endpoint. Vercel's Hobby plan caps a deployment at 12
// serverless functions, so related AI tasks SHARE this route instead of each
// getting their own file:
//   { prompt }           -> quiz generation (raw chat-completions passthrough)
//   { transcript, meta } -> meeting Smart Recap summary -> { html } (LEGACY:
//                           live transcription was retired 2026-07-02; this
//                           path only serves Regenerate on old classes that
//                           still have a stored transcript)
//   { turn: 1 }          -> dedicated TURN relay credentials for the in-app
//                           classroom (see turnCredentials below)
// AI modes return 501 when GROQ_API_KEY is unset so clients fall back
// on-device; the TURN mode returns 501 when no provider is configured so the
// client keeps its built-in public relay.
export default async function handler(req, res) {
  if (guard(req, res, { max: 20 })) return
  if (req.method !== 'POST') return res.status(405).end()
  if (!(await requireUser(req, res))) return

  const { prompt, transcript, meta, turn } = req.body || {}
  if (turn) return turnCredentials(res)
  if (!prompt && !transcript) return res.status(400).json({ error: 'Missing prompt' })

  // Prefer the server-only name; fall back to the legacy VITE_-prefixed var so
  // existing deployments keep working until the env var is renamed.
  const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!groqKey) return res.status(501).json({ error: 'Groq not configured (GROQ_API_KEY missing)' })

  // ── Meeting Smart Recap mode ──
  if (transcript && typeof transcript === 'string') {
    const title = (meta && meta.title) || 'Online class'
    const recapPrompt = [
      `You are summarizing a class meeting transcript for the course "${title}".`,
      'The transcript may mix languages (often English and Filipino). Keep each summarized item in the language it was mostly spoken in - do NOT translate.',
      'Return ONLY an HTML fragment using ONLY these tags: h4, p, ul, li, strong, em, mark, br. No markdown, no other tags, no <html>/<body>.',
      'Sections, each with an <h4> heading followed by a <ul>:',
      '1. "Overview" - 2 to 3 bullets on what the class covered.',
      '2. "Key points" - up to 5 bullets of the most important content.',
      '3. "Announcements and deadlines" - wrap each bullet text in <mark>. Omit the section if none.',
      '4. "Questions raised" - "<strong>Name:</strong> question" bullets. Omit if none.',
      'Be faithful to the transcript; never invent content. Transcript lines are "[hh:mm] Speaker: text":',
      '',
      transcript.slice(0, 28000),
    ].join('\n')

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: recapPrompt }],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json(data)
    let html = data?.choices?.[0]?.message?.content || ''
    // Strip accidental markdown code fences (built via charCode so no literal
    // backticks appear in source - they confuse the repo's balance checker).
    const fence = String.fromCharCode(96).repeat(3)
    html = html.split(fence + 'html').join('').split(fence).join('').trim()
    if (!html || !/<(h4|ul|p)[\s>]/i.test(html)) return res.status(422).json({ error: 'Model returned no usable summary' })
    return res.status(200).json({ html })
  }

  // ── Quiz generation mode (original behavior, unchanged) ──
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  })

  const data = await response.json()
  if (!response.ok) return res.status(response.status).json(data)

  res.status(200).json(data)
}

// ── Dedicated TURN credentials (shares this route: 12-function cap) ─────────
// The in-app classroom ships with a free public relay baked into the client;
// this mode upgrades it to a dedicated TURN service - better capacity and
// uptime for relayed students - the moment either provider is configured,
// with NO client redeploy:
//   METERED_TURN_DOMAIN + METERED_TURN_KEY   metered.ca (free 20GB/mo tier;
//                                            domain like myapp.metered.live)
//   CF_TURN_KEY_ID + CF_TURN_API_TOKEN       Cloudflare Calls TURN
// Responds { iceServers: [...] }; 501 when neither is set so the client keeps
// its built-in fallback. Credentials are cached per warm instance and
// refreshed before they expire.
let _turnCache = null // { servers, until }
async function turnCredentials(res) {
  if (_turnCache && Date.now() < _turnCache.until) {
    return res.status(200).json({ iceServers: _turnCache.servers })
  }
  try {
    const mDomain = process.env.METERED_TURN_DOMAIN
    const mKey = process.env.METERED_TURN_KEY
    if (mDomain && mKey) {
      const r = await fetch(
        'https://' + mDomain + '/api/v1/turn/credentials?apiKey=' + encodeURIComponent(mKey)
      )
      if (r.ok) {
        const servers = await r.json()
        if (Array.isArray(servers) && servers.length) {
          _turnCache = { servers, until: Date.now() + 6 * 3600_000 }
          return res.status(200).json({ iceServers: servers })
        }
      }
      return res.status(502).json({ error: 'TURN provider unavailable' })
    }
    const cfId = process.env.CF_TURN_KEY_ID
    const cfTok = process.env.CF_TURN_API_TOKEN
    if (cfId && cfTok) {
      const r = await fetch(
        'https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(cfId) + '/credentials/generate',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cfTok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 43200 }),
        }
      )
      if (r.ok) {
        const j = await r.json()
        const servers = j && j.iceServers ? [j.iceServers] : []
        if (servers.length) {
          // Refresh comfortably before the 12h credential ttl runs out.
          _turnCache = { servers, until: Date.now() + 10 * 3600_000 }
          return res.status(200).json({ iceServers: servers })
        }
      }
      return res.status(502).json({ error: 'TURN provider unavailable' })
    }
  } catch { /* fall through to 501 */ }
  return res.status(501).json({ error: 'No dedicated TURN configured' })
}
