// ── Shared rich text editor ────────────────────────────────────────────────
// One contentEditable editor used across the app (announcements, activity
// instructions + case prompts, quiz questions + explanations, feedback). It
// stores sanitized HTML and pairs with <RichText> for a matching display.
// Extracted from the Stream editor so every site looks and behaves the same.
import { useRef, useEffect } from 'react'
import { Bold, Italic, Underline, Highlighter, List, ListOrdered, Link, Sparkles } from 'lucide-react'
import { sanitizeRichHtml } from '@/utils/sanitizeHtml'

export default function RichTextEditor({ value, onChange, placeholder, rows = 3, onCompose }) {
  const editorRef = useRef(null)
  const lastEmitted = useRef(null)

  // Controlled: reflect an external value change (e.g. an Auto-write or
  // Smart-grade button that sets the field from outside) into the DOM, but never
  // re-sync while the user is typing - our own onChange sets lastEmitted so
  // value === lastEmitted and we skip, which keeps the caret from jumping.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const next = sanitizeRichHtml(value || '')
    if (value !== lastEmitted.current && next !== el.innerHTML) {
      el.innerHTML = next
    }
  }, [value])

  function emit(clean) {
    lastEmitted.current = clean
    onChange(clean)
  }

  function exec(cmd, val = null) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val)
    emit(sanitizeRichHtml(editorRef.current.innerHTML))
  }

  function handleInput() {
    emit(sanitizeRichHtml(editorRef.current.innerHTML))
  }

  function insertLink() {
    const url = window.prompt('Enter the link URL:', 'https://')
    if (!url || url === 'https://') return
    editorRef.current?.focus()
    document.execCommand('createLink', false, url)
    emit(sanitizeRichHtml(editorRef.current.innerHTML))
  }

  function smartWrite() {
    const html = onCompose?.()
    if (!html) return
    const clean = sanitizeRichHtml(html)
    if (editorRef.current) {
      editorRef.current.innerHTML = clean
      emit(clean)
      editorRef.current.focus()
    }
  }

  function insertTable() {
    const dims = window.prompt('Table size (rows x columns):', '2 x 2')
    if (!dims) return
    const [r, c] = dims.split(/[x×,]/i).map(n => parseInt(n.trim(), 10))
    const rows = Math.min(Math.max(r || 2, 1), 10)
    const cols = Math.min(Math.max(c || 2, 1), 8)
    let html = '<table><tbody>'
    for (let i = 0; i < rows; i++) {
      html += '<tr>'
      for (let j = 0; j < cols; j++) html += '<td>&nbsp;</td>'
      html += '</tr>'
    }
    html += '</tbody></table><p><br></p>'
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, html)
    emit(sanitizeRichHtml(editorRef.current.innerHTML))
  }

  const btnStyle = {
    padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', background: 'var(--bg)' }}>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('bold') }} title="Bold"><Bold size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('italic') }} title="Italic"><Italic size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('underline') }} title="Underline"><Underline size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('hiliteColor', '#fef08a') }} title="Highlight"><Highlighter size={13} /></button>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }} title="Bullet list"><List size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list"><ListOrdered size={13} /></button>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        <select
          style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}
          defaultValue=""
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('formatBlock', e.target.value); e.target.value = '' }}
        >
          <option value="" disabled>Heading</option>
          <option value="h3">Heading 1</option>
          <option value="h4">Heading 2</option>
          <option value="p">Normal</option>
        </select>
        <select
          style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}
          defaultValue=""
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('fontSize', e.target.value); e.target.value = '' }}
          title="Font size"
        >
          <option value="" disabled>Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">Huge</option>
        </select>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'pre') }} title="Code block">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); insertLink() }} title="Insert link"><Link size={13} /></button>
        <button type="button" style={btnStyle} onMouseDown={e => { e.preventDefault(); insertTable() }} title="Insert table">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        </button>
        {onCompose && (
          <>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); smartWrite() }}
              title="Draft this message on-device from the details above"
              style={{ ...btnStyle, gap: 4, padding: '3px 9px', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)', background: 'var(--accent-l)', fontWeight: 600, fontSize: 11.5 }}
            >
              <Sparkles size={13} /> Smart write
            </button>
          </>
        )}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        style={{
          minHeight: `${rows * 1.6}em`,
          padding: '10px 12px',
          fontSize: 13,
          color: 'var(--ink)',
          lineHeight: 1.6,
          outline: 'none',
          overflowY: 'auto',
        }}
        className="rich-editor"
      />
    </div>
  )
}
