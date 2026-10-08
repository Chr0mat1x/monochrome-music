/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: '#000000',
          5: '#0a0a0a',
          10: '#111111',
          15: '#161616',
          20: '#1c1c1c',
          25: '#242424',
          30: '#2e2e2e',
          40: '#3d3d3d',
          50: '#555555',
          60: '#7a7a7a',
          70: '#9e9e9e',
          80: '#c4c4c4',
          90: '#e4e4e4',
          95: '#f2f2f2',
          100: '#ffffff',
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
      },
    },
  },
  plugins: [],
}
