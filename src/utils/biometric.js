// ── Biometric quick sign-in (Face ID / fingerprint) ─────────────────────────
// A $0, browser-native convenience layer built on the WebAuthn platform
// authenticator. It is NOT a passwordless replacement and needs no server:
//   1. The student logs in once with their password and opts in. We register a
//      platform credential (Face ID / fingerprint / Windows Hello) and stash
//      their password AES-encrypted in localStorage.
//   2. Next time, the login screen offers "Sign in with Face ID/fingerprint".
//      A successful biometric assertion (userVerification: 'required') unlocks
//      the stored password, which drives the normal Firebase login.
// Password sign-in always remains as the fallback. Requires a secure context
// (HTTPS) — feature-detect and hide the UI where unsupported.

import { encryptLocal, decryptLocal } from '@/utils/crypto'

const BIO_KEY = 'cp_bio' // { credId, snum, name, enc }

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(String(b64).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

// Basic feature detection — WebAuthn + a secure context.
export function isBiometricSupported() {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && !!(navigator.credentials && navigator.credentials.create)
    && (window.isSecureContext !== false)
}

// Is a built-in (platform) authenticator — Face ID / fingerprint — available?
export async function isPlatformAuthAvailable() {
  if (!isBiometricSupported()) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch (e) {
    return false
  }
}

export function getBiometric() {
  try {
    const raw = localStorage.getItem(BIO_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function disableBiometric() {
  try { localStorage.removeItem(BIO_KEY) } catch (e) { /* ignore */ }
}

export function isBiometricEnabled() {
  return !!getBiometric()
}

// Register a platform credential and stash the encrypted password.
export async function enableBiometric({ snum, name, password }) {
  if (!isBiometricSupported()) throw new Error('This device does not support biometric sign-in.')
  if (!password) throw new Error('Password is required to enable biometric sign-in.')

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'AcadFlow', id: window.location.hostname },
      user: { id: new TextEncoder().encode(String(snum)), name: String(snum), displayName: name || String(snum) },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  })
  if (!cred) throw new Error('Biometric setup was cancelled.')

  const enc = await encryptLocal({ password })
  if (!enc) throw new Error('Could not secure your credentials on this device.')
  localStorage.setItem(BIO_KEY, JSON.stringify({ credId: bufToB64(cred.rawId), snum: String(snum), name: name || String(snum), enc }))
  return true
}

// Prompt the biometric and, on success, return { snum, name, password }.
export async function biometricUnlock() {
  const b = getBiometric()
  if (!b) throw new Error('No biometric sign-in is set up on this device.')

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: b64ToBuf(b.credId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
      rpId: window.location.hostname,
    },
  })
  if (!assertion) throw new Error('Biometric sign-in was cancelled.')

  const dec = await decryptLocal(b.enc)
  if (!dec || !dec.password) {
    disableBiometric()
    throw new Error('Saved sign-in data was invalid. Please set up biometric sign-in again.')
  }
  return { snum: b.snum, name: b.name, password: dec.password }
}
