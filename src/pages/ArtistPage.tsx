import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Album, Artist, Track } from '../types'
import { getArtist, prefetchFullTracks, subscribeFullTracks } from '../lib/musicApi'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { MediaCard } from '../components/MediaCard'
import { ShareButton } from '../components/ShareButton'
import { formatMonthlyLike } from '../lib/format'
import { IconPlay, IconShuffle } from '../components/Icons'

export function ArtistPage() {
  const { name } = useParams()
  const artistName = name ? decodeURIComponent(name) : ''
  const [artist, setArtist] = useState<Artist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'album' | 'single'>('all')
  const playContext = useStore((s) => s.playContext)
  const register = useStore((s) => s.register)
  const shuffle = useStore((s) => s.shuffle)
  const toggleShuffle = useStore((s) => s.toggleShuffle)

  useEffect(() => {
    if (!artistName) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const data = await getArtist(artistName)
      if (cancelled) return
      setArtist(data.artist)
      setTracks(data.tracks)
      setAlbums(data.albums)
      register(data.tracks)
      setLoading(false)
      // Pull full versions of the whole discography in the background so the
      // artist page plays real songs, not 30-second previews.
      void prefetchFullTracks(data.tracks)
    })()
    return () => {
      cancelled = true
    }
  }, [artistName, register])

  useEffect(() => {
    return subscribeFullTracks((full) => {
      setTracks((cur) => cur.map((t) => (t.id === full.id ? full : t)))
    })
  }, [])

  const filteredAlbums = useMemo(() => {
    if (filter === 'all') return albums
    if (filter === 'album') return albums.filter((a) => a.recordType === 'album' || a.recordType === 'compile' || !a.recordType)
    return albums.filter((a) => a.recordType === 'single' || a.recordType === 'ep')
  }, [albums, filter])

  const playShuffled = () => {
    if (!shuffle) toggleShuffle()
    playContext(tracks, Math.floor(Math.random() * Math.max(1, tracks.length)))
  }

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-8 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-25">
          <Cover seed={artistName} artwork={artist?.picture} tone={70} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-40 shrink-0 sm:w-52">
          <Cover seed={artistName} artwork={artist?.picture} tone={60} rounded="rounded-full" className="aspect-square w-full shadow-2xl shadow-black/60" alt={artistName} />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">Артист</span>
          <h1 className="mt-2 text-4xl font-black leading-none tracking-tight text-ink-100 sm:text-6xl">{artistName}</h1>
          <p className="mt-4 text-sm text-ink-80">
            {artist ? `${formatMonthlyLike(artist.monthly)} слушателей · ` : ''}
            {artist?.genres.length ? artist.genres.join(' · ') : 'реальные треки из каталогов'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 disabled:opacity-40"
          onClick={() => playContext(tracks, 0)}
          disabled={!tracks.length}
          aria-label="Играть"
        >
          <IconPlay width={22} height={22} />
        </button>
        <button className="icon-btn h-9 w-9" onClick={playShuffled} disabled={!tracks.length} aria-label="Перемешать">
          <IconShuffle width={22} height={22} />
        </button>
        <ShareButton
          kind="url"
          url={`${window.location.origin}/artist/${encodeURIComponent(artistName)}`}
          title={artistName}
        />
      </div>

      <div className="px-4 sm:px-6">
        <h2 className="mb-2 mt-4 text-xl font-bold text-ink-100">Популярные треки</h2>
        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse-soft rounded bg-ink-10" />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <p className="py-6 text-sm text-ink-60">Треки не найдены.</p>
        ) : (
          <>
            <TrackListHeader showAlbum={false} />
            {tracks.slice(0, 50).map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} context={tracks} showCover showAlbum={false} />
            ))}
          </>
        )}
      </div>

      {albums.length > 0 && (
        <div className="px-4 sm:px-6">
          <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-ink-100">Дискография</h2>
            <div className="flex gap-1 rounded-full border border-ink-25 p-0.5">
              {([
                ['all', 'Всё'],
                ['album', 'Альбомы'],
                ['single', 'Синглы'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === key ? 'bg-ink-100 text-ink-0' : 'text-ink-70 hover:text-ink-100'
                  }`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {filteredAlbums.map((a) => (
              <MediaCard
                key={a.id}
                to={`/album/${encodeURIComponent(a.artist)}::${encodeURIComponent(a.title)}`}
                seed={a.id}
                artwork={a.artwork}
                tone={40}
                title={a.title}
                subtitle={`${a.year} · ${a.trackIds.length} треков`}
                context={tracks.filter((t) => t.album === a.title)}
              />
            ))}
          </div>
        </div>
      )}

      {artist && (
        <div className="px-4 sm:px-6">
          <h2 className="mb-3 mt-8 text-xl font-bold text-ink-100">Об артисте</h2>
          <p className="max-w-2xl rounded-xl border border-ink-25 bg-ink-10 p-5 text-sm leading-relaxed text-ink-70">{artist.bio}</p>
        </div>
      )}
    </div>
  )
}
