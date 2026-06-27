// On-device "smart check" validators for settings/profile fields. Fully local,
// deterministic (never hallucinates), and uniform: each returns { state, msg } so
// the UI renders one inline feedback row per field and can gate auto-save on
// `state !== 'error'`.
//
//   state: 'idle'  → nothing to say yet (empty optional field) → render nothing
//          'ok'    → valid (green)
//          'warn'  → usable but worth fixing / still typing (amber)
//          'error' → invalid, must not save (red)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const okV   = msg => ({ state: 'ok',   msg })
export const warnV = msg => ({ state: 'warn', msg })
export const errV  = msg => ({ state: 'error', msg })
export const idleV = (msg = '') => ({ state: 'idle', msg })

// True when a smart-check result allows saving (anything but a hard error).
export const canSave = r => !r || r.state !== 'error'

export function checkRequiredName(v, label = 'This field') {
  const s = (v || '').trim()
  if (!s) return errV(`${label} is required`)
  if (s.length < 2) return warnV(`${label} looks too short`)
  if (!/[A-Za-z]/.test(s)) return errV(`${label} should contain letters`)
  return okV('Looks good')
}

export function checkMiddleInitial(v) {
  const s = (v || '').trim()
  if (!s) return idleV('Optional')
  if (!/^[A-Za-z]/.test(s)) return errV('Use a letter')
  if (s.replace(/\./g, '').length > 2) return warnV('Use just the middle initial (e.g. “S”)')
  return okV('Looks good')
}

export function checkEmail(v, { required = false } = {}) {
  const s = (v || '').trim()
  if (!s) return required ? errV('Email is required') : idleV('Optional')
  if (!EMAIL_RE.test(s)) return errV('Enter a valid email (name@example.com)')
  return okV('Valid email')
}

export function checkPassword(v) {
  const s = v || ''
  if (!s) return idleV('')
  if (s.length < 8) return errV('Use at least 8 characters')
  let classes = 0
  if (/[a-z]/.test(s)) classes++
  if (/[A-Z]/.test(s)) classes++
  if (/\d/.test(s)) classes++
  if (/[^A-Za-z0-9]/.test(s)) classes++
  if (classes < 2) return warnV('Add a mix of letters and numbers')
  if (s.length >= 12 && classes >= 3) return okV('Strong password')
  return okV('Good password')
}

// Stricter new-password rule for flows that require an uppercase letter + a
// number (and that the new password differs from the current one) - keeps the
// smart-check in lockstep with what the save actually enforces.
export function checkNewPassword(v, { current = '' } = {}) {
  const s = v || ''
  if (!s) return idleV('')
  if (s.length < 8) return errV('Use at least 8 characters')
  if (!/[A-Z]/.test(s)) return warnV('Add an uppercase letter')
  if (!/\d/.test(s)) return warnV('Add a number')
  if (current && s === current) return errV('Must differ from your current password')
  return okV('Strong password')
}

// Strictly-descending check for the equivalency scale (each tier's minimum must
// be lower than the one above it). `vals` is the numeric array top→bottom.
export function checkDescending(vals = [], labels = []) {
  for (let i = 1; i < vals.length; i++) {
    if (!(vals[i] < vals[i - 1])) {
      const a = labels[i] ?? i, b = labels[i - 1] ?? (i - 1)
      return errV(`${a} must be lower than ${b}`)
    }
  }
  return okV('Scale is valid (each tier lower than the last)')
}

export function checkMatch(a, b, label = 'Passwords') {
  if (!b) return idleV('')
  if (a !== b) return errV(`${label} don’t match yet`)
  return okV(`${label} match`)
}

export function checkPin(v) {
  const s = v || ''
  if (!s) return idleV('')
  if (!/^\d{4}$/.test(s)) return warnV('PIN must be exactly 4 digits')
  return okV('PIN looks good')
}

export function checkAcademicYear(v) {
  const s = (v || '').trim()
  if (!s) return errV('Academic year is required')
  const m = s.match(/^(\d{4})\s*[\u2010-\u2015\u2212-]\s*(\d{4})$/)
  if (!m) return warnV('Use the format 2025-2026')
  const a = +m[1], b = +m[2]
  if (b !== a + 1) return warnV('End year should be one after the start (e.g. 2025-2026)')
  return okV('Valid academic year')
}

export function checkDateOrder(start, end) {
  if (!start || !end) return idleV('')
  if (new Date(end) < new Date(start)) return errV('End date is before the start date')
  return okV('Dates look right')
}
