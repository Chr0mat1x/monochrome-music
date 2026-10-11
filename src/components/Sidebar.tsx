import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { IconHeart, IconHome, IconLibrary, IconPlus, IconSearch, IconSparkles, IconWave } from './Icons'

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ${
    isActive ? 'bg-ink-20 text-ink-100' : 'text-ink-70 hover:text-ink-100'
  }`

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const playlists = useStore((s) => s.playlists)
  const liked = useStore((s) => s.liked)
  const createPlaylist = useStore((s) => s.createPlaylist)
  const navigate = useNavigate()

  return (
    <aside className="flex h-full w-full flex-col gap-2 p-2">
      <div className="glass rounded-2xl p-2">
        <Link to="/" onClick={onClose} className="flex items-center gap-2 px-3 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-ink-100">
            <span className="h-2 w-2 rounded-full bg-ink-100" />
          </span>
          <span className="text-[15px] font-black uppercase tracking-[0.28em] text-ink-100">Mono</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          <NavLink to="/" end className={navItem} onClick={onClose}>
            <IconHome width={19} height={19} /> Главная
          </NavLink>
          <NavLink to="/search" className={navItem} onClick={onClose}>
            <IconSearch width={19} height={19} /> Поиск
          </NavLink>
          <NavLink to="/wave" className={navItem} onClick={onClose}>
            <IconWave width={19} height={19} /> Моя волна
          </NavLink>
          <NavLink to="/generate" className={navItem} onClick={onClose}>
            <IconSparkles width={19} height={19} /> По настроению
          </NavLink>
          <NavLink to="/library" className={navItem} onClick={onClose}>
            <IconLibrary width={19} height={19} /> Медиатека
          </NavLink>
        </nav>
      </div>

      <div className="glass flex min-h-0 flex-1 flex-col rounded-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-ink-60">Плейлисты</span>
          <button
            className="icon-btn h-7 w-7"
            title="Создать плейлист"
            onClick={() => {
              const id = createPlaylist('Новый плейлист', 'Описание пока не задано', [])
              navigate(`/playlist/${id}`)
              onClose?.()
            }}
          >
            <IconPlus width={17} height={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <Link to="/liked" onClick={onClose} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-ink-20">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-gradient-to-br from-ink-100 to-ink-50">
              <IconHeart filled width={18} height={18} className="text-ink-0" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-95">Избранное</span>
              <span className="block text-xs text-ink-60">{liked.length} треков</span>
            </span>
          </Link>

          {playlists.map((p) => (
            <Link key={p.id} to={`/playlist/${p.id}`} onClick={onClose} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-ink-20">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded">
                <Cover seed={p.id + p.name} artwork={p.tracks.find((t) => t.artwork)?.artwork ?? null} tone={30} className="h-full w-full" rounded="rounded" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink-90">{p.name}</span>
                <span className="block text-xs text-ink-50">{p.owned ? 'Плейлист' : 'Подборка'} · {p.tracks.length}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  )
}
