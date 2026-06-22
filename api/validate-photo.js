// ── Profile-photo validator via Gemini vision (free tier) ─────────────────
// Verifies a student profile photo shows professional business attire on a
// white/plain background. Gated by GEMINI_API_KEY; returns 501 when unset so
// the client can fall back to its on-device checks only.
//
// Request body: { imageBase64: string (raw base64, no data: prefix),
//                 mimeType?: string }
// Response: { result: {
//   whiteBackground, businessAttire, singlePerson, headshot,
//   faceClearlyVisible, overall: 'pass'|'warn'|'fail', issues: string[]
// } }

import { guard } from './_guard.js'

const PROMPT = `You are a strict ID-photo reviewer for a school portal. A valid student profile photo must be a professional headshot: ONE person in professional business attire (collared shirt, blouse, polo, suit, blazer, formal/business-casual top) photographed against a plain WHITE or very light, uniform background.

Judge the attached image and respond with ONLY a JSON object, no prose:
{
  "whiteBackground": boolean,   // background is plain white/near-white and uniform
  "businessAttire": boolean,    // subject wears professional business / business-casual attire
  "singlePerson": boolean,      // exactly one person is the subject
  "headshot": boolean,          // head-and-shoulders framing, face takes a reasonable portion
  "faceClearlyVisible": boolean,// face is unobstructed, front-facing, well lit
  "overall": "pass" | "warn" | "fail",
  "issues": [ "short, specific, student-friendly reasons it might be rejected" ]
}
Rules: "fail" if not white background, not a single person, no clear face, or clearly casual/inappropriate attire (e.g., tank top, costume, sportswear, selfie in bedroom). "warn" if mostly fine but borderline (slightly off-white, slightly casual, loose framing). "pass" only when all criteria are clearly met. Keep each issue under 12 words.`

export default async function handler(req, res) {
  if (guard(req, res, { max: 15 })) return
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.GEMINI_API_KEY
  if (!key) return res.status(501).json({ error: 'AI not configured (GEMINI_API_KEY missing)' })

  const { imageBase64 = '', mimeType = 'image/jpeg' } = req.body || {}
  const data = String(imageBase64).replace(/^data:[^;]+;base64,/, '')
  if (!data) return res.status(400).json({ error: 'No image provided' })
  // ~7MB base64 ceiling — the client sends a downscaled JPEG well under this.
  if (data.length > 7_000_000) return res.status(413).json({ error: 'Image too large' })

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data } },
            ],
          }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      }
    )
    const out = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: out?.error?.message || 'AI request failed' })

    const text = out?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    let parsed
    try { parsed = JSON.parse(text) }
    catch {
      const m = text.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : null
    }
    if (!parsed) return res.status(502).json({ error: 'Could not parse AI response' })
    res.status(200).json({ result: parsed })
  } catch (e) {
    res.status(502).json({ error: 'AI error: ' + e.message })
  }
}
