import { useState } from 'react'
import type { Track } from '../types'
import { formatDuration } from '../data/library'
import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { Equalizer } from './Visualizer'
import { IconClock, IconDots, IconHeart, IconPause, IconPlay } from './Icons'
import { TrackMenu } from './TrackMenu'

interface TrackRowProps {
  track: Track
  index: number
  contextIds: string[]
  showAlbum?: boolean
  showCover?: boolean
  onRemove?: () => void
}

export function TrackRow({
  track,
  index,
  contextIds,
  showAlbum = true,
  showCover = false,
  onRemove,
}: TrackRowProps) {
  const currentId = useStore((s) => s.currentTrackId)
  const playing = useStore((s) => s.playing)
  const playContext = useStore((s) => s.playContext)
  const togglePlay = useStore((s) => s.togglePlay)
  const liked = useStore((s) => s.liked.includes(track.id))
  const toggleLike = useStore((s) => s.toggleLike)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const isCurrent = currentId === track.id
  const isPlaying = isCurrent && playing

  return (
    <>
      <div
        onDoubleClick={() => playContext(contextIds, index)}
        className={`group grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 hover:bg-ink-20 md:grid-cols-[28px_minmax(0,4fr)_minmax(0,3fr)_auto] ${
          isCurrent ? 'bg-ink-15' : ''
        }`}
      >
        {/* index / play */}
        <button
          className="grid h-7 w-7 place-items-center text-ink-60"
          onClick={() => (isCurrent ? togglePlay() : playContext(contextIds, index))}
          aria-label={isPlaying ? 'Пауза' : 'Играть'}
        >
          <span className="tabular-nums group-hover:hidden">
            {isPlaying ? <Equalizer active /> : index + 1}
          </span>
          <span className="hidden group-hover:grid">
            {isPlaying ? (
              <IconPause width={15} height={15} className="text-ink-100" />
            ) : (
              <IconPlay width={14} height={14} className="text-ink-100" />
            )}
          </span>
        </button>

        {/* title */}
        <div className="flex min-w-0 items-center gap-3">
          {showCover && (
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded">
              <Cover seed={track.id} tone={track.valence} className="h-full w-full" rounded="rounded" />
            </div>
          )}
          <div className="min-w-0">
            <div
              className={`truncate font-medium ${
                isCurrent ? 'text-ink-100' : 'text-ink-90 group-hover:text-ink-100'
              }`}
            >
              {track.title}
            </div>
            <div className="truncate text-xs text-ink-60">{track.artist}</div>
          </div>
        </div>

        {/* album */}
        {showAlbum && (
          <div className="hidden min-w-0 truncate text-xs text-ink-60 md:block">{track.album}</div>
        )}

        {/* actions */}
        <div className="flex items-center gap-2">
          <button
            className={`icon-btn h-8 w-8 opacity-0 group-hover:opacity-100 ${
              liked ? '!opacity-100 text-ink-100' : ''
            }`}
            onClick={() => toggleLike(track.id)}
            aria-label={liked ? 'Убрать из избранного' : 'В избранное'}
          >
            <IconHeart filled={liked} width={16} height={16} />
          </button>
          <span className="w-10 text-right text-xs tabular-nums text-ink-60">
            {formatDuration(track.duration)}
          </span>
          <button
            className="icon-btn h-8 w-8 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ x: rect.right, y: rect.bottom })
            }}
            aria-label="Ещё"
          >
            <IconDots width={16} height={16} />
          </button>
        </div>
      </div>
      {menu && (
        <TrackMenu
          track={track}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRemove={onRemove}
        />
      )}
    </>
  )
}

export function TrackListHeader({ showAlbum = true }: { showAlbum?: boolean }) {
  return (
    <div
      className={`grid grid-cols-[28px_1fr_auto] gap-3 border-b border-ink-25 px-3 pb-2 text-[11px] font-medium uppercase tracking-widest text-ink-60 md:grid-cols-[28px_minmax(0,4fr)_minmax(0,3fr)_auto]`}
    >
      <span className="text-center">#</span>
      <span>Название</span>
      {showAlbum && <span className="hidden md:block">Альбом</span>}
      <span className="grid w-[calc(2rem+2.5rem+2rem+0.5rem)] place-items-end pr-1">
        <IconClock width={15} height={15} />
      </span>
    </div>
  )
}
