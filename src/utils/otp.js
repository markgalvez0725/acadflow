// ── OTP engine ────────────────────────────────────────────────────────────
// Stateless helpers. Callers (AuthContext) own the otpSessions ref object.

export function genOTP() {
  // Cryptographically secure 6-digit code (rejection sampling to avoid modulo
  // bias). Falls back to Math.random only if getRandomValues is unavailable.
  const g = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
    : () => Math.floor(Math.random() * 0x100000000);
  let n;
  do { n = g(); } while (n >= 0x100000000 - (0x100000000 % 900000));
  return (100000 + (n % 900000)).toString();
}

// sessions: ref object keyed by context name, e.g. { reg: { code, expires, email } }
export function verifyOTP(sessions, ctx, inputCode) {
  const session = sessions[ctx];
  if (!session) return { ok: false, msg: 'No OTP session found. Please request a new OTP.' };
  if (Date.now() > session.expires) return { ok: false, msg: 'OTP has expired. Please request a new one.' };
  if (inputCode.trim() !== session.code) return { ok: false, msg: 'Incorrect OTP. Please try again.' };
  return { ok: true };
}

export function consumeOTP(sessions, ctx) {
  delete sessions[ctx];
}
