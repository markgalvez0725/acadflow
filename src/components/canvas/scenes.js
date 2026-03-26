// ─────────────────────────────────────────────────────────────────
// scenes.js  — Time-of-day + weather scene engine (Philippines / PH time)
// Pure JS module — no React imports.
// buildSVG(vw, vh, wx) takes wx as a param (from component state).
// ─────────────────────────────────────────────────────────────────

// Open-Meteo endpoint — Manila coords, PH timezone, hourly WMO code + wind
export const OMURL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=14.5995&longitude=120.9842' +
  '&hourly=weathercode,windspeed_10m,temperature_2m' +
  '&timezone=Asia%2FManila&forecast_days=1'

export const WX_ICONS = {
  clear: '☀️', partly_cloudy: '⛅', cloudy: '☁️',
  rain: '🌧️', heavy_rain: '🌧️', thunderstorm: '⛈️',
  windy: '💨', fog: '🌫️',
}

export function wmoToCondition(code, windKph) {
  if (code === 0)                    return 'clear'
  if (code <= 2)                     return 'partly_cloudy'
  if (code === 3)                    return 'cloudy'
  if (code >= 45 && code <= 48)     return 'fog'
  if (code >= 51 && code <= 67)     return 'rain'
  if (code >= 71 && code <= 77)     return 'rain'   // snow → rain (PH climate)
  if (code >= 80 && code <= 82)     return 'rain'
  if (code >= 85 && code <= 86)     return 'rain'
  if (code >= 95 && code <= 99)     return 'thunderstorm'
  if (windKph > 40)                  return 'windy'
  return 'cloudy'
}

export function wmoLabel(code) {
  if (code === 0) return 'Clear Sky'
  if (code <= 2)  return 'Partly Cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Foggy'
  if (code <= 67) return 'Rainy'
  if (code <= 77) return 'Rainy'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Showers'
  if (code <= 99) return 'Thunderstorm'
  return 'Cloudy'
}

// ─────────────────────────────────────────────────────────────────
// SVG HELPERS
// ─────────────────────────────────────────────────────────────────

function sun(cx, cy, r, c1, c2) {
  return `<defs>
    <radialGradient id="td-sn${Math.round(cx)}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c2}"/>
      <stop offset="60%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
    </radialGradient></defs>
  <circle cx="${cx}" cy="${cy}" r="${r * 2.2}" fill="url(#td-sn${Math.round(cx)})" opacity=".45"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${c1}" opacity=".95">
    <animate attributeName="r" values="${r};${r * 1.04};${r}" dur="5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".95;1;.95" dur="5s" repeatCount="indefinite"/>
  </circle>`
}

function sunRising(cx, cy, r, c1, c2) {
  return `<defs>
    <clipPath id="td-hclip">
      <rect x="${cx - r * 2}" y="${cy - r}" width="${r * 4}" height="${r * 2}"/>
    </clipPath>
    <radialGradient id="td-srng" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </radialGradient></defs>
  <circle cx="${cx}" cy="${cy}" r="${r * 2.4}" fill="${c2}" opacity=".3" clip-path="url(#td-hclip)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#td-srng)" clip-path="url(#td-hclip)">
    <animate attributeName="r" values="${r};${r * 1.05};${r}" dur="4s" repeatCount="indefinite"/>
  </circle>`
}

function sunSetting(cx, cy, r, col) {
  return `<defs>
    <clipPath id="td-sset">
      <rect x="${cx - r * 2}" y="${cy - r}" width="${r * 4}" height="${r * 2}"/>
    </clipPath></defs>
  <circle cx="${cx}" cy="${cy}" r="${r * 2.8}" fill="${col}" opacity=".18" clip-path="url(#td-sset)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" opacity=".9" clip-path="url(#td-sset)">
    <animate attributeName="r" values="${r};${r * 1.04};${r}" dur="5s" repeatCount="indefinite"/>
  </circle>`
}

