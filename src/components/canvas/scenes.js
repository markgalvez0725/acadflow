// ─────────────────────────────────────────────────────────────────
// scenes.js  — Modern atmospheric scene engine v2 (Philippines / PH time)
// Visual direction: gradient-mesh blobs · cinematic glow · bokeh depth
// Pure JS module — no React imports.
// buildSVG(vw, vh, wxObj) receives wxObj from component state.
// ─────────────────────────────────────────────────────────────────

// Open-Meteo endpoint — Manila coords, PH timezone
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
  if (code === 0)                  return 'clear'
  if (code <= 2)                   return 'partly_cloudy'
  if (code === 3)                  return 'cloudy'
  if (code >= 45 && code <= 48)   return 'fog'
  if (code >= 51 && code <= 67)   return 'rain'
  if (code >= 71 && code <= 77)   return 'rain'
  if (code >= 80 && code <= 82)   return 'rain'
  if (code >= 85 && code <= 86)   return 'rain'
  if (code >= 95 && code <= 99)   return 'thunderstorm'
  if (windKph > 40)                return 'windy'
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
// SHARED SVG FILTER DEFS
// ─────────────────────────────────────────────────────────────────

function defs() {
  return `<defs>
    <filter id="f-xs"  x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="f-sm"  x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="f-md"  x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="32"/></filter>
    <filter id="f-lg"  x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="60"/></filter>
    <filter id="f-xl"  x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="95"/></filter>
    <filter id="f-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="f-glow-md" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="18" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="f-rain" x="-5%" y="-5%" width="110%" height="115%">
      <feGaussianBlur stdDeviation="0.4 2.5"/>
    </filter>
    <filter id="f-bolt" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`
}

// ─────────────────────────────────────────────────────────────────
// DESIGN PRIMITIVES
// ─────────────────────────────────────────────────────────────────

function blob(cx, cy, rx, ry, fill, op, filter) {
  const f = filter || 'f-lg'
  return `<ellipse cx="${Math.round(cx)}" cy="${Math.round(cy)}" rx="${Math.round(rx)}" ry="${Math.round(ry)}" fill="${fill}" opacity="${op.toFixed(2)}" filter="url(#${f})"/>`
}

