import { useEffect, useState } from 'react'
import { applyTheme, initialTheme, type Theme } from '../lib/theme'
import { IconMoon, IconSun } from './Icons'

/**
 * Dark/light switch. The theme lives on <html data-theme>, so a plain toggle
 * is enough — no store wiring needed.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      className={`icon-btn h-9 w-9 ${className}`}
      onClick={() => setTheme(next)}
      title={next === 'light' ? 'Дневная тема' : 'Ночная тема'}
      aria-label={next === 'light' ? 'Включить дневную тему' : 'Включить ночную тему'}
    >
      {theme === 'dark' ? <IconSun width={18} height={18} /> : <IconMoon width={18} height={18} />}
    </button>
  )
}
