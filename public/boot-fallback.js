/* Safety net: if React never mounts (fatal boot error), don't trap the user
   behind the splash forever. The normal path (AppRouter's BootSplashHider)
   removes it far sooner. Lives in a same-origin file (not inline) so the strict
   Content-Security-Policy (script-src 'self') allows it, and stays independent
   of the main bundle so it still fires if that bundle fails to boot. */
setTimeout(function () {
  var b = document.getElementById('boot-splash')
  if (b) {
    b.classList.add('is-hiding')
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b) }, 500)
  }
}, 10000)