function stars(vw, vh, count, dense, seed) {
  const s = seed || 0
  const total = dense ? count * 2 : count
  let out = ''
  for (let i = 0; i < total; i++) {
    const x   = ((i * 127 + s * 3 + 11) % vw).toFixed(1)
    const y   = ((i * 83  + s * 5 + 7 ) % (vh * 0.72)).toFixed(1)
    const r   = (0.35 + ((i * 31) % 12) * 0.12).toFixed(1)
    const dur = (3 + ((i * 17) % 10)).toFixed(1)
    const del = ((i * 0.45) % 7.5).toFixed(1)
    const bright = i % 8 === 0
    const col = i % 9 === 0 ? '#FFE9A0' : (i % 5 === 0 ? '#B8D4FF' : '#FFFFFF')
    const pk  = bright ? '0.95' : '0.82'
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="0.05">
      <animate attributeName="opacity" values="0.05;${pk};0.05" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      ${bright ? `<animate attributeName="r" values="${r};${(+r + 0.5).toFixed(1)};${r}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>` : ''}
    </circle>`
  }
  return out
}

function moon(cx, cy, r) {
  const gid = `td-mn-${Math.round(cx)}`
  return `<defs>
    <radialGradient id="${gid}" cx="38%" cy="33%" r="58%">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="62%"  stop-color="#D4E6FF"/>
      <stop offset="100%" stop-color="rgba(155,185,235,0.80)"/>
    </radialGradient>
  </defs>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*3.4)}" fill="rgba(150,185,255,0.06)" filter="url(#f-xl)"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*1.7)}" fill="rgba(175,205,255,0.10)" filter="url(#f-md)"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*1.14)}" fill="rgba(200,220,255,0.07)" stroke="rgba(200,225,255,0.12)" stroke-width="1"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r)}" fill="url(#${gid})" filter="url(#f-glow-sm)">
    <animate attributeName="opacity" values="0.88;0.97;0.88" dur="9s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${(cx-r*0.26).toFixed(1)}" cy="${(cy-r*0.20).toFixed(1)}" r="${(r*0.09).toFixed(1)}" fill="rgba(210,225,250,0.32)"/>
  <circle cx="${(cx+r*0.33).toFixed(1)}" cy="${(cy+r*0.27).toFixed(1)}" r="${(r*0.06).toFixed(1)}" fill="rgba(210,225,250,0.22)"/>`
}

function sun(cx, cy, r, coreCol, coronaCol) {
  const gid = `td-sn-${Math.round(cx)}`
  return `<defs>
    <radialGradient id="${gid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="30%"  stop-color="${coreCol}"/>
      <stop offset="75%"  stop-color="${coreCol}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${coreCol}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*4.8)}" fill="${coronaCol}" filter="url(#f-xl)" opacity="0.38"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*2.4)}" fill="${coronaCol}" filter="url(#f-lg)" opacity="0.52"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*1.35)}" fill="${coronaCol}" filter="url(#f-md)" opacity="0.60"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r)}" fill="url(#${gid})" filter="url(#f-glow-md)">
    <animate attributeName="r" values="${r};${r*1.04};${r}" dur="5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.90;1;0.90" dur="5s" repeatCount="indefinite"/>
  </circle>`
}

function sunRays(cx, cy, sr, col, count, len) {
  const n = count || 14
  const l = len || 60
  let out = `<g opacity="0.16" style="transform-origin:${Math.round(cx)}px ${Math.round(cy)}px;animation:td-ray-spin 58s linear infinite">`
  for (let i = 0; i < n; i++) {
    const a  = (i / n) * Math.PI * 2
    const r1 = sr * 1.38, r2 = sr * 1.38 + l
    out += `<line x1="${(cx+Math.cos(a)*r1).toFixed(1)}" y1="${(cy+Math.sin(a)*r1).toFixed(1)}"
                  x2="${(cx+Math.cos(a)*r2).toFixed(1)}" y2="${(cy+Math.sin(a)*r2).toFixed(1)}"
                  stroke="${col}" stroke-width="${i%2===0?2:1.2}" stroke-linecap="round"/>`
  }
  return out + '</g>'
}

function sunRising(cx, cy, r, coreCol, coronaCol) {
  const gid = `td-sr-${Math.round(cx)}`
  return `<defs>
    <clipPath id="td-sr-clip">
      <rect x="${Math.round(cx-r*3.5)}" y="${Math.round(cy-r)}" width="${Math.round(r*7)}" height="${Math.round(r*2)}"/>
    </clipPath>
    <radialGradient id="${gid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="38%"  stop-color="${coreCol}"/>
      <stop offset="100%" stop-color="${coreCol}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*4.2)}" fill="${coronaCol}" filter="url(#f-xl)" opacity="0.42" clip-path="url(#td-sr-clip)"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r*2.4)}" fill="${coronaCol}" filter="url(#f-lg)" opacity="0.58" clip-path="url(#td-sr-clip)"/>
  <circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(r)}" fill="url(#${gid})" filter="url(#f-glow-md)" clip-path="url(#td-sr-clip)">
    <animate attributeName="r" values="${r};${r*1.05};${r}" dur="5s" repeatCount="indefinite"/>
  </circle>`
}

function milkyWay(vw, vh) {
  return `<defs>
    <linearGradient id="td-mw" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="rgba(90,110,195,0)"/>
      <stop offset="35%"  stop-color="rgba(130,148,215,0.11)"/>
      <stop offset="50%"  stop-color="rgba(160,178,238,0.08)"/>
      <stop offset="65%"  stop-color="rgba(130,148,215,0.11)"/>
      <stop offset="100%" stop-color="rgba(90,110,195,0)"/>
    </linearGradient>
  </defs>
  <ellipse cx="${Math.round(vw*0.50)}" cy="${Math.round(vh*0.40)}" rx="${Math.round(vw*0.18)}" ry="${Math.round(vh*0.88)}"
           fill="url(#td-mw)" transform="rotate(-38,${Math.round(vw*0.50)},${Math.round(vh*0.40)})" filter="url(#f-sm)"/>`
}

function city(vw, vh) {
  const base = vh * 0.80
  let out = `<g fill="#040810">`
  const bldgs = [
    [0.04,60,44],[0.12,48,32],[0.20,76,30],[0.28,44,26],[0.36,66,36],
    [0.44,38,24],[0.52,72,40],[0.60,50,28],[0.68,68,34],[0.76,44,26],
    [0.83,56,32],[0.90,34,22],[0.96,46,28],
  ]
  bldgs.forEach(([xr, h, w]) => {
    const x = vw * xr - w / 2, y = base - h
    out += `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${w}" height="${Math.round(h + vh * 0.25)}"/>`
    if (h > 50) {
      for (let wy = y + 8; wy < base - 10; wy += 12) {
        for (let wx2 = x + 5; wx2 < x + w - 5; wx2 += 10) {
          if ((Math.sin(wx2 * 0.41 + wy * 0.73) * 1000 % 1 + 1) % 1 > 0.48)
            out += `<rect x="${Math.round(wx2)}" y="${Math.round(wy)}" width="4" height="5" fill="rgba(255,235,160,0.58)"/>`
        }
      }
    }
  })
  return out + '</g>'
}

