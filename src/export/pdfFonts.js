// ── Embedded PDF fonts (Plus Jakarta Sans + Lexend) ────────────────────────
// jsPDF ships only Helvetica/Times/Courier. To make exported PDFs match the
// app typography we embed real TTFs, fetched once from the same CDN the app
// already uses (jsdelivr) and cached as base64. The TTFs are registered on each
// jsPDF document; we OVERRIDE the built-in `helvetica` family so every existing
// setFont('helvetica', ...) call across the export code renders in Lexend with
// zero edits, and expose a separate `PlusJakarta` family for headings.
//
// Degrades gracefully: if the fetch fails, registerPdfFonts() returns null and
// the reports fall back to standard Helvetica.

const SOURCES = {
  lexendNormal:  'https://cdn.jsdelivr.net/npm/@expo-google-fonts/lexend/Lexend_400Regular.ttf',
  lexendBold:    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/lexend/Lexend_700Bold.ttf',
  jakartaNormal: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_400Regular.ttf',
  jakartaBold:   'https://cdn.jsdelivr.net/npm/@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_700Bold.ttf',
}

const _b64 = {}        // key -> base64 string (no data: prefix)
let _loadPromise = null

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000 // 32k - avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Fetch + cache all four TTFs as base64 (idempotent). Resolves true when every
 * face is cached, false if any fetch failed (so a later export can retry).
 */
export function preloadPdfFonts() {
  if (_loadPromise) return _loadPromise
  _loadPromise = (async () => {
    try {
      await Promise.all(Object.entries(SOURCES).map(async ([key, url]) => {
        if (_b64[key]) return
        const res = await fetch(url)
        if (!res.ok) throw new Error(`font ${key} ${res.status}`)
        _b64[key] = arrayBufferToBase64(await res.arrayBuffer())
      }))
      return true
    } catch (e) {
      _loadPromise = null // allow a retry on the next export
      return false
    }
  })()
  return _loadPromise
}

export function pdfFontsReady() {
  return ['lexendNormal', 'lexendBold', 'jakartaNormal', 'jakartaBold'].every(k => _b64[k])
}

/**
 * Register the cached fonts onto a jsPDF doc (idempotent per doc).
 * Returns { body:'helvetica', head:'PlusJakarta' } when embedded, else null.
 */
export function registerPdfFonts(doc) {
  if (!doc || !pdfFontsReady()) return null
  if (doc.__brandFonts) return doc.__brandFonts
  try {
    doc.addFileToVFS('Lexend-Regular.ttf', _b64.lexendNormal)
    doc.addFileToVFS('Lexend-Bold.ttf', _b64.lexendBold)
    doc.addFileToVFS('PlusJakarta-Regular.ttf', _b64.jakartaNormal)
    doc.addFileToVFS('PlusJakarta-Bold.ttf', _b64.jakartaBold)

    // Override the standard Helvetica id so all setFont('helvetica', ...) calls
    // in the existing builders render in Lexend (Lexend has no italic - reuse
    // the upright face for italic/bolditalic styles).
    doc.addFont('Lexend-Regular.ttf', 'helvetica', 'normal')
    doc.addFont('Lexend-Bold.ttf', 'helvetica', 'bold')
    doc.addFont('Lexend-Regular.ttf', 'helvetica', 'italic')
    doc.addFont('Lexend-Bold.ttf', 'helvetica', 'bolditalic')

    // Headings family.
    doc.addFont('PlusJakarta-Regular.ttf', 'PlusJakarta', 'normal')
    doc.addFont('PlusJakarta-Bold.ttf', 'PlusJakarta', 'bold')

    doc.setFont('helvetica', 'normal')
    doc.__brandFonts = { body: 'helvetica', head: 'PlusJakarta' }
    return doc.__brandFonts
  } catch (e) {
    return null
  }
}
