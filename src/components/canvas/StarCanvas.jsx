import React, { useRef, useEffect } from 'react'

/**
 * Animated star field rendered on a <canvas>.
 * Respects prefers-reduced-motion.
 * Mounts the RAF loop on mount, cleans up on unmount.
 */
export default function StarCanvas({ style }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Respect user preference for reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = canvas.getContext('2d')
    let W, H, stars = [], animId

    function resize() {
      W = canvas.width  = window.innerWidth
      H = canvas.height = window.innerHeight
    }

    function mkStars() {
      stars = []
      const n = Math.floor((W * H) / 5500)
      for (let i = 0; i < n; i++) {
        stars.push({
          x:     Math.random() * W,
          y:     Math.random() * H,
          r:     Math.random() * 1.4 + 0.3,
          o:     Math.random(),
          do:    (Math.random() * 0.008 + 0.002) * (Math.random() > .5 ? 1 : -1),
          speed: Math.random() * 0.06 + 0.01,
          drift: (Math.random() - .5) * 0.04,
          gold:  Math.random() < 0.08,
        })
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      stars.forEach(s => {
        s.o += s.do
        if (s.o > 1 || s.o < 0.05) s.do *= -1
        s.y -= s.speed
        s.x += s.drift
        if (s.y < -2)  { s.y = H + 2; s.x = Math.random() * W }
        if (s.x < -2)  s.x = W + 2
        if (s.x > W + 2) s.x = -2

        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = s.gold
          ? `rgba(200,168,75,${s.o})`
          : `rgba(255,255,255,${s.o * 0.9})`
        ctx.fill()

        // Cross-sparkle on bigger bright stars
        if (s.r > 1.1 && s.o > 0.7) {
          const len = s.r * 3
          ctx.strokeStyle = s.gold
            ? `rgba(200,168,75,${s.o * 0.5})`
            : `rgba(255,255,255,${s.o * 0.4})`
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y)
          ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len)
          ctx.stroke()
        }
      })
      animId = requestAnimationFrame(draw)
    }

    function onResize() {
      resize()
      mkStars()
    }

    resize()
    mkStars()
    draw()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    />
  )
}
