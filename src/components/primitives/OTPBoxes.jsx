import React, { useRef, useCallback } from 'react'

/**
 * 6-digit OTP input widget.
 * Auto-advances on fill, handles paste (splits into boxes), backspace navigates back.
 * @param {{ value: string, onChange: (v:string)=>void, disabled?: boolean }} props
 */
export default function OTPBoxes({ value = '', onChange, disabled }) {
  const inputsRef = useRef([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '')

  const _notify = useCallback(newDigits => {
    onChange(newDigits.join(''))
  }, [onChange])

  const handleInput = useCallback((e, idx) => {
    const raw = e.target.value.replace(/\D/g, '').slice(-1)
    const newDigits = digits.slice()
    newDigits[idx] = raw
    _notify(newDigits)
    if (raw && idx < 5) {
      inputsRef.current[idx + 1]?.focus()
    }
  }, [digits, _notify])

  const handleKeyDown = useCallback((e, idx) => {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        const newDigits = digits.slice()
        newDigits[idx] = ''
        _notify(newDigits)
      } else if (idx > 0) {
        inputsRef.current[idx - 1]?.focus()
      }
    }
  }, [digits, _notify])

  const handlePaste = useCallback((e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const newDigits = Array.from({ length: 6 }, (_, i) => pasted[i] || '')
    _notify(newDigits)
    const focusIdx = Math.min(pasted.length, 5)
    inputsRef.current[focusIdx]?.focus()
  }, [_notify])

  return (
    <div className="flex gap-2 justify-center my-4">
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={el => { inputsRef.current[idx] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          disabled={disabled}
          onInput={e => handleInput(e, idx)}
          onKeyDown={e => handleKeyDown(e, idx)}
          onPaste={handlePaste}
          onChange={() => {}} // controlled — suppress React warning
          className="w-10 h-12 text-center text-xl font-bold border-2 border-border rounded-lg bg-surface text-ink focus:border-accent-m focus:outline-none transition-colors"
          style={{ fontSize: 22 }}
        />
      ))}
    </div>
  )
}
