import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { formatTotal } from '../lib/format'
import { IconPlay, IconTrash, IconHeart } from '../components/Icons'
import { NotFound } from './NotFound'

export function PlaylistPage() {
  const { id } = useParams()
  const playlists = useStore((s) => s.playlists)
  const playlist = playlists.find((p) => p.id === id)
  const playContext = useStore((s) => s.playContext)
  const removeFromPlaylist = useStore((s) => s.removeFromPlaylist)
  const deletePlaylist = useStore((s) => s.deletePlaylist)
  const renamePlaylist = useStore((s) => s.renamePlaylist)
  const liked = useStore((s) => s.liked)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!playlist) return <NotFound />

  const tracks = playlist.tracks
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0)
  const allLiked = tracks.length > 0 && tracks.every((t) => liked.some((l) => l.id === t.id))
  const artwork = tracks.find((t) => t.artwork)?.artwork ?? null

  return (
    <div className="pb-10">
      <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-6">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <Cover seed={playlist.id + playlist.name} artwork={artwork} tone={35} rounded="rounded-none" className="h-full w-full" />
        </div>
        <div className="w-44 shrink-0 sm:w-56">
          <Cover seed={playlist.id + playlist.name} artwork={artwork} tone={35} rounded="rounded-lg" className="aspect-square w-full shadow-2xl shadow-black/60" alt={playlist.name} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-70">
            {playlist.owned ? 'Мой плейлист' : 'Подборка'}
          </span>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                renamePlaylist(playlist.id, draft || playlist.name)
                setEditing(false)
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(false)}
                className="mt-2 w-full rounded-lg border border-ink-100 bg-ink-5 px-3 py-2 text-3xl font-black tracking-tight text-ink-100 outline-none sm:text-5xl"
              />
            </form>
          ) : (
            <h1
              className={`mt-2 text-3xl font-black leading-tight tracking-tight text-ink-100 sm:text-5xl ${
                playlist.owned ? 'cursor-text hover:underline' : ''
              }`}
              onDoubleClick={() => {
                if (!playlist.owned) return
                setDraft(playlist.name)
                setEditing(true)
              }}
            >
              {playlist.name}
            </h1>
          )}
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-70">{playlist.description}</p>
          <p className="mt-2 text-xs text-ink-60">
            {tracks.length} треков{total ? ` · ${formatTotal(total)}` : ''}
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
        <span className="icon-btn h-9 w-9" aria-hidden>
          <IconHeart filled={allLiked} width={20} height={20} />
        </span>
        {playlist.owned && (
          <>
            <button
              className="rounded-full border border-ink-40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-80 hover:border-ink-100"
              onClick={() => {
                setDraft(playlist.name)
                setEditing(true)
              }}
            >
              Переименовать
            </button>
            <button
              className="flex items-center gap-2 rounded-full border border-ink-40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-80 hover:border-ink-100"
              onClick={() => deletePlaylist(playlist.id)}
            >
              <IconTrash width={15} height={15} /> Удалить
            </button>
          </>
        )}
      </div>

      <div className="px-2 sm:px-4">
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-30 p-10 text-center">
            <p className="text-ink-70">Плейлист пуст.</p>
            <p className="mt-1 text-sm text-ink-50">Найдите треки в «Поиске» или «Медиатеке» и добавьте их через меню «…».</p>
          </div>
        ) : (
          <>
            <TrackListHeader />
            {tracks.map((t, i) => (
              <TrackRow
                key={`${t.id}-${i}`}
                track={t}
                index={i}
                context={tracks}
                showCover
                onRemove={playlist.owned ? () => removeFromPlaylist(playlist.id, t.id) : undefined}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
