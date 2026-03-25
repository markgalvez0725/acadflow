// ── OTP engine ────────────────────────────────────────────────────────────
// Stateless helpers. Callers (AuthContext) own the otpSessions ref object.

export function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
