/* Apply the saved theme BEFORE first paint so the boot splash (and the app
   behind it) match from the very first frame: no light flash for dark/frost
   users. Loaded as a synchronous same-origin script in <head> (not inline) so
   the strict Content-Security-Policy (script-src 'self', no unsafe-inline)
   allows it while keeping the render-blocking, pre-paint timing. Mirrors the
   UIContext init logic (which re-runs harmlessly after hydration and stays
   the single owner of theme changes). */
try {
  var t = localStorage.getItem('acadflow_theme')
  if (['light', 'dark', 'frost'].indexOf(t) < 0) {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', t)
  var tc = { light: '#16264a', dark: '#0e1422', frost: '#130e22' }
  var m = document.querySelector('meta[name="theme-color"]')
  if (m) m.setAttribute('content', tc[t] || tc.light)
} catch (e) {}
