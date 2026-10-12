import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Track } from '../types'
import { searchAll, isPlayableTrack, preferOriginals, prefetchFullTracks, subscribeFullTracks } from '../lib/musicApi'
import { useStore } from '../store/useStore'
import { MediaCard } from '../components/MediaCard'
import { TrackRow, TrackListHeader, SourceBadge } from '../components/TrackRow'
import { Cover } from '../components/Cover'
import { deezerArtistPicture } from '../lib/musicApi'
import { IconSearch } from '../components/Icons'

const HOT = ['The Weeknd', 'Coldplay', 'lofi', 'techno', 'jazz', 'Billie Eilish', 'rock', 'ambient', 'rap', 'классика']

type Filter = 'all' | 'tracks' | 'artists' | 'albums'

export function Search() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [filter, setFilter] = useState<Filter>('all')
  const [results, setResults] = useState<Track[]>([])
  const [artists, setArtists] = useState<{ name: string; art: string | null; genres: string[] }[]>([])
  const [busy, setBusy] = useState(false)
  const register = useStore((s) => s.register)

  useEffect(() => {
    setQuery(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setArtists([])
      return
    }
    let cancelled = false
    setBusy(true)
    const timer = window.setTimeout(async () => {
      const tracks = preferOriginals((await searchAll(q, 40, true)).filter(isPlayableTrack))
      if (cancelled) return
      setResults(tracks)
      register(tracks)
      void prefetchFullTracks(tracks)

      // derive an artist list from result diversity, then swap in real
      // portrait photos from Deezer where available
      const seen = new Map<string, { name: string; art: string | null; genres: string[] }>()
      for (const t of tracks) {
        if (!seen.has(t.artist))
          seen.set(t.artist, { name: t.artist, art: t.artwork, genres: [t.genre].filter(Boolean) })
      }
      const base = Array.from(seen.values()).slice(0, 6)
      setArtists(base)
      setBusy(false)

      const withPhotos = await Promise.all(
        base.map(async (a) => {
          const pic = await deezerArtistPicture(a.name).catch(() => null)
          return { ...a, art: pic ?? a.art }
        }),
      )
      if (!cancelled) setArtists(withPhotos)
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, register])

  useEffect(() => {
    // Fold every resolved full version back into the visible list.
    return subscribeFullTracks((full) => {
      setResults((cur) => cur.map((t) => (t.id === full.id ? full : t)))
    })
  }, [])

  const albums = useMemo(() => {
    const map = new Map<string, { id: string; title: string; artist: string; art: string | null; tracks: Track[] }>()
    for (const t of results) {
      if (!t.album) continue
      const key = `${t.artist}|${t.album}`
      if (!map.has(key)) map.set(key, { id: t.id, title: t.album, artist: t.artist, art: t.artwork, tracks: [] })
      map.get(key)!.tracks.push(t)
    }
    return Array.from(map.values())
      .filter((a) => a.tracks.length >= 2)
      .slice(0, 6)
  }, [results])

  const submit = (q: string) => {
    setQuery(q)
    setParams(q ? { q } : {})
  }

  const hasResults = results.length > 0
  const show = (f: Filter) => filter === 'all' || filter === f

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="relative pt-2">
        <IconSearch width={20} height={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-60" />
        <input
          autoFocus
          value={query}
          onChange={(e) => submit(e.target.value)}
          placeholder="Артист, трек, альбом — поиск в реальных каталогах…"
          className="w-full rounded-full border border-ink-25 bg-ink-10 py-3 pl-12 pr-4 text-base text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
        />
        {busy && (
          <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-end gap-[3px]">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-3 w-[3px] origin-bottom animate-bar-${i + 1} rounded bg-ink-100`} />
            ))}
          </span>
        )}
      </div>

      <p className="mt-2 text-[11px] uppercase tracking-widest text-ink-50">
        Источники: Deezer · iTunes (превью 30с) · Audius (полные треки)
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(['all', 'tracks', 'artists', 'albums'] as Filter[]).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'chip-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Всё' : f === 'tracks' ? 'Треки' : f === 'artists' ? 'Артисты' : 'Альбомы'}
          </button>
        ))}
      </div>

      {!query.trim() && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold text-ink-100">Популярные запросы</h2>
          <div className="flex flex-wrap gap-2">
            {HOT.map((h) => (
              <button key={h} className="chip" onClick={() => submit(h)}>
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && !hasResults && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="animate-pulse-soft rounded-lg bg-ink-10 p-3">
              <div className="aspect-square w-full rounded-md bg-ink-20" />
              <div className="mt-3 h-3 w-3/4 rounded bg-ink-20" />
              <div className="mt-2 h-2 w-1/2 rounded bg-ink-15" />
            </div>
          ))}
        </div>
      )}

      {!busy && query.trim() && !hasResults && (
        <div className="mt-16 text-center">
          <div className="text-2xl font-black text-ink-100">Ничего не найдено</div>
          <p className="mt-2 text-sm text-ink-60">По запросу «{query}» совпадений нет. Попробуйте другое имя или жанр.</p>
        </div>
      )}

      {hasResults && (
        <>
          {show('artists') && artists.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Артисты</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {artists.map((a) => (
                  <MediaCard
                    key={a.name}
                    to={`/artist/${encodeURIComponent(a.name)}`}
                    seed={a.name}
                    artwork={a.art}
                    tone={55}
                    title={a.name}
                    subtitle={a.genres.join(' · ') || 'артист'}
                    circle
                  />
                ))}
              </div>
            </section>
          )}

          {show('albums') && albums.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Альбомы</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {albums.map((a) => (
                  <MediaCard
                    key={a.id}
                    to={`/album/${encodeURIComponent(a.artist)}::${encodeURIComponent(a.title)}`}
                    seed={a.id}
                    artwork={a.art}
                    tone={40}
                    title={a.title}
                    subtitle={`${a.artist} · ${a.tracks.length} треков`}
                    context={a.tracks}
                  />
                ))}
              </div>
            </section>
          )}

          {show('tracks') && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Треки</h2>
              <TrackListHeader />
              {results.map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} context={results} showCover />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