function moon(cx, cy, r) {
  return `<defs>
    <radialGradient id="td-mn" cx="40%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#f0f4ff"/>
      <stop offset="100%" stop-color="#b8c8e8"/>
    </radialGradient></defs>
  <circle cx="${cx + r * .3}" cy="${cy}" r="${r}" fill="#0a0f20"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#td-mn)" opacity=".92">
    <animate attributeName="opacity" values=".88;.96;.88" dur="8s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${cx - r * .25}" cy="${cy - r * .22}" r="${r * .14}" fill="#d0daf0" opacity=".4"/>
  <circle cx="${cx + r * .18}" cy="${cy + r * .3}" r="${r * .09}" fill="#d0daf0" opacity=".3"/>`
}

function rays(cx, cy, sr, count, len, col, alpha) {
  let out = `<g opacity="${alpha}" style="transform-origin:${cx}px ${cy}px;animation:td-ray-spin 40s linear infinite">`
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const x1 = cx + Math.cos(a) * (sr + 4), y1 = cy + Math.sin(a) * (sr + 4)
    const x2 = cx + Math.cos(a) * (sr + 4 + len), y2 = cy + Math.sin(a) * (sr + 4 + len)
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`
  }
  return out + '</g>'
}

function clouds(vw, vh, fill, count) {
  const positions = [[.15, .13, .85, .25], [.42, .07, .62, .18], [.68, .1, .75, .22], [.08, .25, .6, .18], [.78, .17, .72, .22]].slice(0, count)
  const anims = ['td-cl1', 'td-cl2', 'td-cl1', 'td-cl2', 'td-cl1']
  let out = ''
  positions.forEach(([cx, cy, rx, ry], i) => {
    out += `<g style="animation:${anims[i]} ${18 + i * 5}s ease-in-out infinite" filter="url(#td-cfilt${i})">
      <defs><filter id="td-cfilt${i}"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
      <ellipse cx="${(vw * cx).toFixed(0)}" cy="${(vh * cy).toFixed(0)}" rx="${(vw * rx * .38).toFixed(0)}" ry="${(vh * ry * .7).toFixed(0)}" fill="${fill}"/>
      <ellipse cx="${(vw * (cx + .06)).toFixed(0)}" cy="${(vh * (cy - .015)).toFixed(0)}" rx="${(vw * rx * .26).toFixed(0)}" ry="${(vh * ry * .6).toFixed(0)}" fill="${fill}"/>
      <ellipse cx="${(vw * (cx - .05)).toFixed(0)}" cy="${(vh * (cy + .005)).toFixed(0)}" rx="${(vw * rx * .22).toFixed(0)}" ry="${(vh * ry * .55).toFixed(0)}" fill="${fill}"/>
    </g>`
  })
  return out
}

function birds(vw, vh) {
  const y = vh * .22
  return `<g opacity=".4" style="animation:td-birds 50s linear infinite">
    <path d="M-80 ${y} Q-76 ${y - 5} -72 ${y}" stroke="#4a7fa8" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M-62 ${y - 8} Q-58 ${y - 13} -54 ${y - 8}" stroke="#4a7fa8" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M-96 ${y + 8} Q-92 ${y + 3} -88 ${y + 8}" stroke="#4a7fa8" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M-48 ${y - 2} Q-44 ${y - 7} -40 ${y - 2}" stroke="#4a7fa8" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>`
}

