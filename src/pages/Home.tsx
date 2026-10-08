import { Link } from 'react-router-dom'
import { ALBUMS, ARTISTS, TRACKS, tracksByIds } from '../data/library'
import { useStore } from '../store/useStore'
import { MediaCard } from '../components/MediaCard'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { Cover } from '../components/Cover'
import { IconChevron, IconPlay, IconSparkles } from '../components/Icons'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: { label: string; to: string }
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-xl font-bold tracking-tight text-ink-100">{title}</h2>
        {action && (
          <Link
            to={action.to}
            className="flex items-center gap-1 text-xs font-medium uppercase tracking-widest text-ink-60 hover:text-ink-100"
          >
            {action.label}
            <IconChevron width={14} height={14} />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

export function Home() {
  const recentlyPlayed = useStore((s) => s.recentlyPlayed)
  const playlists = useStore((s) => s.playlists)
  const playContext = useStore((s) => s.playContext)

  const recentTracks = tracksByIds(recentlyPlayed).slice(0, 12)
  const allIds = TRACKS.map((t) => t.id)
  const featured = [...TRACKS].sort((a, b) => b.energy - a.energy).slice(0, 10)
  const fresh = [...TRACKS].sort((a, b) => b.year - a.year).slice(0, 12)
  const featuredAlbum = ALBUMS[7] ?? ALBUMS[0]
  const topArtists = [...ARTISTS].sort((a, b) => b.monthly - a.monthly).slice(0, 6)
  const quickPicks = playlists.slice(0, 6)

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <h1 className="text-3xl font-black tracking-tight text-ink-100">{greeting()}</h1>
        <button
          className="flex items-center gap-2 rounded-full bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-0 transition-transform hover:scale-[1.02]"
          onClick={() => playContext(allIds, 0)}
        >
          <IconPlay width={16} height={16} /> Играть всё
        </button>
      </div>

      {/* quick grid */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {quickPicks.map((p) => (
          <Link
            key={p.id}
            to={`/playlist/${p.id}`}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-ink-15 pr-4 transition-colors hover:bg-ink-25"
          >
            <span className="h-16 w-16 shrink-0">
              <Cover seed={p.id + p.name} tone={40} className="h-full w-full" rounded="rounded-none" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-95">{p.name}</span>
            <button
              className="grid h-10 w-10 shrink-0 translate-y-2 place-items-center rounded-full bg-ink-100 text-ink-0 opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
              onClick={(e) => {
                e.preventDefault()
                playContext(p.trackIds, 0)
              }}
              aria-label="Играть"
            >
              <IconPlay width={16} height={16} />
            </button>
          </Link>
        ))}
      </div>

      {/* mood banner */}
      <Link
        to="/generate"
        className="group relative mt-8 flex flex-col justify-between overflow-hidden rounded-xl border border-ink-25 bg-ink-10 p-6 sm:flex-row sm:items-center"
      >
        <div className="relative z-10 max-w-xl">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
            <IconSparkles width={15} height={15} /> генератор по настроению
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-ink-100 sm:text-3xl">
            Опишите настроение словами — получите плейлист
          </h2>
          <p className="mt-2 text-sm text-ink-60">
            «мрачный техно для ночной поездки», «тёплый ло-фай для учёбы», «спокойный эмбиент для медитации».
            Движок разберёт запрос и соберёт треки под ваше состояние.
          </p>
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-0">
            Создать плейлист <IconChevron width={15} height={15} />
          </span>
        </div>
        <div className="pointer-events-none absolute -right-10 top-0 hidden h-full w-1/2 items-center opacity-[0.12] transition-opacity group-hover:opacity-20 sm:flex">
          <div className="h-56 w-56 animate-spin-slow">
            <Cover seed="mood-banner" tone={80} rounded="rounded-full" className="h-full w-full" />
          </div>
        </div>
      </Link>

      {recentTracks.length > 0 && (
        <Section title="Недавно слушали">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {recentTracks.map((t) => (
              <MediaCard
                key={t.id}
                to={`/album/${ALBUMS.find((a) => a.trackIds.includes(t.id))?.id ?? ''}`}
                seed={t.id}
                tone={t.valence}
                title={t.title}
                subtitle={t.artist}
                contextIds={recentTracks.map((r) => r.id)}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Высокая энергия" action={{ label: 'Все треки', to: '/library' }}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {featured.map((t) => (
            <MediaCard
              key={t.id}
              to={`/album/${ALBUMS.find((a) => a.trackIds.includes(t.id))?.id ?? ''}`}
              seed={t.id}
              tone={t.valence}
              title={t.title}
              subtitle={`${t.artist} · ${t.genre}`}
              contextIds={featured.map((f) => f.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Артисты" action={{ label: 'Все', to: '/library' }}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {topArtists.map((a) => {
            const ids = TRACKS.filter((t) => t.artist === a.name).map((t) => t.id)
            return (
              <MediaCard
                key={a.id}
                to={`/artist/${encodeURIComponent(a.name)}`}
                seed={a.name}
                tone={55}
                title={a.name}
                subtitle={a.genres.join(' · ')}
                contextIds={ids}
                circle
              />
            )
          })}
        </div>
      </Section>

      <Section title="Новинки">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {fresh.map((t) => (
            <MediaCard
              key={t.id}
              to={`/album/${ALBUMS.find((a) => a.trackIds.includes(t.id))?.id ?? ''}`}
              seed={t.id}
              tone={t.valence}
              title={t.title}
              subtitle={`${t.year} · ${t.genre}`}
              contextIds={fresh.map((f) => f.id)}
            />
          ))}
        </div>
      </Section>

      {featuredAlbum && (
        <Section title="Альбом дня">
          <div className="flex flex-col gap-5 rounded-xl bg-ink-10 p-4 sm:flex-row">
            <Link to={`/album/${featuredAlbum.id}`} className="w-full shrink-0 sm:w-56">
              <Cover
                seed={featuredAlbum.id}
                tone={50}
                rounded="rounded-lg"
                className="aspect-square w-full shadow-xl shadow-black/50"
              />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to={`/album/${featuredAlbum.id}`} className="text-2xl font-black tracking-tight text-ink-100 hover:underline">
                {featuredAlbum.title}
              </Link>
              <p className="mt-1 text-sm text-ink-60">
                {featuredAlbum.artist} · {featuredAlbum.year} · {featuredAlbum.trackIds.length} треков
              </p>
              <div className="mt-4 flex-1">
                <TrackListHeader />
                {tracksByIds(featuredAlbum.trackIds)
                  .slice(0, 5)
                  .map((t, i) => (
                    <TrackRow
                      key={t.id}
                      track={t}
                      index={i}
                      contextIds={featuredAlbum.trackIds}
                    />
                  ))}
              </div>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
