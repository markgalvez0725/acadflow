// ── Shared on-device embedding model ──────────────────────────────────────
// One singleton sentence-embedding model (paraphrase-multilingual-MiniLM-L12-v2,
// ~120 MB quantized) loaded via Transformers.js and shared by EVERY Smart feature
// in the app - quiz generation, Auto-key synonyms, activity rubric matching, and
// grading-coverage estimates. Multilingual on purpose (the content here is
// Filipino/Tagalog). Nothing is uploaded; inference runs entirely in-browser.
// The library is imported from esm.sh (with a jsdelivr `+esm` mirror as
// fallback) and weights are fetched from the Hugging Face hub, then cached by
// the browser after first use. The deployed CSP MUST allow these origins or
// every embedding-backed Smart feature silently fails:
//   script-src/worker-src/connect-src → https://esm.sh https://cdn.jsdelivr.net
//   connect-src → https://huggingface.co https://*.huggingface.co https://*.hf.co
// (see vercel.json). Without them the dynamic import is blocked and smartGrade
// returns null → "Smart grading unavailable" toast.

import { loadEsmOnce } from '@/utils/cdnLoader'

const TRANSFORMERS_URLS = [
  'https://esm.sh/@xenova/transformers@2.17.2',
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
]
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

// Generous cap on the pipeline warm-up (the quantized weights are ~120 MB):
// long enough for a slow first download, but a stalled one rejects so callers'
// null-fallbacks fire instead of an eternal spinner.
const WARMUP_TIMEOUT_MS = 120000

let _extractorPromise

/** Dynamically import Transformers.js from the CDN (kept out of the Vite bundle). */
function loadLib() {
  return loadEsmOnce(TRANSFORMERS_URLS, { cacheKey: 'transformers' }).then(mod => {
    if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true }
    return mod
  })
}

/** Load the feature-extraction (embedding) pipeline once. Throws if it can't. */
export function ensureExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline } = await loadLib()
      let timer
      const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Timed out loading the embedding model')), WARMUP_TIMEOUT_MS)
      })
      try {
        return await Promise.race([pipeline('feature-extraction', MODEL), guard])
      } finally {
        clearTimeout(timer)
      }
    })().catch(err => { _extractorPromise = null; throw err })
  }
  return _extractorPromise
}

/** Embed an array of strings → array of unit vectors (number[][]). Batched,
 *  yields a frame between batches so long inputs don't freeze the UI. */
export async function embedAll(extractor, texts) {
  const vecs = []
  const BATCH = 32
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    const out = await extractor(chunk, { pooling: 'mean', normalize: true })
    for (const v of out.tolist()) vecs.push(v)
    await new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
  }
  return vecs
}

/** Cosine similarity of two unit vectors (just a dot product). */
export function cos(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Warm the model up ahead of time (download + compile) so the first real use
 * isn't a cold wait. Call when an Smart-using modal opens. Errors swallowed.
 */
export function prewarmEmbeddings() {
  if (typeof window === 'undefined') return
  ensureExtractor().then(ex => ex('warm up', { pooling: 'mean', normalize: true })).catch(() => {})
}