function stars_svg(vw, vh, count, dense) {
  const total = dense ? count * 3 : count, seed = 42
  let out = ''
  for (let i = 0; i < total; i++) {
    const x = ((i * 127 + seed) % vw).toFixed(1), y = ((i * 83 + seed) % vh).toFixed(1)
    const r = (.3 + ((i * 31) % 14) * .1).toFixed(1)
    const dur = (3 + ((i * 17) % 8)).toFixed(1), del = ((i * 7) % 6).toFixed(1)
    const col = i % 13 === 0 ? 'rgba(200,168,75,' : 'rgba(255,255,255,'
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}.7)">
      <animate attributeName="opacity" values=".2;.9;.2" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
    </circle>`
  }
  return out
}

function milkyWay(vw, vh) {
  return `<defs>
    <linearGradient id="td-mw" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="rgba(120,140,200,0)"/>
      <stop offset="40%"  stop-color="rgba(140,160,220,.12)"/>
      <stop offset="60%"  stop-color="rgba(160,180,240,.08)"/>
      <stop offset="100%" stop-color="rgba(120,140,200,0)"/>
    </linearGradient></defs>
  <ellipse cx="${vw * .5}" cy="${vh * .5}" rx="${vw * .22}" ry="${vh * .85}" fill="url(#td-mw)" transform="rotate(-35,${vw * .5},${vh * .5})"/>`
}

function horizonGlow(vw, vh) {
  return `<defs>
    <linearGradient id="td-hg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="rgba(255,140,0,0)"/>
      <stop offset="100%" stop-color="rgba(255,100,0,.35)"/>
    </linearGradient></defs>
  <rect x="0" y="${vh * .6}" width="${vw}" height="${vh * .4}" fill="url(#td-hg)"/>`
}

function horizonShimmer(vw, vh, col) {
  return `<ellipse cx="${vw * .5}" cy="${vh}" rx="${vw * .6}" ry="${vh * .15}" fill="${col}">
    <animate attributeName="opacity" values=".6;1;.6" dur="6s" repeatCount="indefinite"/>
  </ellipse>`
}

function heatHaze(vw, vh) {
  return `<defs>
    <linearGradient id="td-haze" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="rgba(255,255,200,0)"/>
      <stop offset="100%" stop-color="rgba(255,250,180,.08)"/>
    </linearGradient></defs>
  <rect width="${vw}" height="${vh}" fill="url(#td-haze)"/>`
}

function silhouettes(vw, vh) {
  const base = vh * .78
  let out = `<g fill="#0a0415" opacity=".85">`
  const buildings = [[.1, 55, 38], [.2, 42, 30], [.32, 60, 28], [.45, 35, 25], [.55, 50, 32], [.65, 38, 28], [.75, 52, 34], [.85, 40, 26], [.92, 30, 22]]
  buildings.forEach(([xr, h, w]) => {
    const x = vw * xr - w / 2, y = base - h
    out += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w}" height="${h + vh * .22 + 5}"/>`
    if (h > 40) {
      for (let wy = y + 6; wy < base - 8; wy += 10)
        for (let wx = x + 5; wx < x + w - 5; wx += 9)
          if (Math.random() > .45) out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="5" fill="rgba(255,220,100,.55)"/>`
    }
  })
  return out + `</g>`
}

// ─────────────────────────────────────────────────────────────────
// WEATHER PRIMITIVES
// ─────────────────────────────────────────────────────────────────

function cloudCover(vw, vh, cond = 'clear') {
  const map = {
    'clear': 0, 'partly_cloudy': 2, 'cloudy': 5, 'fog': 5,
    'rain': 4, 'heavy_rain': 5, 'thunderstorm': 5, 'windy': 3,
  }
  const n = map[cond] || 0
  if (!n) return ''
  const darkClouds = ['thunderstorm', 'heavy_rain', 'rain'].includes(cond)
  const fill = darkClouds ? 'rgba(80,80,100,.75)' : 'rgba(255,255,255,.80)'
  return clouds(vw, vh, fill, n)
}

function rain(vw, vh, heavy) {
  const count = heavy ? 80 : 40
  const len   = heavy ? 18 : 12
  const col   = heavy ? 'rgba(160,190,220,.65)' : 'rgba(160,200,230,.45)'
  const dur   = heavy ? '.55s' : '.8s'
  let drops = ''
  for (let i = 0; i < count; i++) {
    const x   = ((i * 113 + 7) % vw).toFixed(0)
    const y   = ((i * 67 + 11) % vh).toFixed(0)
    const del = ((i * .06) % 1).toFixed(2)
    drops += `<line x1="${x}" y1="${y}" x2="${(+x + 4).toFixed(0)}" y2="${(+y + len).toFixed(0)}"
      stroke="${col}" stroke-width="1.2" stroke-linecap="round">
      <animate attributeName="y1" values="${y};${vh + len}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="y2" values="${(+y + len).toFixed(0)};${vh + len * 2}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="x1" from="${x}" to="${(+x + 4).toFixed(0)}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="x2" from="${(+x + 4).toFixed(0)}" to="${(+x + 8).toFixed(0)}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
    </line>`
  }
  return `<g opacity="${heavy ? .88 : .7}">${drops}</g>`
}

function lightning(vw, vh) {
  const cx = vw * .5, cy = vh * .1
  return `<g>
    <polyline points="${cx},${cy} ${cx - 18},${cy + 40} ${cx + 6},${cy + 40} ${cx - 14},${cy + 85}"
      fill="none" stroke="rgba(255,255,180,.95)" stroke-width="2.5" stroke-linejoin="round">
      <animate attributeName="opacity" values="0;0;0;1;0;1;0;0;0" dur="3.2s" begin="0.5s" repeatCount="indefinite"/>
    </polyline>
    <polyline points="${cx + 180},${cy + 30} ${cx + 162},${cy + 65} ${cx + 186},${cy + 65} ${cx + 164},${cy + 104}"
      fill="none" stroke="rgba(255,255,200,.85)" stroke-width="2" stroke-linejoin="round">
      <animate attributeName="opacity" values="0;0;1;0;0;0;1;0;0" dur="4.1s" begin="1.8s" repeatCount="indefinite"/>
    </polyline>
    <rect width="${vw}" height="${vh}" fill="rgba(180,180,255,.04)">
      <animate attributeName="opacity" values="0;0;0;.08;0;0;.05;0" dur="3.2s" begin="0.5s" repeatCount="indefinite"/>
    </rect>
  </g>`
}

function windStreaks(vw, vh) {
  let out = '<g opacity=".22">'
  const rows = [.18, .3, .42, .54, .66]
  rows.forEach((yr, i) => {
    const y = (vh * yr).toFixed(0)
    const len = 80 + i * 30, x0 = ((i * 160) % vw)
    const dur = (2.8 + i * .4).toFixed(1)
    out += `<line x1="${x0}" y1="${y}" x2="${x0 + len}" y2="${y}"
      stroke="white" stroke-width="${1.2 - i * .1}" stroke-linecap="round" opacity=".6">
      <animate attributeName="x1" values="${x0};${vw + len}" dur="${dur}s" begin="${(i * .35).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="x2" values="${x0 + len};${vw + len * 2}" dur="${dur}s" begin="${(i * .35).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".0;.6;.6;.0" dur="${dur}s" begin="${(i * .35).toFixed(2)}s" repeatCount="indefinite"/>
    </line>`
  })
  return out + '</g>'
}

function fog(vw, vh) {
  let out = '<g>'
  const bands = [.45, .58, .68, .78, .88]
  bands.forEach((yr, i) => {
    const y = (vh * yr).toFixed(0)
    const dur = (12 + i * 4).toFixed(0)
    out += `<rect x="-${vw}" y="${+y - 12}" width="${vw * 3}" height="28"
      fill="rgba(200,210,220,.12)" rx="14">
      <animate attributeName="x" values="-${vw};0;-${vw}" dur="${dur}s" begin="${i * 2}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".08;.18;.08" dur="${(dur / 2).toFixed(0)}s" repeatCount="indefinite"/>
    </rect>`
  })
  return out + '</g>'
}

// Sun modified by condition — hidden/dimmed in bad weather
function weatherModifiedSun(cx, cy, r, cond = 'clear') {
  if (cond === 'thunderstorm' || cond === 'heavy_rain') return ''
  if (cond === 'cloudy' || cond === 'fog') return sun(cx, cy, r, '#e8d060', '#fff4a0')
  if (cond === 'rain' || cond === 'partly_cloudy') return sun(cx, cy, r, '#FFD060', '#FFF0B0')
  if (cond === 'windy') return `${sun(cx, cy, r, '#FFE066', '#FFF9C4')}${windStreaks(800, 520)}`
  return `${sun(cx, cy, r, '#FFE066', '#FFF9C4')}${rays(cx, cy, r, 12, 70, '#FFD700', .3)}`
}

// Master weather overlay — composites the right layers
function weatherOverlay(vw, vh, cond = 'clear', timeOfDay) {
  let out = ''
  if (cond === 'fog') out += fog(vw, vh)
  out += cloudCover(vw, vh, cond)
  if (cond === 'rain') out += rain(vw, vh, false)
  if (cond === 'heavy_rain') out += rain(vw, vh, true)
  if (cond === 'thunderstorm') {
    out += rain(vw, vh, true)
    out += lightning(vw, vh)
  }
  if (cond === 'windy') out += windStreaks(vw, vh)
  if (cond === 'thunderstorm') {
    out += `<rect width="${vw}" height="${vh}" fill="var(--accent-l)" opacity=".3"/>`
  } else if (cond === 'heavy_rain' && timeOfDay === 'night') {
    out += `<rect width="${vw}" height="${vh}" fill="var(--c-navy)" opacity=".25"/>`
  } else if (cond === 'fog') {
    out += `<rect width="${vw}" height="${vh}" fill="var(--bg2)" opacity=".12"/>`
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
// SCENES ARRAY  (9 entries — Philippine time)
// buildSVG(vw, vh, wx) — wx passed as param from component state
// ─────────────────────────────────────────────────────────────────
export const SCENES = [

  // ── 12:00 AM – 4:00 AM · Midnight ─────────────────────────────
  { id: 'midnight', from: 0, to: 4,
    darkBg:  ['#000005', '#01040e', '#030820'],
    lightBg: ['#080c1a', '#0d1530', '#111e42'],
    buildSVG(vw, vh, wx) { return `
      <defs><radialGradient id="td-mg" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#1a2a5e" stop-opacity=".6"/>
        <stop offset="100%" stop-color="#000008" stop-opacity="0"/>
      </radialGradient></defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-mg)"/>
      ${moon(vw * .72, vh * .14, 34)}
      ${stars_svg(vw, vh, 70, true)}
      ${milkyWay(vw, vh)}
      ${weatherOverlay(vw, vh, wx.condition, 'night')}
    `},
  },

  // ── 4:00 AM – 6:00 AM · Rooster / Pre-Dawn ────────────────────
  { id: 'rooster', from: 4, to: 6,
    darkBg:  ['#02020a', '#080418', '#100628'],
    lightBg: ['#06040f', '#1a0838', '#3d1258', '#7a2060', '#c04030'],
    buildSVG(vw, vh, wx) { return `
      <defs>
        <radialGradient id="td-rdg" cx="50%" cy="100%" r="75%">
          <stop offset="0%"   stop-color="#c04030" stop-opacity=".7"/>
          <stop offset="35%"  stop-color="#7a1858" stop-opacity=".5"/>
          <stop offset="70%"  stop-color="#2a0840" stop-opacity=".3"/>
          <stop offset="100%" stop-color="#06040f"  stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="td-rdh" cx="50%" cy="100%" r="38%">
          <stop offset="0%"  stop-color="#e06020" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#c04030" stop-opacity="0"/>
        </radialGradient>
        <filter id="td-blur6"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-rdg)"/>
      <ellipse cx="${vw * .5}" cy="${vh}" rx="${vw * .4}" ry="${vh * .22}" fill="url(#td-rdh)" filter="url(#td-blur6)"/>
      ${moon(vw * .18, vh * .1, 22)}
      ${stars_svg(vw, vh * .6, 45, false)}
      <g opacity=".18">
        <rect x="0" y="${vh * .72}" width="${vw}" height="${vh * .28}"
          fill="rgba(180,60,20,.35)"/>
      </g>
      ${weatherOverlay(vw, vh, wx.condition, 'night')}
    `},
  },

  // ── 6:00 AM – 8:00 AM · Sunrise ───────────────────────────────
  { id: 'sunrise', from: 6, to: 8,
    darkBg:  ['#0d0520', '#1a0a35', '#2d1060'],
    lightBg: ['#1a0830', '#ff6b35', '#ffb347', '#ffe0a0'],
    buildSVG(vw, vh, wx) { return `
      <defs>
        <radialGradient id="td-srg" cx="50%" cy="100%" r="80%">
          <stop offset="0%"   stop-color="#ff9500" stop-opacity=".95"/>
          <stop offset="30%"  stop-color="#ff5500" stop-opacity=".7"/>
          <stop offset="60%"  stop-color="#c0007a" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#0a0520" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="td-srh" cx="50%" cy="100%" r="50%">
          <stop offset="0%"  stop-color="#ffdd00" stop-opacity=".9"/>
          <stop offset="100%" stop-color="#ff6000" stop-opacity="0"/>
        </radialGradient>
        <filter id="td-blur4"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-srg)"/>
      <ellipse cx="${vw * .5}" cy="${vh}" rx="${vw * .45}" ry="${vh * .28}" fill="url(#td-srh)" filter="url(#td-blur4)"/>
      ${sunRising(vw * .5, vh * .92, 42, '#ffdd88', '#ff9900')}
      ${rays(vw * .5, vh * .92, 42, 16, 80, '#ffcc44', .25)}
      ${horizonGlow(vw, vh)}
      ${stars_svg(vw, vh * .45, 18, false)}
      ${weatherOverlay(vw, vh, wx.condition, 'dawn')}
    `},
  },

  // ── 8:00 AM – 12:00 NN · Morning ──────────────────────────────
  { id: 'morning', from: 8, to: 12,
    darkBg:  ['#061524', '#0a2540', '#0d3060'],
    lightBg: ['#87ceeb', '#aadff7', '#e8f8ff', '#fff8e7'],
    buildSVG(vw, vh, wx) { return `
      <defs><radialGradient id="td-mog" cx="70%" cy="15%" r="70%">
        <stop offset="0%"   stop-color="#e0f4ff"/>
        <stop offset="100%" stop-color="#87ceeb"/>
      </radialGradient></defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-mog)" opacity=".7"/>
      ${weatherModifiedSun(vw * .78, vh * .12, 46, wx.condition)}
      ${birds(vw, vh)}
      ${horizonShimmer(vw, vh, 'rgba(135,206,250,.18)')}
      ${weatherOverlay(vw, vh, wx.condition, 'day')}
    `},
  },

  // ── 12:00 NN – 3:00 PM · Mid-day ──────────────────────────────
  { id: 'midday', from: 12, to: 15,
    darkBg:  ['#041020', '#071830', '#0a2040'],
    lightBg: ['#55b8f5', '#87ceeb', '#c8edff', '#fffde7'],
    buildSVG(vw, vh, wx) { return `
      <defs><radialGradient id="td-lng" cx="50%" cy="5%" r="75%">
        <stop offset="0%"   stop-color="#cceeff"/>
        <stop offset="100%" stop-color="#55b8f5"/>
      </radialGradient></defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-lng)" opacity=".75"/>
      ${weatherModifiedSun(vw * .5, vh * .08, 52, wx.condition)}
      ${heatHaze(vw, vh)}
      ${horizonShimmer(vw, vh, 'rgba(200,237,255,.2)')}
      ${weatherOverlay(vw, vh, wx.condition, 'day')}
    `},
  },

  // ── 3:00 PM – 5:00 PM · Afternoon ─────────────────────────────
  { id: 'afternoon', from: 15, to: 17,
    darkBg:  ['#06101e', '#0a1a30', '#0e2248'],
    lightBg: ['#4da8e8', '#78c8f8', '#b8e4ff', '#fff3d6'],
    buildSVG(vw, vh, wx) { return `
      <defs><radialGradient id="td-afg" cx="30%" cy="10%" r="75%">
        <stop offset="0%"   stop-color="#d4eeff"/>
        <stop offset="100%" stop-color="#4da8e8"/>
      </radialGradient></defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-afg)" opacity=".7"/>
      ${weatherModifiedSun(vw * .28, vh * .15, 44, wx.condition)}
      ${birds(vw, vh)}
      ${horizonShimmer(vw, vh, 'rgba(160,220,255,.15)')}
      ${weatherOverlay(vw, vh, wx.condition, 'day')}
    `},
  },

  // ── 5:00 PM – 6:00 PM · Sunset ────────────────────────────────
  { id: 'sunset', from: 17, to: 18,
    darkBg:  ['#0a0318', '#1c0828', '#3a1040'],
    lightBg: ['#12051e', '#6b1a3a', '#d44820', '#f5851a', '#ffd060'],
    buildSVG(vw, vh, wx) { return `
      <defs>
        <radialGradient id="td-ssg" cx="50%" cy="100%" r="88%">
          <stop offset="0%"   stop-color="#f5851a" stop-opacity=".98"/>
          <stop offset="22%"  stop-color="#d44820" stop-opacity=".82"/>
          <stop offset="48%"  stop-color="#8b1a3a" stop-opacity=".55"/>
          <stop offset="75%"  stop-color="#3a0850" stop-opacity=".3"/>
          <stop offset="100%" stop-color="#0a0318"  stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="td-ssh" cx="50%" cy="100%" r="42%">
          <stop offset="0%"  stop-color="#ffb020" stop-opacity=".9"/>
          <stop offset="100%" stop-color="#ff5500" stop-opacity="0"/>
        </radialGradient>
        <filter id="td-blur5ss"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-ssg)"/>
      <ellipse cx="${vw * .5}" cy="${vh}" rx="${vw * .52}" ry="${vh * .25}" fill="url(#td-ssh)" filter="url(#td-blur5ss)"/>
      ${sunSetting(vw * .5, vh * .84, 40, '#ffa020')}
      ${rays(vw * .5, vh * .84, 40, 20, 100, '#ff8800', .22)}
      ${silhouettes(vw, vh)}
      ${stars_svg(vw, vh * .4, 12, false)}
      ${weatherOverlay(vw, vh, wx.condition, 'dusk')}
    `},
  },

  // ── 6:00 PM – 8:00 PM · Night ─────────────────────────────────
  { id: 'night', from: 18, to: 20,
    darkBg:  ['#020408', '#04080f', '#060c18'],
    lightBg: ['#020408', '#06090f', '#0a1020', '#12182e'],
    buildSVG(vw, vh, wx) { return `
      <defs>
        <radialGradient id="td-ntg" cx="50%" cy="35%" r="55%">
          <stop offset="0%"  stop-color="#0e1e50" stop-opacity=".5"/>
          <stop offset="100%" stop-color="#020408" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-ntg)"/>
      ${moon(vw * .65, vh * .12, 30)}
      ${stars_svg(vw, vh, 55, true)}
      ${silhouettes(vw, vh)}
      ${weatherOverlay(vw, vh, wx.condition, 'night')}
    `},
  },

  // ── 8:00 PM – 12:00 AM · Evening ──────────────────────────────
  { id: 'evening', from: 20, to: 24,
    darkBg:  ['#010306', '#030610', '#070e1e'],
    lightBg: ['#010306', '#04080e', '#080e1e', '#0e1830'],
    buildSVG(vw, vh, wx) { return `
      <defs>
        <radialGradient id="td-evg2" cx="50%" cy="30%" r="58%">
          <stop offset="0%"  stop-color="#0c1a48" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#010306" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${vw}" height="${vh}" fill="url(#td-evg2)"/>
      ${moon(vw * .75, vh * .1, 28)}
      ${stars_svg(vw, vh, 80, true)}
      ${milkyWay(vw, vh)}
      ${silhouettes(vw, vh)}
      ${weatherOverlay(vw, vh, wx.condition, 'night')}
    `},
  },
]

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────

/** Returns the scene for the current Philippine local hour. */
export function getScene() {
  const phNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const h = phNow.getHours()
  return SCENES.find(s => h >= s.from && h < s.to) || SCENES[0]
}

/**
 * Returns the CSS background gradient string for a scene.
 * @param {object} scene  - one of the SCENES entries
 * @param {boolean} isDark
 */
export function applySceneBackground(scene, isDark) {
  const stops = isDark ? scene.darkBg : scene.lightBg
  const pct   = stops.map((_, i) => Math.round(i / (stops.length - 1) * 100) + '%')
  let bg = `linear-gradient(175deg,${stops.map((c, i) => `${c} ${pct[i]}`).join(',')})`
  if (isDark) bg = `radial-gradient(ellipse at 20% 70%,rgba(59,125,216,.15) 0%,transparent 55%),${bg}`
  return bg
}
