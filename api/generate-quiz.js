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
// Both return 501 when GROQ_API_KEY is unset so clients fall back on-device.
export default async function handler(req, res) {
  if (guard(req, res, { max: 20 })) return
  if (req.method !== 'POST') return res.status(405).end()
  if (!(await requireUser(req, res))) return

  const { prompt, transcript, meta } = req.body || {}
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
