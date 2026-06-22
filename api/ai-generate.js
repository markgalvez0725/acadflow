// ── Generic AI text/JSON helper via Gemini (free tier) ────────────────────
// Reused by the activity tools (instructions, rubric suggestions, grading
// assist). Gated by GEMINI_API_KEY; returns 501 when unset so the client can
// fall back to on-device behavior.
//
// Request body: { prompt: string, json?: boolean }
// Response: { text: string } or, when json=true, { json: any }

import { guard } from './_guard.js'

export default async function handler(req, res) {
  if (guard(req, res, { max: 20 })) return
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.GEMINI_API_KEY
  if (!key) return res.status(501).json({ error: 'AI not configured (GEMINI_API_KEY missing)' })

  const { prompt = '', json = false } = req.body || {}
  if (!prompt.trim()) return res.status(400).json({ error: 'No prompt provided' })

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt.slice(0, 24000) }] }],
          generationConfig: {
            temperature: 0.4,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      }
    )
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'AI request failed' })

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!json) return res.status(200).json({ text })

    let parsed
    try { parsed = JSON.parse(text) }
    catch {
      const m = text.match(/[[{][\s\S]*[\]}]/)
      parsed = m ? JSON.parse(m[0]) : null
    }
    res.status(200).json({ json: parsed })
  } catch (e) {
    res.status(502).json({ error: 'AI error: ' + e.message })
  }
}
