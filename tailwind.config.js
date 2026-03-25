/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Theming is via CSS custom properties on [data-theme="dark"],
  // not Tailwind's dark: prefix — so disable built-in dark mode.
  darkMode: false,
  theme: {
    extend: {
      // All colors map to CSS custom properties so they adapt to
      // light/dark themes automatically via :root / [data-theme="dark"].
      colors: {
        navy:      'var(--c-navy)',
        royal:     'var(--c-royal)',
        'c-blue':  'var(--c-blue)',
        sky:       'var(--c-sky)',
        gold:      'var(--c-gold)',
        'gold-d':  'var(--c-gold-d)',

        bg:        'var(--bg)',
        bg2:       'var(--bg2)',
        surface:   'var(--surface)',
        surface2:  'var(--surface2)',
        ink:       'var(--ink)',
        ink2:      'var(--ink2)',
        ink3:      'var(--ink3)',
        accent:    'var(--accent)',
        'accent-l':'var(--accent-l)',
        'accent-m':'var(--accent-m)',
        border:    'var(--border)',
        border2:   'var(--border2)',
        red:       'var(--red)',
        'red-l':   'var(--red-l)',
        green:     'var(--green)',
        'green-l': 'var(--green-l)',
        yellow:    'var(--yellow)',
        'yellow-l':'var(--yellow-l)',
        purple:    'var(--purple)',
        'purple-l':'var(--purple-l)',
        'gold-var':'var(--gold-var)',
        'gold-l':  'var(--gold-l)',
      },
      fontFamily: {
        display: ["'Cormorant Garamond'", 'Georgia', 'serif'],
        body:    ["'DM Sans'", 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg:      'var(--radius-lg)',
      },
      boxShadow: {
        DEFAULT: 'var(--shadow)',
        lg:      'var(--shadow-lg)',
      },
      spacing: {
        sidebar: 'var(--sidebar-w)',
      },
    },
  },
  plugins: [],
}
