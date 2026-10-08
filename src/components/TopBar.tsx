import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { IconBack, IconChevron, IconSearch } from './Icons'

export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [query, setQuery] = useState('')

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
      className={`sticky top-0 z-30 flex items-center gap-3 px-4 py-3 transition-colors duration-300 ${
        scrolled ? 'bg-ink-5/90 backdrop-blur-xl' : 'bg-transparent'
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
        <button className="icon-btn h-8 w-8 bg-ink-10" onClick={() => navigate(-1)} aria-label="Назад">
          <IconBack width={18} height={18} />
        </button>
        <button
          className="icon-btn h-8 w-8 bg-ink-10"
          onClick={() => navigate(1)}
          aria-label="Вперёд"
        >
          <IconChevron width={18} height={18} />
        </button>
      </div>

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

      <div className="ml-auto flex items-center gap-2">
        <button className="flex items-center gap-2 rounded-full border border-ink-30 py-1 pl-1 pr-3 hover:border-ink-100">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-100 text-[10px] font-black text-ink-0">
            M
          </span>
          <span className="hidden text-xs font-medium text-ink-90 sm:block">Слушатель</span>
        </button>
      </div>
    </header>
  )
}