function clouds(vw, vh, fill, count, opacity) {
  const op = opacity !== undefined ? opacity : 0.88
  if (!count) return ''
  const pos = [
    [0.18, 0.10, 160, 40], [0.46, 0.07, 130, 33],
    [0.74, 0.12, 108, 30], [0.08, 0.20, 98, 27], [0.84, 0.16, 118, 36],
  ].slice(0, count)
  const anims = ['td-cl1','td-cl2','td-cl1','td-cl2','td-cl1']
  let out = ''
  pos.forEach(([cx, cy, rx, ry], i) => {
    const x = Math.round(vw*cx), y = Math.round(vh*cy)
    out += `<g style="animation:${anims[i]} ${20+i*5}s ease-in-out infinite" filter="url(#f-xs)" opacity="${op}">
      <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>
      <ellipse cx="${Math.round(vw*cx+rx*0.5)}" cy="${Math.round(vh*cy-ry*0.3)}" rx="${Math.round(rx*0.58)}" ry="${Math.round(ry*0.74)}" fill="${fill}"/>
      <ellipse cx="${Math.round(vw*cx-rx*0.38)}" cy="${Math.round(vh*cy-ry*0.1)}" rx="${Math.round(rx*0.45)}" ry="${Math.round(ry*0.64)}" fill="${fill}"/>
    </g>`
  })
  return out
}

function rain(vw, vh, heavy) {
  const count = heavy ? 90 : 48
  const len   = heavy ? 22 : 14
  const col   = heavy ? 'rgba(140,196,242,0.66)' : 'rgba(162,212,246,0.50)'
  const dur   = heavy ? '0.48s' : '0.72s'
  let out = `<g filter="url(#f-rain)" opacity="${heavy ? 0.88 : 0.72}">`
  for (let i = 0; i < count; i++) {
    const x   = Math.round((i * 113 + 7) % vw)
    const y   = Math.round((i * 67  + 11) % vh)
    const del = ((i * 0.05) % 1).toFixed(2)
    out += `<line x1="${x}" y1="${y}" x2="${x+4}" y2="${y+len}"
      stroke="${col}" stroke-width="1.2" stroke-linecap="round">
      <animate attributeName="y1" values="${y};${vh+len}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="y2" values="${y+len};${vh+len*2}" dur="${dur}" begin="${del}s" repeatCount="indefinite"/>
    </line>`
  }
  return out + '</g>'
}

