import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Track } from '../types'
import { searchAll, audiusTrending, deezerChart, deezerArtistPicture, isPlayableTrack, preferOriginals, prefetchFullTracks, subscribeFullTracks } from '../lib/musicApi'
import { useStore } from '../store/useStore'
import { MediaCard } from '../components/MediaCard'
import { Cover } from '../components/Cover'
import { IconChevron, IconPlay, IconSparkles } from '../components/Icons'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

const ROWS = [
  { title: 'Хиты прямо сейчас', query: 'top hits 2024' },
  { title: 'Для фокуса и работы', query: 'lofi study beats' },
  { title: 'Энергия и клуб', query: 'techno dance' },
  { title: 'Спокойствие', query: 'ambient relaxing' },
  { title: 'Рок', query: 'rock classics' },
]

function CardSkeleton() {
  return (
    <div className="animate-pulse-soft rounded-lg bg-ink-10 p-3">
      <div className="aspect-square w-full rounded-md bg-ink-20" />
      <div className="mt-3 h-3 w-3/4 rounded bg-ink-20" />
      <div className="mt-2 h-2 w-1/2 rounded bg-ink-15" />
    </div>
  )
}

function Row({ title, tracks, to }: { title: string; tracks: Track[]; to?: string }) {
  if (!tracks.length) return null
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-xl font-bold tracking-tight text-ink-100">{title}</h2>
        {to && (
          <Link to={to} className="flex items-center gap-1 text-xs font-medium uppercase tracking-widest text-ink-60 hover:text-ink-100">
            Все <IconChevron width={14} height={14} />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tracks.slice(0, 6).map((t) => (
          <MediaCard
            key={t.id}
            to={`/artist/${encodeURIComponent(t.artist)}`}
            seed={t.id}
            artwork={t.artwork}
            tone={t.valence}
            title={t.title}
            subtitle={`${t.artist} · ${t.preview ? 'превью' : 'полный трек'}`}
            context={tracks}
          />
        ))}
      </div>
    </section>
  )
}

