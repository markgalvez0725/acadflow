// ── Audio-shield (farbling) detection ────────────────────────────────────────
// Privacy browsers - Brave above all - "farble" the Web Audio API as an
// anti-fingerprinting defense: reads of audio sample data are deliberately
// perturbed per site + session. That is harmless for fingerprint scripts but
// poison for the meeting stack, where real audio flows through Web Audio:
//   - the class recorder mixes every voice through an AudioContext graph, and
//     Brave's farbling is known to skew multi-voice mixes (some voices come
//     out too quiet or effectively missing, brave-browser#52906);
//   - the transcriber reads mic samples via getChannelData, so farbled reads
//     degrade what Whisper hears.
// Farbling cannot be bypassed from page code - the only real fix is the user
// turning OFF "Block fingerprinting" for this site in Brave Shields. This
// module just detects the situation reliably so the room can say so.
//
// Detection: write a known Float32 signal into an AudioBuffer and read it
// back. The spec makes that round-trip bit-exact, so ANY difference means the
// browser is tampering with audio reads. An inert OfflineAudioContext is used
// (creating a real AudioContext would grab an audio output slot).

let _result = null

export function isBraveBrowser() {
  // navigator.brave only exists in Brave; presence alone is the documented
  // detection (isBrave() merely re-confirms it asynchronously).
  return typeof navigator !== 'undefined' && !!navigator.brave
}

export async function detectAudioShield() {
  if (_result) return _result
  const out = { brave: isBraveBrowser(), farbled: false }
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (Ctx) {
      const ctx = new Ctx(1, 128, 44100)
      const N = 512
      const buf = ctx.createBuffer(1, N, 44100)
      const known = new Float32Array(N)
      for (let i = 0; i < N; i++) known[i] = Math.sin(i / 7) * 0.5
      buf.copyToChannel(known, 0)
      const back = buf.getChannelData(0)
      for (let i = 0; i < N; i++) {
        if (back[i] !== known[i]) { out.farbled = true; break }
      }
    }
  } catch { /* detection is best-effort; assume clean */ }
  _result = out
  return out
}
