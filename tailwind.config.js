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
        'route-in': 'routeIn 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop': 'pop 340ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'heart': 'heart 460ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'shimmer': 'shimmer 1.6s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'breathe': 'breathe 7s ease-in-out infinite',
        'slide-in-right': 'slideInRight 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-up-panel': 'slideUpPanel 360ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'glow-pulse': 'glowPulse 2.4s ease-in-out infinite',
        'spin-in': 'spinIn 600ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
        pulseSoft: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '0.9' },
        },
        routeIn: {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.995)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        pop: {
          '0%': { transform: 'scale(0.82)', opacity: '0' },
          '60%': { transform: 'scale(1.06)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        heart: {
          '0%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(1.35)' },
          '70%': { transform: 'scale(0.92)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.035)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(18px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideUpPanel: {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.25', transform: 'scale(0.98)' },
          '50%': { opacity: '0.6', transform: 'scale(1.04)' },
        },
        spinIn: {
          '0%': { opacity: '0', transform: 'rotate(-90deg) scale(0.6)' },
          '100%': { opacity: '1', transform: 'rotate(0) scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
