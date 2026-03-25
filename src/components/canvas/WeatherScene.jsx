import React, { useState, useEffect, useRef } from 'react'
import { getScene, applySceneBackground, OMURL, WX_ICONS, wmoToCondition, wmoLabel } from './scenes.js'

const DEFAULT_WX = {
  condition: 'clear',
  windKph:   0,
  tempC:     30,
  label:     'Clear',
  loaded:    false,
}

/**
 * Time-of-day + weather background layer.
 *
 * Renders:
 *  - a full-screen gradient background (via `style.background` on parent or returned value)
 *  - an inline SVG overlay (time scene + weather effects)
 *  - a weather badge (top-right, shown when `showBadge` is true)
 *
 * Props:
 *  - isDark       {boolean}  — current theme
 *  - showBadge    {boolean}  — show weather badge (hide on admin portal)
 *  - style        {object}   — extra style for the SVG wrapper
 */
export default function WeatherScene({ isDark = false, showBadge = true, style }) {
  const [wx, setWx] = useState(DEFAULT_WX)
  const [scene, setScene] = useState(() => getScene())
  const [svgHtml, setSvgHtml] = useState('')
  const [bg, setBg] = useState('')
  const intervalRef = useRef(null)

  // Inject required keyframes once
  useEffect(() => {
    if (document.getElementById('td-kf')) return
    const st = document.createElement('style')
    st.id = 'td-kf'
    st.textContent = `
      @keyframes td-ray-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      @keyframes td-cl1 { 0%,100%{transform:translateX(0)} 50%{transform:translateX(16px)} }
      @keyframes td-cl2 { 0%,100%{transform:translateX(0)} 50%{transform:translateX(-12px)} }
      @keyframes td-birds { 0%{transform:translateX(0)} 100%{transform:translateX(calc(100vw + 200px))} }
      @keyframes wxSlideIn { from{opacity:0;transform:translateX(8px) scale(.95)} to{opacity:1;transform:translateX(0) scale(1)} }
    `
    document.head.appendChild(st)
  }, [])

  // Rebuild SVG + gradient when scene, wx, or theme changes
  useEffect(() => {
    const vw = 800
    const vh = 520
    setSvgHtml(scene.buildSVG(vw, vh, wx))
    setBg(applySceneBackground(scene, isDark))
  }, [scene, wx, isDark])

  // Update scene every minute (Philippine time)
  useEffect(() => {
    function tick() {
      setScene(getScene())
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // Fetch weather on mount, then every 15 minutes
  useEffect(() => {
    async function fetchWeather() {
      try {
        const res  = await fetch(OMURL, { cache: 'no-store' })
        const data = await res.json()
        const nowPH  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
        const hourIdx = nowPH.getHours()
        const code = data.hourly.weathercode[hourIdx]
        const wind = data.hourly.windspeed_10m[hourIdx]
        const temp = data.hourly.temperature_2m[hourIdx]
        setWx({
          condition: wmoToCondition(code, wind),
          windKph:   wind,
          tempC:     Math.round(temp),
          label:     wmoLabel(code),
          loaded:    true,
          fetchedAt: Date.now(),
        })
      } catch {
        setWx(prev => ({ ...prev, loaded: true }))
      }
    }

    fetchWeather()
    intervalRef.current = setInterval(fetchWeather, 15 * 60_000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const icon = WX_ICONS[wx.condition] || '🌤️'

  return (
    <>
      {/* Gradient background — caller applies `bg` to their container */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: bg,
          transition: 'background 1.5s ease',
          zIndex: 0,
        }}
      />

      {/* SVG scene overlay */}
      <svg
        viewBox={`0 0 800 520`}
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          pointerEvents: 'none',
          ...style,
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />

      {/* Weather badge */}
      {showBadge && wx.loaded && (
        <div
          style={{
            position: 'fixed',
            top: 60,
            right: 14,
            zIndex: 490,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px 5px 7px',
            borderRadius: 20,
            background: 'rgba(0,0,0,.30)',
            backdropFilter: 'blur(10px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(10px) saturate(1.3)',
            border: '1px solid rgba(255,255,255,.12)',
            boxShadow: '0 2px 12px rgba(0,0,0,.18)',
            cursor: 'default',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 180,
            animation: 'wxSlideIn .45s cubic-bezier(.22,.8,.38,1) both',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0, overflow: 'hidden' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.90)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {wx.label}
            </span>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.52)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              {wx.tempC}°C · Manila
            </span>
          </span>
        </div>
      )}
    </>
  )
}
