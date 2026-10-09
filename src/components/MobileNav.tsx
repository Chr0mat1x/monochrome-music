import { NavLink } from 'react-router-dom'
import { IconHeart, IconHome, IconLibrary, IconSearch, IconSparkles } from './Icons'

const tabs = [
  { to: '/', end: true, label: 'Главная', Icon: IconHome },
  { to: '/search', label: 'Поиск', Icon: IconSearch },
  { to: '/generate', label: 'Настроение', Icon: IconSparkles },
  { to: '/library', label: 'Медиатека', Icon: IconLibrary },
  { to: '/liked', label: 'Избранное', Icon: IconHeart },
]

/** Thumb-reachable bottom navigation, shown only on narrow screens. */
export function MobileNav() {
  return (
    <nav className="nav-safe z-40 grid shrink-0 grid-cols-5 border-t border-ink-25 bg-ink-5 px-1 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {tabs.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
              isActive ? 'text-ink-100' : 'text-ink-55'
            }`
          }
        >
          <Icon width={21} height={21} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
