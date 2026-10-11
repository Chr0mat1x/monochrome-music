import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Track } from '../types'
import { decodeShare, unpackTrack } from '../lib/share'
import { cachedFullTrack, prefetchFullTracks, subscribeFullTracks } from '../lib/musicApi'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { ShareButton } from '../components/ShareButton'
import { formatTotal } from '../lib/format'
import { IconPlay, IconPlus, IconShuffle } from '../components/Icons'
import { NotFound } from './NotFound'

/**
 * Opens a permanent share link. The payload carries the tracks themselves, so
 * this works for anyone — signed in or not, on any device — and never expires.
 */
export function SharedPage() {
  const { payload } = useParams()
  const navigate = useNavigate()
  const register = useStore((s) => s.register)
  const playContext = useStore((s) => s.playContext)
  const createPlaylist = useStore((s) => s.createPlaylist)
  const toggleShuffle = useStore((s) => s.toggleShuffle)
  const shuffle = useStore((s) => s.shuffle)

  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [meta, setMeta] = useState<{ kind: 'track' | 'playlist'; name: string; description: string }>({
    kind: 'track',
    name: '',
    description: '',
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await decodeShare(payload ?? '')
      if (cancelled) return
      if (!data) {
        setFailed(true)
        return
      }
      if (data.k === 'track') {
        const t = unpackTrack(data.t)
        register([t])
        setTracks([t])
        setMeta({ kind: 'track', name: t.title, description: t.artist })
      } else {
        const list = data.ts.map(unpackTrack)
        register(list)
        setTracks(list)
        setMeta({ kind: 'playlist', name: data.n, description: data.d })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payload, register])

  // A shared list should play real songs, not 30-second previews.
  useEffect(() => {
    if (tracks && tracks.length) void prefetchFullTracks(tracks)
  }, [tracks])

  // Reuse a full version resolved elsewhere (e.g. the same song already warmed
  // on the search page) so the list is full immediately, not after a fetch.
  useEffect(() => {
    if (!tracks) return
    const upgraded = tracks.map((t) => (t.preview ? cachedFullTrack(t) ?? t : t))
    if (upgraded.some((t, i) => t !== tracks[i])) setTracks(upgraded)
  }, [tracks])

  useEffect(() => {
    return subscribeFullTracks((full) => {
      setTracks((cur) => cur?.map((t) => (t.id === full.id ? full : t)) ?? cur)
    })
  }, [])

  const artwork = useMemo(() => tracks?.find((t) => t.artwork)?.artwork ?? null, [tracks])

  if (failed) return <NotFound />
  if (!tracks) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-30 border-t-ink-100" />
      </div>
    )
  }

  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0)
  const isPlaylist = meta.kind === 'playlist'

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <Cover seed={`share${meta.name}`} artwork={artwork} tone={30} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-44 shrink-0 sm:w-56">
          <Cover
            seed={`share${meta.name}`}
            artwork={artwork}
            tone={30}
            rounded="rounded-lg"
            className="aspect-square w-full shadow-2xl shadow-black/60"
            alt={meta.name}
          />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">
            {isPlaylist ? 'Плейлист по ссылке' : 'Трек по ссылке'}
          </span>
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-ink-100 sm:text-5xl">{meta.name}</h1>
          {meta.description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-70">{meta.description}</p>}
          <p className="mt-2 text-xs text-ink-60">
            {tracks.length === 1 ? '1 трек' : `${tracks.length} треков`}
            {total ? ` · ${formatTotal(total)}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <button
          className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 disabled:opacity-40"
          onClick={() => playContext(tracks, 0)}
          disabled={tracks.length === 0}
          aria-label="Играть"
        >
          <IconPlay width={22} height={22} />
        </button>
        {isPlaylist && (
          <button
            className={`icon-btn h-9 w-9 ${shuffle ? 'text-ink-100' : ''}`}
            onClick={() => toggleShuffle()}
            aria-label="Перемешать"
          >
            <IconShuffle width={20} height={20} />
          </button>
        )}
        {isPlaylist ? (
          <ShareButton
            kind="playlist"
            playlist={{ id: 'shared', name: meta.name, description: meta.description, tracks, cover: 'custom', owned: false, createdAt: 0 }}
          />
        ) : (
          <ShareButton kind="track" track={tracks[0]} />
        )}
        <button
          className="flex items-center gap-2 rounded-full border border-ink-40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-80 hover:border-ink-100"
          onClick={() => {
            const id = createPlaylist(isPlaylist ? meta.name : `Трек: ${meta.name}`, meta.description || 'Сохранено из ссылки', tracks)
            navigate(`/playlist/${id}`)
          }}
        >
          <IconPlus width={15} height={15} /> Сохранить к себе
        </button>
      </div>

      <div className="px-2 sm:px-4">
        <TrackListHeader showAlbum={isPlaylist} />
        {tracks.map((t, i) => (
          <TrackRow key={`${t.id}-${i}`} track={t} index={i} context={tracks} showCover />
        ))}
      </div>
    </div>
  )
}
