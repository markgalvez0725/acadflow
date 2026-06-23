// Per-device quick-unlock PIN. Stores ONLY a salted hash of the 4-digit PIN in
// localStorage (never the PIN, never the password). Used to re-gate an
// already-authenticated session after inactivity, without a full re-login.

import { hashPassword } from '@/utils/crypto'

const PREFIX = 'cp_pin_'
function keyFor(role, id) {
  return PREFIX + (role === 'admin' ? 'admin' : (id || 'student'))
}

export function hasQuickPin(role, id) {
  try { return !!localStorage.getItem(keyFor(role, id)) } catch (e) { return false }
}

export async function setQuickPin(role, id, pin) {
  const hash = await hashPassword(String(pin))
  try { localStorage.setItem(keyFor(role, id), hash) } catch (e) { /* ignore */ }
}

export async function verifyQuickPin(role, id, pin) {
  try {
    const stored = localStorage.getItem(keyFor(role, id))
    if (!stored) return false
    return stored === await hashPassword(String(pin))
  } catch (e) { return false }
}

export function clearQuickPin(role, id) {
  try { localStorage.removeItem(keyFor(role, id)) } catch (e) { /* ignore */ }
}
