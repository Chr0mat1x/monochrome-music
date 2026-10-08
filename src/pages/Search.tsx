import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ALBUMS, ARTISTS, TRACKS, ALL_GENRES } from '../data/library'
import { MediaCard } from '../components/MediaCard'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { Cover } from '../components/Cover'
import { IconSearch } from '../components/Icons'

type Filter = 'all' | 'tracks' | 'artists' | 'albums'

function normalise(s: string) {
  return s.toLowerCase().replace(/ё/g, 'ё')
}

export function Search() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    setQuery(params.get('q') ?? '')
  }, [params])

  const q = normalise(query.trim())

  const results = useMemo(() => {
    if (!q) return { tracks: [], artists: [], albums: [] }
    const tracks = TRACKS.filter(
      (t) =>
        normalise(t.title).includes(q) ||
        normalise(t.artist).includes(q) ||
        normalise(t.album).includes(q) ||
        normalise(t.genre).includes(q) ||
        t.mood.some((m) => normalise(m).includes(q)),
    )
    const artists = ARTISTS.filter((a) => normalise(a.name).includes(q) || a.genres.some((g) => normalise(g).includes(q)))
    const albums = ALBUMS.filter((a) => normalise(a.title).includes(q) || normalise(a.artist).includes(q))
    return { tracks, artists, albums }
  }, [q])

  const hasResults = results.tracks.length + results.artists.length + results.albums.length > 0
  const trackIds = results.tracks.map((t) => t.id)

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="relative pt-2">
        <IconSearch
          width={20}
          height={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-60"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setParams(e.target.value ? { q: e.target.value } : {})
          }}
          placeholder="Что послушаем?"
          className="w-full rounded-full border border-ink-25 bg-ink-10 py-3 pl-12 pr-4 text-base text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(['all', 'tracks', 'artists', 'albums'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'chip-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Всё' : f === 'tracks' ? 'Треки' : f === 'artists' ? 'Артисты' : 'Альбомы'}
          </button>
        ))}
      </div>

      {!q && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold text-ink-100">Обзор жанров</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ALL_GENRES.map((g) => (
              <button
                key={g}
                onClick={() => {
                  setQuery(g)
                  setParams({ q: g })
                }}
                className="group relative aspect-[16/9] overflow-hidden rounded-lg border border-ink-25 bg-ink-10 text-left transition-colors hover:border-ink-100"
              >
                <div className="absolute inset-0 opacity-25 transition-opacity group-hover:opacity-40">
                  <Cover seed={`genre-${g}`} tone={60} rounded="rounded-none" className="h-full w-full" />
                </div>
                <span className="absolute bottom-3 left-4 text-lg font-black tracking-tight text-ink-100">
                  {g}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {q && !hasResults && (
        <div className="mt-16 text-center">
          <div className="text-2xl font-black text-ink-100">Ничего не найдено</div>
          <p className="mt-2 text-sm text-ink-60">
            По запросу «{query}» совпадений нет. Попробуйте другое слово или жанр.
          </p>
        </div>
      )}

      {q && hasResults && (
        <>
          {(filter === 'all' || filter === 'artists') && results.artists.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Артисты</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {results.artists.slice(0, filter === 'all' ? 5 : 20).map((a) => {
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
            </section>
          )}

          {(filter === 'all' || filter === 'albums') && results.albums.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Альбомы</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {results.albums.slice(0, filter === 'all' ? 5 : 20).map((a) => (
                  <MediaCard
                    key={a.id}
                    to={`/album/${a.id}`}
                    seed={a.id}
                    tone={a.accent + 20}
                    title={a.title}
                    subtitle={`${a.artist} · ${a.year}`}
                    contextIds={a.trackIds}
                  />
                ))}
              </div>
            </section>
          )}

          {(filter === 'all' || filter === 'tracks') && results.tracks.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-ink-100">Треки</h2>
              <TrackListHeader />
              {results.tracks.slice(0, filter === 'all' ? 12 : 100).map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} contextIds={trackIds} showCover />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
