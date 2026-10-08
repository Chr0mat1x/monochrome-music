import { Link, useParams } from 'react-router-dom'
import { ALBUM_BY_ID, formatDuration, tracksByIds } from '../data/library'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { IconPlay, IconHeart } from '../components/Icons'
import { NotFound } from './NotFound'

export function AlbumPage() {
  const { id } = useParams()
  const album = id ? ALBUM_BY_ID.get(id) : undefined
  const playContext = useStore((s) => s.playContext)
  const likeFromAlbum = useStore((s) => s.toggleLike)
  const liked = useStore((s) => s.liked)

  if (!album) return <NotFound />

  const tracks = tracksByIds(album.trackIds)
  const total = tracks.reduce((sum, t) => sum + t.duration, 0)
  const allLiked = tracks.length > 0 && tracks.every((t) => liked.includes(t.id))

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <Cover seed={album.id} tone={album.accent + 30} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-44 shrink-0 sm:w-56">
          <Cover
            seed={album.id}
            tone={album.accent + 20}
            rounded="rounded-lg"
            className="aspect-square w-full shadow-2xl shadow-black/60"
          />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">Альбом</span>
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-ink-100 sm:text-5xl">
            {album.title}
          </h1>
          <p className="mt-3 text-sm text-ink-80">
            <Link to={`/artist/${encodeURIComponent(album.artist)}`} className="font-semibold hover:underline">
              {album.artist}
            </Link>{' '}
            · {album.year} · {tracks.length} треков · {formatDuration(total)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105"
          onClick={() => playContext(album.trackIds, 0)}
          aria-label="Играть альбом"
        >
          <IconPlay width={22} height={22} />
        </button>
        <button
          className={`icon-btn h-9 w-9 ${allLiked ? 'text-ink-100' : ''}`}
          onClick={() => tracks.forEach((t) => likeFromAlbum(t.id))}
          aria-label="В избранное"
        >
          <IconHeart filled={allLiked} width={22} height={22} />
        </button>
      </div>

      <div className="px-2 sm:px-4">
        <TrackListHeader />
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i} contextIds={album.trackIds} showAlbum={false} showCover />
        ))}
      </div>
    </div>
  )
}