function lightning(vw, vh) {
  const cx = vw * 0.50, cy = vh * 0.10
  return `<g>
    <polyline points="${Math.round(cx)},${Math.round(cy)} ${Math.round(cx-22)},${Math.round(cy+46)} ${Math.round(cx+8)},${Math.round(cy+46)} ${Math.round(cx-18)},${Math.round(cy+94)}"
      fill="none" stroke="rgba(215,238,255,0.96)" stroke-width="3" stroke-linejoin="round" filter="url(#f-bolt)">
      <animate attributeName="opacity" values="0;0;0;1;0.4;1;0;0;0" dur="3.5s" begin="0.5s" repeatCount="indefinite"/>
    </polyline>
    <polyline points="${Math.round(cx+200)},${Math.round(cy+30)} ${Math.round(cx+180)},${Math.round(cy+68)} ${Math.round(cx+206)},${Math.round(cy+68)} ${Math.round(cx+182)},${Math.round(cy+110)}"
      fill="none" stroke="rgba(190,225,255,0.86)" stroke-width="2.5" stroke-linejoin="round" filter="url(#f-bolt)">
      <animate attributeName="opacity" values="0;0;1;0;0;0;0;0.5;0" dur="4.2s" begin="1.9s" repeatCount="indefinite"/>
    </polyline>
    <rect width="${vw}" height="${vh}" fill="rgba(150,180,255,0.05)">
      <animate attributeName="opacity" values="0;0;0;0.14;0;0;0.06;0" dur="3.5s" begin="0.5s" repeatCount="indefinite"/>
    </rect>
  </g>`
}

function fog(vw, vh) {
  let out = '<g>'
  const ys = [0.42, 0.54, 0.66, 0.76, 0.86]
  ys.forEach((yr, i) => {
    const y = Math.round(vh * yr)
    const dur = 14 + i * 5
    out += `<rect x="-${vw}" y="${y-15}" width="${vw*3}" height="34"
      fill="rgba(215,226,236,0.14)" rx="17">
      <animate attributeName="x" values="-${vw};0;-${vw}" dur="${dur}s" begin="${(i*2.5).toFixed(1)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.06;0.17;0.06" dur="${Math.round(dur/2)}s" repeatCount="indefinite"/>
    </rect>`
  })
  return out + '</g>'
}

function wind(vw, vh) {
  let out = '<g opacity="0.22">'
  const ys = [0.15, 0.28, 0.42, 0.56, 0.70]
  ys.forEach((yr, i) => {
    const y = Math.round(vh * yr)
    const len = 110 + i * 35, x0 = Math.round((i * 175) % vw)
    const dur = (2.5 + i * 0.35).toFixed(1)
    out += `<line x1="${x0}" y1="${y}" x2="${x0+len}" y2="${y}"
      stroke="rgba(220,232,255,0.75)" stroke-width="${(1.5-i*0.15).toFixed(2)}" stroke-linecap="round">
      <animate attributeName="x1" values="${x0};${vw+len}" dur="${dur}s" begin="${(i*0.38).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="x2" values="${x0+len};${vw+len*2}" dur="${dur}s" begin="${(i*0.38).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.75;0.75;0" dur="${dur}s" begin="${(i*0.38).toFixed(2)}s" repeatCount="indefinite"/>
    </line>`
  })
  return out + '</g>'
}

function birds(vw, vh) {
  const y = Math.round(vh * 0.22)
  return `<g opacity="0.36" style="animation:td-birds 54s linear infinite">
    <path d="M-80 ${y} Q-76 ${y-5} -72 ${y}" stroke="#4E7A9C" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M-62 ${y-8} Q-58 ${y-13} -54 ${y-8}" stroke="#4E7A9C" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M-96 ${y+8} Q-92 ${y+3} -88 ${y+8}" stroke="#4E7A9C" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M-46 ${y-2} Q-42 ${y-7} -38 ${y-2}" stroke="#4E7A9C" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>`
}

