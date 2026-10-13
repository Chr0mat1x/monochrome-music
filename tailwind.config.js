/** @type {import('tailwindcss').Config} */
// The palette is driven by CSS variables (see index.css) so the whole app can
// flip between the dark and light theme by switching one attribute on <html>.
// "ink" is therefore semantic, not literal: ink-0 is the page surface, ink-100
// is the foreground, whatever the theme calls those.
const ink = (v) => `rgb(var(--ink-${v}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: ink(0),
          5: ink(5),
          10: ink(10),
          15: ink(15),
          20: ink(20),
          25: ink(25),
          30: ink(30),
          40: ink(40),
          50: ink(50),
          55: ink(55),
          60: ink(60),
          70: ink(70),
          80: ink(80),
          90: ink(90),
          95: ink(95),
          100: ink(100),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.06em',
      },
      animation: {
        'bar-1': 'bar 900ms ease-in-out infinite',
        'bar-2': 'bar 700ms ease-in-out infinite 120ms',
        'bar-3': 'bar 1100ms ease-in-out infinite 240ms',
        'bar-4': 'bar 800ms ease-in-out infinite 360ms',
        'spin-slow': 'spin 8s linear infinite',
        'fade-up': 'fadeUp 400ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-soft': 'pulseSoft 3s ease-in-out infinite',
        'tab-left': 'tabLeft 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'tab-right': 'tabRight 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      keyframes: {
        bar: {
          '0%, 100%': { transform: 'scaleY(0.28)' },
          '50%': { transform: 'scaleY(1)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // The end state is `transform: none` on purpose: a lingering transform
        // would make this wrapper the containing block for the `position: fixed`
        // overlays (track menu, now-playing) rendered inside it.
        tabLeft: {
          '0%': { opacity: '0', transform: 'translateX(18px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        tabRight: {
          '0%': { opacity: '0', transform: 'translateX(-18px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '0.9' },
        },
      },
    },
  },
  plugins: [],
}
