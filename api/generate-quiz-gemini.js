// ── Quiz generation via Google Gemini (free tier) ─────────────────────────
// Optional, free upgrade for the lesson-to-quiz feature. Uses Gemini's
// free-tier API, which issues an API key with NO credit card required.
//
// Setup (one-time, free):
//   1. Go to https://aistudio.google.com/app/apikey and create an API key.
//   2. In Vercel → Project → Settings → Environment Variables, add
//      GEMINI_API_KEY = <your key>.
// When unset, this returns 501 and the app falls back to the on-device drafter.
//
// Request body: { text: string, count?: number, types?: string[] }
// Response: { questions: [{type, question, options?, answer}] }

const SHAPES = {
  multiple_choice: '{"type":"multiple_choice","question":"...","options":["A","B","C","D"],"answer":"A"}',
  true_false: '{"type":"true_false","question":"...","answer":"True"}',
  short_answer: '{"type":"short_answer","question":"...","answer":"..."}',
  fill_in_the_blank: '{"type":"fill_in_the_blank","question":"The ___ is ...","answer":"word"}',
  identification: '{"type":"identification","question":"What term refers to...?","answer":"Term"}',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.GEMINI_API_KEY
  if (!key) return res.status(501).json({ error: 'Gemini not configured (GEMINI_API_KEY missing)' })

  const { text = '', count = 10, types = ['multiple_choice', 'true_false', 'fill_in_the_blank', 'identification'] } = req.body || {}
  if (!text.trim()) return res.status(400).json({ error: 'No lesson text provided' })

  const allowed = types.filter(t => SHAPES[t])
  const shapeHints = allowed.map(t => `- ${t}: ${SHAPES[t]}`).join('\n')
  const lesson = text.slice(0, 18000) // keep request small

  const prompt = `You are a teacher creating a quiz strictly from the lesson material below.
Generate exactly ${count} questions using ONLY these types:
${shapeHints}

Rules:
- Base every question on the lesson content; do not invent facts.
- multiple_choice must have exactly 4 options and the answer must be one of them verbatim.
- true_false answer is exactly "True" or "False".
- Output ONLY a JSON array of question objects. No prose, no markdown.

LESSON:
"""
${lesson}
"""`

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        }),
      }
    )
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Gemini request failed' })

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
    let questions
    try { questions = JSON.parse(raw) }
    catch {
      const m = raw.match(/\[[\s\S]*\]/)
      questions = m ? JSON.parse(m[0]) : []
    }
    if (!Array.isArray(questions)) questions = []
    res.status(200).json({ questions })
  } catch (e) {
    res.status(502).json({ error: 'Gemini error: ' + e.message })
  }
}
