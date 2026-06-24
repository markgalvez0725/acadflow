// ── On-device sensitive-content classifier ────────────────────────────────
// Decides whether a message looks private enough to "smart-lock" (blur until
// the reader deliberately reveals it). Runs entirely on-device, synchronously,
// with no network and no model download — so it can hint live as the teacher or
// student types. Multilingual (English + Filipino/Tagalog) to match the app.
//
// It is intentionally a transparent rules + lexicon model, not a black box: it
// flags the categories schools actually care about (grades, credentials,
// contact info, and explicit "don't share this" intent). The shared MiniLM
// embedding model can later augment this for semantic cases — see
// classifySensitivity's `reasons` for what fired.

const RE = {
  // Explicit privacy intent — the strongest signal.
  privacy: /\b(do\s*n['’]?t\s+share|dont\s+share|don['’]?t\s+tell|keep\s+(this|it|that)\s*(private|secret|confidential|between\s+us)|just\s+between\s+us|for\s+your\s+eyes\s+only|wag(?:\s+mong)?\s+(ipakita|ibahagi|sabihin)|huwag\s+(ibahagi|ipakita)|sa\s+atin\s+lang)\b/i,
  // Credentials / one-time codes.
  credential: /\b(password|passwd|passcode|otp|one[-\s]?time\s+(code|pin)|pin\s*code|verification\s+code|kumpidensyal|lihim)\b/i,
  // Contact details (PII).
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  phone: /(?:\+?63|0)9\d{9}/,
  address: /\b(home\s+address|address|tirahan)\b/i,
  // Grade words — only counts as sensitive together with a number nearby.
  gradeWord: /\b(grade|grades|grado|marka|markahan|rating|score|scores|gpa|gwa|average|remark|remarks|final\s+grade|failing|failed|passed|remedial|incomplete|dean['’]?s?\s+list)\b/i,
  number: /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent|pts?|points?)?\b/,
}

/**
 * Classify a message body.
 * @param {string} text
 * @returns {{ sensitive: boolean, score: number, reasons: string[] }}
 */
export function classifySensitivity(text) {
  const t = String(text || '')
  if (t.trim().length < 3) return { sensitive: false, score: 0, reasons: [] }
  const reasons = []
  if (RE.privacy.test(t)) reasons.push('privacy-request')
  if (RE.credential.test(t)) reasons.push('credential')
  if (RE.email.test(t)) reasons.push('email')
  if (RE.phone.test(t.replace(/[\s-]/g, ''))) reasons.push('phone')
  if (RE.address.test(t)) reasons.push('address')
  if (RE.gradeWord.test(t) && RE.number.test(t)) reasons.push('grade')
  return { sensitive: reasons.length > 0, score: reasons.length, reasons }
}

/** A short, human label for why a draft was flagged (for the composer hint). */
export function sensitivityLabel(reasons) {
  if (!reasons || !reasons.length) return ''
  const first = reasons[0]
  const map = {
    'privacy-request': 'marked private',
    credential: 'looks like a credential',
    email: 'contains an email',
    phone: 'contains a phone number',
    address: 'contains an address',
    grade: 'mentions a grade',
  }
  return map[first] || 'looks sensitive'
}