export function Home() {
  const recentlyPlayed = useStore((s) => s.recentlyPlayed)
  const playlists = useStore((s) => s.playlists)
  const playContext = useStore((s) => s.playContext)
  const register = useStore((s) => s.register)

  const [charts, setCharts] = useState<Track[]>([])
  const [trending, setTrending] = useState<Track[]>([])
  const [rows, setRows] = useState<{ title: string; tracks: Track[] }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [chart, trend, ...rest] = await Promise.all([
        deezerChart(24),
        audiusTrending(24),
        ...ROWS.map((r) => searchAll(r.query, 16)),
      ])
      if (cancelled) return
      const clean = (list: Track[]) => preferOriginals(list.filter(isPlayableTrack))
      const charts = clean(chart).slice(0, 18)
      const trending = clean(trend).slice(0, 18)
      const built = ROWS.map((r, i) => ({ title: r.title, tracks: clean(rest[i] ?? []).slice(0, 6) })).filter((r) => r.tracks.length)
      setCharts(charts)
      setTrending(trending)
      setRows(built)
      const shown = [...charts, ...trending, ...built.flatMap((r) => r.tracks)]
      register(shown)
      setLoading(false)
      // Resolve full versions in the background so pressing play starts the
      // real song, not a 30-second cut.
      void prefetchFullTracks(shown)
    })()
    return () => {
      cancelled = true
    }
  }, [register])

  // Keep the rows in sync as full versions arrive.
  useEffect(() => {
    return subscribeFullTracks((full) => {
      const swap = (list: Track[]) => list.map((t) => (t.id === full.id ? full : t))
      setCharts(swap)
      setRows((cur) => cur.map((r) => ({ ...r, tracks: swap(r.tracks) })))
    })
  }, [])

  const quickPicks = playlists.slice(0, 6)
  const allTracks = useMemo(() => [...charts, ...trending, ...rows.flatMap((r) => r.tracks)], [charts, trending, rows])
  const artists = useMemo(() => {
    const seen = new Map<string, { name: string; art: string | null }>()
    for (const t of allTracks) if (!seen.has(t.artist) && t.artwork) seen.set(t.artist, { name: t.artist, art: t.artwork })
    return Array.from(seen.values()).slice(0, 6)
  }, [allTracks])

  // artist cards look better with a portrait than an album cover
  const [portraits, setPortraits] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        artists.map(async (a) => [a.name, await deezerArtistPicture(a.name).catch(() => null)] as const),
      )
      if (cancelled) return
      setPortraits(Object.fromEntries(entries.filter(([, pic]) => pic) as [string, string][]))
    })()
    return () => {
      cancelled = true
    }
  }, [artists])

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <h1 className="text-3xl font-black tracking-tight text-ink-100">{greeting()}</h1>
        <button
          className="flex items-center gap-2 rounded-full bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-0 transition-transform hover:scale-[1.02] disabled:opacity-40"
          onClick={() => playContext(allTracks, 0)}
          disabled={!allTracks.length}
        >
          <IconPlay width={16} height={16} /> Играть всё
        </button>
      </div>

      {quickPicks.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickPicks.map((p) => (
            <Link
              key={p.id}
              to={`/playlist/${p.id}`}
              className="group flex items-center gap-3 overflow-hidden rounded-md bg-ink-15 pr-4 transition-colors hover:bg-ink-25"
            >
              <span className="h-16 w-16 shrink-0">
                <Cover seed={p.id + p.name} artwork={null} tone={40} className="h-full w-full" rounded="rounded-none" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-95">{p.name}</span>
              <button
                className="grid h-10 w-10 shrink-0 translate-y-2 place-items-center rounded-full bg-ink-100 text-ink-0 opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault()
                  playContext(p.tracks, 0)
                }}
                aria-label="Играть"
              >
                <IconPlay width={16} height={16} />
              </button>
            </Link>
          ))}
        </div>
      )}

      <Link
        to="/generate"
        className="group relative mt-8 flex flex-col justify-between overflow-hidden rounded-xl border border-ink-25 bg-ink-10 p-6 sm:flex-row sm:items-center"
      >
        <div className="relative z-10 max-w-xl">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
            <IconSparkles width={15} height={15} /> генератор по настроению
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-ink-100 sm:text-3xl">
            Опишите настроение — получите плейлист из реальных треков
          </h2>
          <p className="mt-2 text-sm text-ink-60">
            «мрачный техно для ночной поездки», «тёплый ло-фай для учёбы», «спокойный эмбиент для медитации».
            Движок разберёт запрос и подберёт музыку под ваше состояние.
          </p>
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-0">
            Создать плейлист <IconChevron width={15} height={15} />
          </span>
        </div>
        <div className="pointer-events-none absolute -right-10 top-0 hidden h-full w-1/2 items-center opacity-[0.12] transition-opacity group-hover:opacity-20 sm:flex">
          <div className="h-56 w-56 animate-spin-slow">
            <Cover seed="mood-banner" artwork={null} tone={80} rounded="rounded-full" className="h-full w-full" />
          </div>
        </div>
      </Link>

      {recentlyPlayed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-bold tracking-tight text-ink-100">Недавно слушали</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {recentlyPlayed.slice(0, 6).map((t) => (
              <MediaCard
                key={t.id}
                to={`/artist/${encodeURIComponent(t.artist)}`}
                seed={t.id}
                artwork={t.artwork}
                tone={t.valence}
                title={t.title}
                subtitle={t.artist}
                context={recentlyPlayed}
              />
            ))}
          </div>
        </section>
      )}

      {loading && (
        <section className="mt-8">
          <div className="mb-3 h-6 w-48 rounded bg-ink-15" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {charts.length > 0 && <Row title="Мировые чарты" tracks={charts} to="/library" />}
      {trending.length > 0 && <Row title="Полные треки · Audius" tracks={trending} to="/library" />}
      {rows.map((r) => (
        <Row key={r.title} title={r.title} tracks={r.tracks} to={`/search?q=${encodeURIComponent(r.title)}`} />
      ))}

      {artists.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-bold tracking-tight text-ink-100">Артисты</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {artists.map((a) => (
              <MediaCard key={a.name} to={`/artist/${encodeURIComponent(a.name)}`} seed={a.name} artwork={portraits[a.name] ?? a.art} tone={55} title={a.name} subtitle="артист" circle />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
