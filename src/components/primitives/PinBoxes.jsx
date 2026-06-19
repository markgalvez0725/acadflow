import React, { useRef, useCallback } from 'react'

/**
 * 4-digit PIN input widget — same pattern as OTPBoxes.
 */
export default function PinBoxes({ value = '', onChange, disabled }) {
  const inputsRef = useRef([])
  const digits = Array.from({ length: 4 }, (_, i) => value[i] || '')

  const _notify = useCallback(newDigits => {
    onChange(newDigits.join(''))
  }, [onChange])

  const handleInput = useCallback((e, idx) => {
    const raw = e.target.value.replace(/\D/g, '').slice(-1)
    const newDigits = digits.slice()
    newDigits[idx] = raw
    _notify(newDigits)
    if (raw && idx < 3) inputsRef.current[idx + 1]?.focus()
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
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    const newDigits = Array.from({ length: 4 }, (_, i) => pasted[i] || '')
    _notify(newDigits)
    inputsRef.current[Math.min(pasted.length, 3)]?.focus()
  }, [_notify])

  return (
    <div className="flex gap-3 justify-center my-4">
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={el => { inputsRef.current[idx] = el }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={d}
          disabled={disabled}
          onInput={e => handleInput(e, idx)}
          onKeyDown={e => handleKeyDown(e, idx)}
          onPaste={handlePaste}
          onChange={() => {}}
          className="w-12 h-14 text-center text-2xl font-bold border-2 border-border rounded-lg bg-surface text-ink focus:border-accent-m focus:outline-none transition-colors"
        />
      ))}
    </div>
  )
}
