import { useEffect, useRef, useState } from 'react'
import { useData } from '@/context/DataContext'

// Live "X is typing…" presence for a chat, Messenger-style.
//   chatKey - stable per conversation: `direct_{studentId}` or `group_{msgId}`.
//   me      - { id, name } of the current user (teacher uses id 'admin').
// Returns { typers, notifyTyping, stopTyping }:
//   • call notifyTyping() on every keystroke (it throttles writes),
//   • call stopTyping() on send / blur,
//   • render `typers` ([{ id, name }]) excluding yourself.
//
// Freshness is driven by snapshot arrival (clock-skew-immune): each throttled
// write changes the doc, refreshing every viewer's 8s safety timer; if the typer
// stops or disconnects, the doc stops changing and the indicator clears.
export function useTyping(chatKey, me) {
  const { db, fbReady } = useData()
  const [typers, setTypers] = useState([])
  const safetyTimer = useRef(null)
  const lastWrite = useRef(0)
  const stopTimer = useRef(null)
  const meId = me?.id

  useEffect(() => {
    setTypers([])
    if (!chatKey || !fbReady || !db.current) return
    let unsub = null
    let cancelled = false
    ;(async () => {
      const { doc, onSnapshot } = await import('firebase/firestore')
      if (cancelled) return
      unsub = onSnapshot(doc(db.current, 'typing', chatKey), snap => {
        const data = snap.data() || {}
        const present = Object.entries(data)
          .filter(([uid, info]) => uid !== meId && info && info.name)
          .map(([uid, info]) => ({ id: uid, name: info.name }))
        setTypers(present)
        clearTimeout(safetyTimer.current)
        if (present.length) safetyTimer.current = setTimeout(() => setTypers([]), 8000)
      }, () => {})
    })()
    return () => {
      cancelled = true
      if (unsub) unsub()
      clearTimeout(safetyTimer.current)
      setTypers([])
    }
  }, [chatKey, fbReady, meId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function writeTyping(isTyping) {
    if (!chatKey || !fbReady || !db.current || !meId) return
    try {
      const { doc, setDoc, deleteField } = await import('firebase/firestore')
      const ref = doc(db.current, 'typing', chatKey)
      if (isTyping) await setDoc(ref, { [meId]: { name: me.name || 'Someone', ts: Date.now() } }, { merge: true })
      else await setDoc(ref, { [meId]: deleteField() }, { merge: true })
    } catch (e) {}
  }

  function notifyTyping() {
    const now = Date.now()
    if (now - lastWrite.current > 1500) { lastWrite.current = now; writeTyping(true) }
    clearTimeout(stopTimer.current)
    stopTimer.current = setTimeout(() => { lastWrite.current = 0; writeTyping(false) }, 3000)
  }

  function stopTyping() {
    clearTimeout(stopTimer.current)
    lastWrite.current = 0
    writeTyping(false)
  }

  // Clear our own entry when the chat changes or the component unmounts.
  useEffect(() => () => { clearTimeout(stopTimer.current); writeTyping(false) }, [chatKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { typers, notifyTyping, stopTyping }
}
