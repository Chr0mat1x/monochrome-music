import { useParams } from 'react-router-dom'
import { ARTIST_BY_NAME, artistAlbums, artistTracks, formatMonthly } from '../data/library'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { MediaCard } from '../components/MediaCard'
import { IconPlay, IconShuffle } from '../components/Icons'
import { NotFound } from './NotFound'

export function ArtistPage() {
  const { name } = useParams()
  const artist = name ? ARTIST_BY_NAME.get(decodeURIComponent(name)) : undefined
  const playContext = useStore((s) => s.playContext)
  const shuffle = useStore((s) => s.shuffle)
  const toggleShuffle = useStore((s) => s.toggleShuffle)

  if (!artist) return <NotFound />

  const tracks = [...artistTracks(artist.name)].sort((a, b) => b.energy - a.energy)
  const albums = artistAlbums(artist.name)
  const ids = tracks.map((t) => t.id)

  const playShuffled = () => {
    if (!shuffle) toggleShuffle()
    playContext(ids, Math.floor(Math.random() * ids.length))
  }

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-8 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-25">
          <Cover seed={artist.name} tone={70} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-40 shrink-0 sm:w-52">
          <Cover
            seed={artist.name}
            tone={60}
            rounded="rounded-full"
            className="aspect-square w-full shadow-2xl shadow-black/60"
          />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">Артист</span>
          <h1 className="mt-2 text-4xl font-black leading-none tracking-tight text-ink-100 sm:text-6xl">
            {artist.name}
          </h1>
          <p className="mt-4 text-sm text-ink-80">
            {formatMonthly(artist.monthly)} слушателей в месяц · {artist.genres.join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105"
          onClick={() => playContext(ids, 0)}
          aria-label="Играть"
        >
          <IconPlay width={22} height={22} />
        </button>
        <button className="icon-btn h-9 w-9" onClick={playShuffled} aria-label="Перемешать">
          <IconShuffle width={22} height={22} />
        </button>
      </div>

      <div className="px-4 sm:px-6">
        <h2 className="mb-2 mt-4 text-xl font-bold text-ink-100">Популярные треки</h2>
        <TrackListHeader showAlbum={false} />
        {tracks.slice(0, 8).map((t, i) => (
          <TrackRow key={t.id} track={t} index={i} contextIds={ids} showCover showAlbum={false} />
        ))}
      </div>

      <div className="px-4 sm:px-6">
        <h2 className="mb-3 mt-8 text-xl font-bold text-ink-100">Альбомы</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {albums.map((a) => (
            <MediaCard
              key={a.id}
              to={`/album/${a.id}`}
              seed={a.id}
              tone={a.accent + 20}
              title={a.title}
              subtitle={`${a.year} · ${a.trackIds.length} треков`}
              contextIds={a.trackIds}
            />
          ))}
        </div>
      </div>

      <div className="px-4 sm:px-6">
        <h2 className="mb-3 mt-8 text-xl font-bold text-ink-100">Об артисте</h2>
        <p className="max-w-2xl rounded-xl border border-ink-25 bg-ink-10 p-5 text-sm leading-relaxed text-ink-70">
          {artist.bio}
        </p>
      </div>
    </div>
  )
}