function cloudCount(cond) {
  const map = { clear:0, partly_cloudy:2, cloudy:5, fog:4, rain:4, heavy_rain:5, thunderstorm:5, windy:3 }
  return map[cond] !== undefined ? map[cond] : 0
}

function weatherOverlay(vw, vh, cond) {
  const c = cond || 'clear'
  let out = ''
  if (c === 'fog') out += fog(vw, vh)
  const dark = ['thunderstorm','heavy_rain','rain'].includes(c)
  out += clouds(vw, vh, dark ? 'rgba(52,57,76,0.84)' : 'rgba(255,255,255,0.88)', cloudCount(c))
  if (c === 'rain')         out += rain(vw, vh, false)
  if (c === 'heavy_rain')   out += rain(vw, vh, true)
  if (c === 'thunderstorm') { out += rain(vw, vh, true); out += lightning(vw, vh) }
  if (c === 'windy')        out += wind(vw, vh)
  if (c === 'thunderstorm') out += `<rect width="${vw}" height="${vh}" fill="rgba(28,36,88,0.30)"/>`
  return out
}

// ─────────────────────────────────────────────────────────────────
// SCENES ARRAY — 9 entries, Philippine Standard Time
// ─────────────────────────────────────────────────────────────────

export const SCENES = [

  // ── 12:00 AM – 4:00 AM · MIDNIGHT ─────────────────────────────
  {
    id: 'midnight', from: 0, to: 4, isLightScene: false,
    darkBg:  ['#000008','#020514','#040A26'],
    lightBg: ['#000008','#020514','#040A26'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.50, vh*.28, 400, 260, '#1A2C82', 0.55)}
      ${blob(vw*.20, vh*.55, 290, 210, '#0D1868', 0.46)}
      ${blob(vw*.80, vh*.22, 260, 190, '#2C1A72', 0.42)}
      ${blob(vw*.62, vh*.72, 310, 215, '#09113E', 0.36)}
      ${blob(vw*.14, vh*.14, 210, 165, '#1E1268', 0.32)}
      ${milkyWay(vw, vh)}
      ${stars(vw, vh, 80, true, 3)}
      ${moon(vw*.72, vh*.14, 34)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 4:00 AM – 6:00 AM · PRE-DAWN ──────────────────────────────
  {
    id: 'rooster', from: 4, to: 6, isLightScene: false,
    darkBg:  ['#020008','#0A021C','#1E0436'],
    lightBg: ['#06020E','#140632','#3C0E52','#720A2A','#AA1A2C'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.50, vh*1.12, 520, 285, '#8C0A2C', 0.68)}
      ${blob(vw*.50, vh*.92,  410, 205, '#C61832', 0.54)}
      ${blob(vw*.28, vh*.40,  330, 250, '#3C0862', 0.46)}
      ${blob(vw*.72, vh*.28,  285, 205, '#200848', 0.40)}
      ${blob(vw*.50, vh*.62,  370, 228, '#621018', 0.30)}
      ${stars(vw, vh, 48, false, 7)}
      ${moon(vw*.18, vh*.10, 22)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 6:00 AM – 8:00 AM · SUNRISE ───────────────────────────────
  {
    id: 'sunrise', from: 6, to: 8, isLightScene: false,
    darkBg:  ['#0C0422','#3C0842','#8C1C22'],
    lightBg: ['#0E0428','#6C1050','#D63C1C','#F07218','#FFC042'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.50, vh*1.06, 600, 305, '#FF8C00', 0.62)}
      ${blob(vw*.50, vh*.93,  440, 228, '#FFCC24', 0.54)}
      ${blob(vw*.50, vh*.72,  390, 205, '#E23C1E', 0.48)}
      ${blob(vw*.24, vh*.34,  310, 230, '#7C0C52', 0.42)}
      ${blob(vw*.76, vh*.28,  268, 195, '#3C0444', 0.36)}
      ${blob(vw*.12, vh*.62,  205, 162, '#5C1022', 0.28)}
      ${sunRising(vw*.50, vh*.96, 46, '#FFD860', '#FF9400')}
      ${sunRays(vw*.50, vh*.96, 46, '#FFD060', 18, 88)}
      ${stars(vw, vh*.40, 14, false, 11)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 8:00 AM – 12:00 NN · MORNING ──────────────────────────────
  {
    id: 'morning', from: 8, to: 12, isLightScene: true,
    darkBg:  ['#062244','#0A3C6E','#1062A4'],
    lightBg: ['#2490CA','#4AACDF','#84D2F6','#BAEAFF','#EAF8FF'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      const noSun = cond === 'thunderstorm' || cond === 'heavy_rain'
      return `${defs()}
      ${blob(vw*.72, vh*.06, 370, 240, '#FFFFFF',  0.20)}
      ${blob(vw*.18, vh*.22, 308, 208, '#B0E2FF',  0.22)}
      ${blob(vw*.55, vh*.48, 415, 268, '#72C8F8',  0.14)}
      ${blob(vw*.86, vh*.52, 285, 205, '#A2DEFF',  0.14)}
      ${noSun ? '' : sun(vw*.78, vh*.12, 46, '#FFE060', '#FFA020') + sunRays(vw*.78, vh*.12, 46, '#FFD040', 16, 54)}
      ${birds(vw, vh)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 12:00 NN – 3:00 PM · MIDDAY ───────────────────────────────
  {
    id: 'midday', from: 12, to: 15, isLightScene: true,
    darkBg:  ['#041A32','#082E54','#104882'],
    lightBg: ['#0E8CC2','#1CB0E2','#4ED0F8','#9AE8FF','#D4F6FF'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      const noSun = cond === 'thunderstorm' || cond === 'heavy_rain'
      return `${defs()}
      ${blob(vw*.50, vh*.00, 415, 250, '#FFFFFF',  0.22)}
      ${blob(vw*.24, vh*.26, 325, 228, '#B6EEFF',  0.18)}
      ${blob(vw*.80, vh*.32, 296, 205, '#7ADAFF',  0.16)}
      ${blob(vw*.50, vh*.62, 390, 268, '#42C8F4',  0.12)}
      ${noSun ? '' : sun(vw*.50, vh*.06, 52, '#FFF0A0', '#FFCC22') + sunRays(vw*.50, vh*.06, 52, '#FFE020', 20, 66)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 3:00 PM – 5:00 PM · AFTERNOON ─────────────────────────────
  {
    id: 'afternoon', from: 15, to: 17, isLightScene: true,
    darkBg:  ['#061A30','#0A2A4A','#124272'],
    lightBg: ['#1872BA','#329ADA','#7ACAF2','#C6EAFF','#FFF0CA'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      const noSun = cond === 'thunderstorm' || cond === 'heavy_rain'
      return `${defs()}
      ${blob(vw*.28, vh*.10, 358, 238, '#FFE292',  0.22)}
      ${blob(vw*.72, vh*.22, 308, 215, '#BAE2FF',  0.18)}
      ${blob(vw*.14, vh*.52, 286, 205, '#82CAF2',  0.16)}
      ${blob(vw*.82, vh*.58, 318, 225, '#FFD260',  0.14)}
      ${noSun ? '' : sun(vw*.28, vh*.14, 44, '#FFD050', '#FF9C10') + sunRays(vw*.28, vh*.14, 44, '#FFBC20', 14, 50)}
      ${birds(vw, vh)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 5:00 PM – 6:00 PM · SUNSET ────────────────────────────────
  {
    id: 'sunset', from: 17, to: 18, isLightScene: false,
    darkBg:  ['#060210','#1C0824','#4A0C1C'],
    lightBg: ['#08021A','#520A52','#BA2018','#E86212','#F8B222','#FFE042'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.50, vh*1.09, 620, 312, '#F09200', 0.72)}
      ${blob(vw*.50, vh*.93,  478, 248, '#FFCC22', 0.58)}
      ${blob(vw*.50, vh*.72,  435, 238, '#E23A1A', 0.52)}
      ${blob(vw*.18, vh*.36,  348, 248, '#820A52', 0.46)}
      ${blob(vw*.82, vh*.28,  308, 215, '#5C0832', 0.42)}
      ${blob(vw*.50, vh*.52,  508, 308, '#C42A1E', 0.28)}
      ${sunRising(vw*.50, vh*.96, 44, '#FFD860', '#FFA422')}
      ${sunRays(vw*.50, vh*.96, 44, '#FFC030', 22, 112)}
      ${city(vw, vh)}
      ${stars(vw, vh*.34, 10, false, 5)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 6:00 PM – 8:00 PM · NIGHT ─────────────────────────────────
  {
    id: 'night', from: 18, to: 20, isLightScene: false,
    darkBg:  ['#010308','#030812','#060E24'],
    lightBg: ['#010308','#030812','#060E24'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.56, vh*.18, 325, 225, '#1A2C70', 0.52)}
      ${blob(vw*.24, vh*.42, 285, 205, '#0E1C56', 0.44)}
      ${blob(vw*.80, vh*.52, 265, 185, '#1A2648', 0.40)}
      ${blob(vw*.40, vh*.68, 305, 205, '#0A1036', 0.34)}
      ${stars(vw, vh, 60, true, 1)}
      ${moon(vw*.65, vh*.13, 30)}
      ${city(vw, vh)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },

  // ── 8:00 PM – 12:00 AM · EVENING ──────────────────────────────
  {
    id: 'evening', from: 20, to: 24, isLightScene: false,
    darkBg:  ['#000004','#010408','#040A16'],
    lightBg: ['#000004','#010408','#040A16'],
    buildSVG(vw, vh, wxObj) {
      const cond = (wxObj && wxObj.condition) || 'clear'
      return `${defs()}
      ${blob(vw*.50, vh*.20, 368, 248, '#0C1C62', 0.50)}
      ${blob(vw*.20, vh*.52, 308, 228, '#060E42', 0.44)}
      ${blob(vw*.82, vh*.35, 285, 205, '#1C1262', 0.40)}
      ${blob(vw*.62, vh*.72, 328, 228, '#080840', 0.36)}
      ${milkyWay(vw, vh)}
      ${stars(vw, vh, 100, true, 9)}
      ${moon(vw*.75, vh*.11, 28)}
      ${city(vw, vh)}
      ${weatherOverlay(vw, vh, cond)}`
    },
  },
]

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────

export function getScene() {
  const phNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const h = phNow.getHours()
  return SCENES.find(s => h >= s.from && h < s.to) || SCENES[0]
}

export function applySceneBackground(scene, isDark) {
  const stops = isDark ? scene.darkBg : scene.lightBg
  const pct   = stops.map(function(_, i) { return Math.round(i / (stops.length - 1) * 100) + '%' })
  let bg = `linear-gradient(168deg,${stops.map(function(c, i) { return `${c} ${pct[i]}` }).join(',')})`
  if (!scene.isLightScene) {
    bg = `radial-gradient(ellipse 65% 45% at 55% 5%, rgba(36,55,165,0.18) 0%, transparent 55%),${bg}`
  } else {
    bg = `radial-gradient(ellipse 80% 40% at 50% 0%, rgba(255,255,255,0.20) 0%, transparent 48%),${bg}`
  }
  return bg
}
