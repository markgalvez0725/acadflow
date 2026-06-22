import { guard } from './_guard.js'
import { requireUser } from './_fbadmin.js'

export default async function handler(req, res) {
  if (guard(req, res, { max: 20 })) return
  if (req.method !== 'POST') return res.status(405).end()
  if (!(await requireUser(req, res))) return

  const { prompt } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' })

  // Prefer the server-only name; fall back to the legacy VITE_-prefixed var so
  // existing deployments keep working until the env var is renamed.
  const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!groqKey) return res.status(501).json({ error: 'Groq not configured (GROQ_API_KEY missing)' })

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
