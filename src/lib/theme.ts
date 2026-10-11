export type Theme = 'dark' | 'light'

const KEY = 'monochrome.theme'

/** Read the saved theme, or fall back to the OS preference. */
export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * Apply a theme to the document. The palette lives in CSS variables keyed off
 * this attribute, so nothing else has to be re-rendered when it flips.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(KEY, theme)
  // The browser paints the address bar / status bar with this on mobile.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000')
}
