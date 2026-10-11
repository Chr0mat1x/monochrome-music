import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { formatDuration } from '../lib/format'
import { IconClose, IconQueue, IconTrash } from './Icons'

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = useStore((s) => s.queue)
  const queueIndex = useStore((s) => s.queueIndex)
  const currentId = useStore((s) => s.currentTrack?.id ?? null)
  const playContext = useStore((s) => s.playContext)
  const removeFromQueue = useStore((s) => s.removeFromQueue)

  const upcoming = queue.slice(queueIndex + 1)

  return (
    <div className="glass-menu fixed bottom-[5.5rem] right-3 z-50 flex max-h-[60vh] w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-ink-25 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-95">
          <IconQueue width={16} height={16} /> Очередь
        </span>
        <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Закрыть">
          <IconClose width={16} height={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {queue.length === 0 && <p className="p-4 text-sm text-ink-50">Очередь пуста.</p>}

        {currentId && (
          <>
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-ink-50">Сейчас играет</p>
            <QueueItem track={queue[queueIndex]} active onRemove={undefined} />
          </>
        )}

        {upcoming.length > 0 && (
          <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-50">Далее</p>
        )}
        {upcoming.map((t, i) => (
          <QueueItem
            key={`${t.id}-${queueIndex + 1 + i}`}
            track={t}
            onPlay={() => playContext(queue, queueIndex + 1 + i)}
            onRemove={() => removeFromQueue(queueIndex + 1 + i)}
          />
        ))}
      </div>
    </div>
  )
}

function QueueItem({
  track,
  active = false,
  onPlay,
  onRemove,
}: {
  track?: import('../types').Track
  active?: boolean
  onPlay?: () => void
  onRemove?: () => void
}) {
  if (!track) return null
  return (
    <div className={`group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-ink-20 ${active ? 'bg-ink-15' : ''}`}>
      <button className="h-10 w-10 shrink-0 overflow-hidden rounded" onClick={onPlay} aria-label="Играть">
        <Cover seed={track.id} artwork={track.artwork} tone={track.valence} className="h-full w-full" rounded="rounded" />
      </button>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${active ? 'text-ink-100' : 'text-ink-90'}`}>{track.title}</div>
        <div className="truncate text-xs text-ink-55">{track.artist}</div>
      </div>
      <span className="text-xs tabular-nums text-ink-50">{formatDuration(track.duration)}</span>
      {onRemove && (
        <button className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100" onClick={onRemove} aria-label="Убрать">
          <IconTrash width={15} height={15} />
        </button>
      )}
    </div>
  )
}
