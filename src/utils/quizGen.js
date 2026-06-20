// ── On-device quiz drafter (free, no AI) ──────────────────────────────────
// Turns lesson text into draft quiz questions using deterministic rules.
// Output matches the app's question shape: { id, type, question, options?, answer }.
// Drafts are meant to be reviewed and edited by the teacher before saving.

const STOPWORDS = new Set(('a an the and or but of to in on at for with from by as is are was were be been being ' +
  'this that these those it its their there which who whom whose what when where why how can could should would ' +
  'will may might must shall do does did have has had not no yes if then else than so such into over under about ' +
  'between among through during before after above below up down out off again further once here also more most ' +
  'other some any all each every both few many much own same very you your they them we our us he she his her i').split(' '))

let _seq = 0
function qid() { return 'q_' + Date.now() + '_' + (_seq++) }

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(s => s.length >= 40 && s.length <= 240 && /[a-z]/.test(s) && /\s/.test(s))
}

// Candidate key terms: title-case phrases + frequent meaningful words.
function keyTerms(text) {
  const counts = {}
  const phrases = {}
  // Title-case phrases (e.g. "Game Loop", "Object Oriented Programming")
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g)) {
    const p = m[1].trim()
    if (p.split(' ').length >= 1 && p.length > 3) phrases[p] = (phrases[p] || 0) + 1
  }
  // Frequent lowercase content words
  for (const w of text.toLowerCase().matchAll(/\b[a-z][a-z-]{4,}\b/g)) {
    const word = w[0]
    if (!STOPWORDS.has(word)) counts[word] = (counts[word] || 0) + 1
  }
  const phraseList = Object.entries(phrases).sort((a, b) => b[1] - a[1]).map(([p]) => p)
  const wordList = Object.entries(counts).sort((a, b) => b[1] - a[1]).filter(([w, c]) => c >= 2).map(([w]) => w)
  // Prefer multi-word phrases, then frequent words
  return [...new Set([...phraseList, ...wordList])]
}

// Definitions from "X is/are/refers to/means ..." patterns.
function definitions(sentences) {
  const defs = []
  const re = /^(.{3,60}?)\s+(?:is|are|refers to|means|is called|is defined as|describes|represents)\s+(.{8,})$/i
  for (const s of sentences) {
    const m = s.match(re)
    if (m) {
      const term = m[1].replace(/^(the|a|an)\s+/i, '').trim()
      const def = m[2].replace(/[.]+$/, '').trim()
      if (term.length <= 60 && def.length >= 10 && term.split(' ').length <= 6) {
        defs.push({ term, def, sentence: s })
      }
    }
  }
  return defs
}

function pickDistractors(correct, pool, n = 3) {
  const out = []
  const seen = new Set([correct.toLowerCase()])
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  for (const t of shuffled) {
    if (out.length >= n) break
    if (seen.has(t.toLowerCase())) continue
    if (Math.abs(t.length - correct.length) > 40) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

/**
 * @param {string} text lesson text
 * @param {{count?:number, types?:string[]}} opts
 * @returns {Array<{id,type,question,options?,answer}>}
 */
export function generateDraftQuestions(text, { count = 10, types = ['multiple_choice', 'true_false', 'fill_in_the_blank', 'identification'] } = {}) {
  const sentences = splitSentences(text)
  const terms = keyTerms(text)
  const defs = definitions(sentences)
  const out = []
  const usedSentences = new Set()

  const want = (t) => types.includes(t)
  let ti = 0
  const order = types.length ? types : ['multiple_choice']

  // Helper: find a sentence containing one of the key terms not yet used.
  function sentenceWithTerm() {
    for (const term of terms) {
      const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      const s = sentences.find(x => !usedSentences.has(x) && re.test(x) && x.length < 220)
      if (s) return { s, term }
    }
    return null
  }

  let guard = 0
  while (out.length < count && guard < count * 6) {
    guard++
    const type = order[ti % order.length]; ti++

    if (type === 'identification' && defs.length) {
      const d = defs.shift()
      out.push({ id: qid(), type: 'identification', question: `What term is being described: "${cap(d.def)}"?`, answer: d.term })
      continue
    }
    if (type === 'fill_in_the_blank') {
      const hit = sentenceWithTerm()
      if (hit) {
        usedSentences.add(hit.s)
        const re = new RegExp('\\b' + hit.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
        out.push({ id: qid(), type: 'fill_in_the_blank', question: hit.s.replace(re, '___'), answer: hit.term })
        continue
      }
    }
    if (type === 'multiple_choice') {
      const hit = sentenceWithTerm()
      if (hit && terms.length >= 4) {
        usedSentences.add(hit.s)
        const re = new RegExp('\\b' + hit.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
        const stem = hit.s.replace(re, '______')
        const distractors = pickDistractors(hit.term, terms, 3)
        if (distractors.length === 3) {
          const options = shuffle([hit.term, ...distractors])
          out.push({ id: qid(), type: 'multiple_choice', question: `Fill in the blank: ${stem}`, options, answer: hit.term })
          continue
        }
      }
      // fallback to definition-based MCQ
      if (defs.length && terms.length >= 4) {
        const d = defs.shift()
        const distractors = pickDistractors(d.term, terms, 3)
        if (distractors.length === 3) {
          const options = shuffle([d.term, ...distractors])
          out.push({ id: qid(), type: 'multiple_choice', question: `Which term means: "${cap(d.def)}"?`, options, answer: d.term })
          continue
        }
      }
    }
    if (type === 'true_false') {
      const s = sentences.find(x => !usedSentences.has(x))
      if (s) {
        usedSentences.add(s)
        // ~40% produce a false statement by swapping a key term
        const makeFalse = Math.random() < 0.4 && terms.length >= 2
        if (makeFalse) {
          const present = terms.find(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(s))
          const swap = present ? pickDistractors(present, terms, 1)[0] : null
          if (present && swap) {
            const re = new RegExp('\\b' + present.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
            out.push({ id: qid(), type: 'true_false', question: s.replace(re, swap), answer: 'False' })
            continue
          }
        }
        out.push({ id: qid(), type: 'true_false', question: s, answer: 'True' })
        continue
      }
    }
    if (type === 'short_answer') {
      const s = sentences.find(x => !usedSentences.has(x))
      if (s) {
        usedSentences.add(s)
        out.push({ id: qid(), type: 'short_answer', question: `In your own words, explain: "${cap(s.split(' ').slice(0, 12).join(' '))}…"`, answer: s })
        continue
      }
    }
    // If the chosen type couldn't produce, try a fill-in-blank fallback
    const hit = sentenceWithTerm()
    if (hit && want('fill_in_the_blank')) {
      usedSentences.add(hit.s)
      const re = new RegExp('\\b' + hit.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      out.push({ id: qid(), type: 'fill_in_the_blank', question: hit.s.replace(re, '___'), answer: hit.term })
    } else {
      const s = sentences.find(x => !usedSentences.has(x))
      if (!s) break
      usedSentences.add(s)
      out.push({ id: qid(), type: 'true_false', question: s, answer: 'True' })
    }
  }

  return out.slice(0, count)
}
