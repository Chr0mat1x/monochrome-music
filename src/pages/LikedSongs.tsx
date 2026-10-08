import { tracksByIds } from '../data/library'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { IconHeart, IconPlay } from '../components/Icons'

export function LikedSongs() {
  const liked = useStore((s) => s.liked)
  const playContext = useStore((s) => s.playContext)
  const toggleLike = useStore((s) => s.toggleLike)
  const tracks = tracksByIds(liked)

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <Cover seed="liked-songs" tone={70} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="grid w-44 shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-ink-100 via-ink-70 to-ink-30 shadow-2xl shadow-black/60 sm:w-56">
          <IconHeart filled width={64} height={64} className="my-16 text-ink-0" />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">Плейлист</span>
          <h1 className="mt-2 text-4xl font-black leading-none tracking-tight text-ink-100 sm:text-6xl">
            Избранное
          </h1>
          <p className="mt-3 text-sm text-ink-70">{tracks.length} треков</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 disabled:opacity-40"
          onClick={() => playContext(liked, 0)}
          disabled={tracks.length === 0}
          aria-label="Играть"
        >
          <IconPlay width={22} height={22} />
        </button>
      </div>

      <div className="px-2 sm:px-4">
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-30 p-12 text-center">
            <IconHeart width={40} height={40} className="mx-auto text-ink-40" />
            <p className="mt-3 text-lg font-bold text-ink-90">Пока пусто</p>
            <p className="mt-1 text-sm text-ink-50">
              Нажимайте на сердце рядом с треком — он появится здесь.
            </p>
          </div>
        ) : (
          <>
            <TrackListHeader showAlbum />
            {tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                contextIds={liked}
                showCover
                onRemove={() => toggleLike(t.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
