import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { IconBack, IconChevron, IconSearch, IconUser } from './Icons'
import { ThemeToggle } from './ThemeToggle'
import { useStore } from '../store/useStore'

export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [query, setQuery] = useState('')
  const user = useStore((s) => s.user)

  // The search page owns the query field, so the global one steps aside there
  // instead of showing a second, duplicate input above it.
  const showSearch = !pathname.startsWith('/search') && !pathname.startsWith('/auth')

  useEffect(() => {
    const scroller = document.getElementById('main-scroll')
    if (!scroller) return
    const onScroll = () => setScrolled(scroller.scrollTop > 8)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-30 flex items-center gap-3 px-4 py-3 glass-bar ${
        scrolled ? 'glass-bar-scrolled' : ''
      }`}
    >
      {onOpenNav && (
        <button className="icon-btn h-9 w-9 lg:hidden" onClick={onOpenNav} aria-label="Меню">
          <span className="flex flex-col gap-1">
            <span className="block h-0.5 w-5 bg-ink-80" />
            <span className="block h-0.5 w-5 bg-ink-80" />
            <span className="block h-0.5 w-5 bg-ink-80" />
          </span>
        </button>
      )}
      <div className="hidden items-center gap-2 md:flex">
        <button className="icon-btn h-8 w-8" onClick={() => navigate(-1)} aria-label="Назад">
          <IconBack width={18} height={18} />
        </button>
        <button className="icon-btn h-8 w-8" onClick={() => navigate(1)} aria-label="Вперёд">
          <IconChevron width={18} height={18} />
        </button>
      </div>

      {showSearch && (
        <form
          className="relative ml-auto w-full max-w-md md:ml-0"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/search?q=${encodeURIComponent(query)}`)
          }}
        >
          <IconSearch
            width={17}
            height={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-60"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Артист, трек, альбом…"
            className="w-full rounded-full border border-ink-25 bg-ink-10 py-2 pl-10 pr-4 text-sm text-ink-95 outline-none transition-colors placeholder:text-ink-50 focus:border-ink-100"
          />
        </form>
      )}

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <button
          className="flex items-center gap-2 rounded-full border border-ink-25 py-1 pl-1 pr-3 transition-colors hover:border-ink-100"
          onClick={() => navigate('/auth')}
          title={user ? user.name : 'Войти'}
        >
          {user ? (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-100 text-[10px] font-black text-ink-0">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full text-ink-80">
              <IconUser width={18} height={18} />
            </span>
          )}
          <span className="hidden max-w-[9rem] truncate text-xs font-medium text-ink-90 sm:block">
            {user ? user.name : 'Войти'}
          </span>
        </button>
      </div>
    </header>
  )
}
