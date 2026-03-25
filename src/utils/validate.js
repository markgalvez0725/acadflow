// ── Input validation & login throttling ───────────────────────────────────

const SNUM_PATTERN = /^[A-Za-z0-9\-]{1,10}$/;

export function validateSnum(snum) {
  if (!snum) return 'Student number is required.';
  if (snum.length > 10) return 'Student number must be 10 characters or fewer.';
  if (!SNUM_PATTERN.test(snum)) return 'Student number may only contain letters, numbers, and dashes (-).';
  return null;
}

// Returns a sanitized version of the input value (strips invalid chars, max 10).
export function sanitizeSnum(value) {
  return value.replace(/[^A-Za-z0-9\-]/g, '').slice(0, 10);
}

// ── Login throttling ──────────────────────────────────────────────────────
// In-memory only — resets on page refresh (intentional; avoids localStorage abuse).
const _loginAttempts = {};
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 5 * 60 * 1000; // 5 minutes

export function recordFailedAttempt(key) {
  const now = Date.now();
  if (!_loginAttempts[key]) _loginAttempts[key] = { count: 0, lockedUntil: 0 };
  _loginAttempts[key].count++;
  if (_loginAttempts[key].count >= MAX_ATTEMPTS) {
    _loginAttempts[key].lockedUntil = now + LOCKOUT_MS;
    _loginAttempts[key].count = 0;
  }
}

// Returns false if not locked, or an error string if locked.
export function isLockedOut(key) {
  const entry = _loginAttempts[key];
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return `Too many failed attempts. Please try again in ${remaining} minute${remaining > 1 ? 's' : ''}.`;
  }
  return false;
}

export function clearAttempts(key) {
  delete _loginAttempts[key];
}
