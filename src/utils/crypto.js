// ── Crypto utilities ───────────────────────────────────────────────────────
// Secrets are read from Vite env vars. Provide them in .env (see .env.example).
// Defaults match the original app's hardcoded values so existing localStorage
// data continues to decrypt correctly without migration.
const PASS_SALT  = import.meta.env.VITE_PASS_SALT  || 'cp_salt_2025::';
const _EJS_SECRET = import.meta.env.VITE_EJS_SECRET || 'cp::ejs::key::2025::v1';
const _EJS_SALT   = import.meta.env.VITE_EJS_SALT   || 'collegeportal_ejs_salt_v1';
const _FB_SECRET  = import.meta.env.VITE_FB_SECRET  || 'cp::fb::key::2025::v1';
const _FB_SALT    = import.meta.env.VITE_FB_SALT    || 'collegeportal_fb_salt_v1';

// ── SHA-256 password hashing ──────────────────────────────────────────────
export async function hashPassword(password) {
  const salted = PASS_SALT + password;
  const msgBuffer = new TextEncoder().encode(salted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(inputPassword, storedHash) {
  if (!storedHash) return false;
  // Path 1: SHA-256 hash — exactly 64 lowercase hex chars
  if (storedHash.length === 64 && /^[0-9a-f]{64}$/.test(storedHash)) {
    const inputHash = await hashPassword(inputPassword);
    return inputHash === storedHash;
  }
  // Path 2: btoa() legacy hash
  if (storedHash.includes('=')) {
    return btoa(inputPassword) === storedHash;
  }
  // Path 3: Plain-text fallback
  return inputPassword === storedHash;
}

// ── AES-GCM helpers ───────────────────────────────────────────────────────
async function _deriveKey(secret, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function _aesEncrypt(obj, secret, salt) {
  try {
    const key = await _deriveKey(secret, salt);
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    const buf = new Uint8Array(12 + ct.byteLength);
    buf.set(iv, 0);
    buf.set(new Uint8Array(ct), 12);
    return btoa(String.fromCharCode(...buf));
  } catch (e) {
    console.warn('[Crypto] encrypt failed:', e.message);
    return null;
  }
}

async function _aesDecrypt(blob, secret, salt) {
  try {
    const buf   = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
    const iv    = buf.slice(0, 12);
    const ct    = buf.slice(12);
    const key   = await _deriveKey(secret, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    return null;
  }
}

// ── EmailJS config encryption ─────────────────────────────────────────────
export async function encryptEJS(ejsObj) {
  return _aesEncrypt(ejsObj, _EJS_SECRET, _EJS_SALT);
}

export async function decryptEJS(blob) {
  const obj = await _aesDecrypt(blob, _EJS_SECRET, _EJS_SALT);
  if (obj?.publicKey && obj?.serviceId && obj?.templateId) return obj;
  return null;
}

// ── Firebase config encryption ────────────────────────────────────────────
export async function encryptFbConfig(cfgObj) {
  return _aesEncrypt(cfgObj, _FB_SECRET, _FB_SALT);
}

export async function decryptFbConfig(blob) {
  const obj = await _aesDecrypt(blob, _FB_SECRET, _FB_SALT);
  if (obj?.apiKey && obj?.projectId) return obj;
  return null;
}

// ── Load Firebase config from encrypted localStorage ─────────────────────
export async function loadFbConfigFromStorage() {
  const enc = localStorage.getItem('cp_firebase_enc');
  if (enc) {
    const obj = await decryptFbConfig(enc);
    if (obj) return obj;
  }
  // One-time migration: encrypt and store any lingering plaintext config
  const raw = localStorage.getItem('cp_firebase');
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj?.apiKey && obj?.projectId) {
        const blob = await encryptFbConfig(obj);
        if (blob) {
          localStorage.setItem('cp_firebase_enc', blob);
          localStorage.removeItem('cp_firebase');
        }
        return obj;
      }
    } catch (e) {}
    localStorage.removeItem('cp_firebase');
  }
  return null;
}

// ── Read stored EJS from encrypted blob or legacy plain JSON ─────────────
export async function readStoredEJS(raw) {
  if (!raw) return null;
  try {
    if (!raw.trim().startsWith('{')) {
      const dec = await decryptEJS(raw);
      if (dec) return dec;
    }
    const p = JSON.parse(raw);
    if (p.publicKey && p.serviceId && p.templateId) return p;
  } catch (e) {}
  return null;
}
