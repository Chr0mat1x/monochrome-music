import { useMemo, useState } from 'react'
import { ALBUMS, ALL_GENRES, ARTISTS, TRACKS } from '../data/library'
import { useStore } from '../store/useStore'
import { MediaCard } from '../components/MediaCard'
import { TrackRow, TrackListHeader } from '../components/TrackRow'

type Tab = 'tracks' | 'albums' | 'artists'

export function Library() {
  const [tab, setTab] = useState<Tab>('tracks')
  const [genre, setGenre] = useState<string | null>(null)
  const [sort, setSort] = useState<'default' | 'energy' | 'bpm' | 'year'>('default')
  const liked = useStore((s) => s.liked)
  const likedIds = useMemo(() => new Set(liked), [liked])

  const filteredTracks = useMemo(() => {
    let list = genre ? TRACKS.filter((t) => t.genre === genre) : [...TRACKS]
    if (sort === 'energy') list.sort((a, b) => b.energy - a.energy)
    else if (sort === 'bpm') list.sort((a, b) => b.bpm - a.bpm)
    else if (sort === 'year') list.sort((a, b) => b.year - a.year)
    return list
  }, [genre, sort])

  const trackIds = filteredTracks.map((t) => t.id)
  const filteredAlbums = genre ? ALBUMS.filter((a) => a.trackIds.some((id) => TRACKS.find((t) => t.id === id)?.genre === genre)) : ALBUMS
  const filteredArtists = genre
    ? ARTISTS.filter((a) => a.genres.includes(genre) || TRACKS.some((t) => t.artist === a.name && t.genre === genre))
    : ARTISTS

  return (
    <div className="px-4 pb-10 sm:px-6">
      <h1 className="pt-2 text-3xl font-black tracking-tight text-ink-100">Медиатека</h1>
      <p className="mt-1 text-sm text-ink-60">
        {TRACKS.length} треков · {ALBUMS.length} альбомов · {ARTISTS.length} артистов
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(['tracks', 'albums', 'artists'] as Tab[]).map((t) => (
          <button key={t} className={`chip ${tab === t ? 'chip-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'tracks' ? 'Треки' : t === 'albums' ? 'Альбомы' : 'Артисты'}
          </button>
        ))}

        <span className="ml-2 hidden h-4 w-px bg-ink-30 sm:block" />

        <button className={`chip ${genre === null ? 'chip-active' : ''}`} onClick={() => setGenre(null)}>
          Все жанры
        </button>
        {ALL_GENRES.map((g) => (
          <button key={g} className={`chip ${genre === g ? 'chip-active' : ''}`} onClick={() => setGenre(g)}>
            {g}
          </button>
        ))}
      </div>

      {tab === 'tracks' && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-60">
            Сортировка:
            {(
              [
                ['default', 'По умолчанию'],
                ['energy', 'По энергии'],
                ['bpm', 'По темпу'],
                ['year', 'По году'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`rounded px-2 py-1 transition-colors ${
                  sort === k ? 'bg-ink-100 text-ink-0' : 'hover:bg-ink-20'
                }`}
                onClick={() => setSort(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <TrackListHeader />
            {filteredTracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                contextIds={trackIds}
                showCover
                onRemove={likedIds.has(t.id) ? undefined : undefined}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'albums' && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filteredAlbums.map((a) => (
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
      )}

      {tab === 'artists' && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filteredArtists.map((a) => {
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
      )}
    </div>
  )
}
