// ── Firebase initialization — modular SDK v10 ─────────────────────────────
import { initializeApp, getApps, deleteApp } from 'firebase/app'
import { initializeFirestore } from 'firebase/firestore'

/**
 * Load Firebase config from Vite env vars (VITE_FB_*).
 * Returns null if the required fields are not set.
 */
export function getFbConfigFromEnv() {
  const apiKey     = import.meta.env.VITE_FB_API_KEY
  const projectId  = import.meta.env.VITE_FB_PROJECT_ID
  if (!apiKey || !projectId) return null
  return {
    apiKey,
    authDomain:        import.meta.env.VITE_FB_AUTH_DOMAIN        || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:     import.meta.env.VITE_FB_STORAGE_BUCKET     || `${projectId}.appspot.com`,
    messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID || '',
    appId:             import.meta.env.VITE_FB_APP_ID              || '',
  }
}

const FB_WRITE_TIMEOUT = 20000;
let _app = null;
let _db  = null;
let _initializing = false;

export function getDb() { return _db; }
export function isReady() { return !!_db; }

/**
 * Initialize (or reuse) the Firebase app and return the Firestore db.
 * @param {object} fbConfig — { apiKey, projectId, ... }
 * @returns {Promise<import('firebase/firestore').Firestore|null>}
 */
export async function fbInit(fbConfig) {
  if (!fbConfig?.apiKey || !fbConfig?.projectId) {
    console.warn('[Firebase] ❌ Cannot init — no config provided.');
    return null;
  }

  if (_db) {
    console.log('[Firebase] ✅ Already connected:', fbConfig.projectId);
    return _db;
  }

  if (_initializing) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (_db) return _db;
    }
    return _db;
  }

  _initializing = true;
  console.log('[Firebase] 🔄 Initializing for project:', fbConfig.projectId);

  try {
    // Reuse existing app if project matches, else recreate
    const existing = getApps().find(a => a.name === 'cp');
    if (existing) {
      if (existing.options?.projectId === fbConfig.projectId) {
        _app = existing;
      } else {
        console.log('[Firebase] 🔄 Project changed — recreating app...');
        await deleteApp(existing);
        await new Promise(r => setTimeout(r, 800));
        _app = null;
      }
    }

    if (!_app) {
      _app = initializeApp({
        apiKey:            fbConfig.apiKey,
        authDomain:        fbConfig.authDomain        || fbConfig.projectId + '.firebaseapp.com',
        projectId:         fbConfig.projectId,
        storageBucket:     fbConfig.storageBucket     || fbConfig.projectId + '.appspot.com',
        messagingSenderId: fbConfig.messagingSenderId || '',
        appId:             fbConfig.appId             || '',
      }, 'cp');
    }

    _db = initializeFirestore(_app, {
      experimentalAutoDetectLongPolling: true,
    });

    console.log('[Firebase] ✅ Firestore ready (long-poll enabled).');
    return _db;
  } catch (e) {
    console.error('[Firebase] ❌ Init failed:', e.code || '', e.message);
    _app = null;
    _db  = null;
    return null;
  } finally {
    _initializing = false;
  }
}

/** Race a promise against a timeout to avoid hanging writes. */
export function fbWithTimeout(promise, ms = FB_WRITE_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firebase write timed out')), ms)
    ),
  ]);
}
