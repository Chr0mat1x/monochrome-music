import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Track } from '../types'
import { searchItunes, searchAudius } from '../lib/musicApi'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { formatDuration, formatTotal } from '../lib/format'
import { IconPlay, IconHeart } from '../components/Icons'
import { NotFound } from './NotFound'

export function AlbumPage() {
  const { id } = useParams()
  // id format: "<artist>::<album>"
  const [artistName, albumTitle] = useMemo(() => {
    if (!id) return ['', '']
    const [a, t] = id.split('::')
    return [decodeURIComponent(a ?? ''), decodeURIComponent(t ?? '')]
  }, [id])

  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const playContext = useStore((s) => s.playContext)
  const register = useStore((s) => s.register)
  const liked = useStore((s) => s.liked)
  const toggleLike = useStore((s) => s.toggleLike)

  useEffect(() => {
    if (!albumTitle) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [it, au] = await Promise.all([searchItunes(`${artistName} ${albumTitle}`, 50), searchAudius(`${artistName} ${albumTitle}`, 50)])
      if (cancelled) return
      const all = [...it, ...au]
      const exact = all.filter(
        (t) => t.album.toLowerCase().includes(albumTitle.toLowerCase()) || t.title.toLowerCase().includes(albumTitle.toLowerCase()),
      )
      // dedupe, keep an ordered tracklist
      const seen = new Set<string>()
      const list: Track[] = []
      for (const t of exact.length ? exact : all) {
        const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        list.push(t)
      }
      setTracks(list)
      register(list)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [artistName, albumTitle, register])

  if (!id || !albumTitle) return <NotFound />

  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0)
  const allLiked = tracks.length > 0 && tracks.every((t) => liked.some((l) => l.id === t.id))
  const artwork = tracks.find((t) => t.artwork)?.artwork ?? null

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <Cover seed={`${artistName}${albumTitle}`} artwork={artwork} tone={45} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-44 shrink-0 sm:w-56">
          <Cover seed={`${artistName}${albumTitle}`} artwork={artwork} tone={45} rounded="rounded-lg" className="aspect-square w-full shadow-2xl shadow-black/60" alt={albumTitle} />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">Альбом</span>
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-ink-100 sm:text-5xl">{albumTitle}</h1>
          <p className="mt-3 text-sm text-ink-80">
            <Link to={`/artist/${encodeURIComponent(artistName)}`} className="font-semibold hover:underline">
              {artistName}
            </Link>{' '}
            {tracks.length > 0 && <>· {tracks[0].year} · {tracks.length} треков · {formatTotal(total)}</>}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 disabled:opacity-40"
          onClick={() => playContext(tracks, 0)}
          disabled={!tracks.length}
          aria-label="Играть альбом"
        >
          <IconPlay width={22} height={22} />
        </button>
        <button
          className={`icon-btn h-9 w-9 ${allLiked ? 'text-ink-100' : ''}`}
          onClick={() => tracks.forEach((t) => toggleLike(t))}
          disabled={!tracks.length}
          aria-label="В избранное"
        >
          <IconHeart filled={allLiked} width={22} height={22} />
        </button>
      </div>

      <div className="px-2 sm:px-4">
        {loading ? (
          <div className="space-y-2 px-2 py-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse-soft rounded bg-ink-10" />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <p className="px-4 py-8 text-sm text-ink-60">Не удалось найти треки этого альбома.</p>
        ) : (
          <>
            <TrackListHeader showAlbum={false} />
            {tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} context={tracks} showAlbum={false} showCover />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
