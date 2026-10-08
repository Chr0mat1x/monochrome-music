import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { Equalizer } from './Visualizer'
import { formatDuration, TRACK_BY_ID } from '../data/library'
import { IconClose, IconTrash } from './Icons'

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = useStore((s) => s.queue)
  const queueIndex = useStore((s) => s.queueIndex)
  const playing = useStore((s) => s.playing)
  const playContext = useStore((s) => s.playContext)
  const removeFromQueue = useStore((s) => s.removeFromQueue)

  const upcoming = queue.slice(queueIndex + 1)
  const current = queue[queueIndex] ? TRACK_BY_ID.get(queue[queueIndex]) : null

  return (
    <div className="fixed bottom-[92px] right-2 z-40 flex max-h-[60vh] w-[340px] flex-col overflow-hidden rounded-xl border border-ink-25 bg-ink-10 shadow-2xl shadow-black animate-fade-up sm:right-3">
      <div className="flex items-center justify-between border-b border-ink-25 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-70">Очередь</span>
        <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Закрыть">
          <IconClose width={16} height={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {current && (
          <>
            <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-ink-50">
              Сейчас играет
            </div>
            <div className="flex items-center gap-3 rounded-md bg-ink-20 px-2 py-2">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded">
                <Cover seed={current.id} tone={current.valence} className="h-full w-full" rounded="rounded" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-100">{current.title}</span>
                <span className="block truncate text-xs text-ink-60">{current.artist}</span>
              </span>
              {playing && <Equalizer active />}
            </div>
          </>
        )}

        <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-ink-50">
          Далее · {upcoming.length}
        </div>

        {upcoming.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-50">Очередь пуста. Добавьте треки через меню «…».</div>
        )}

        {upcoming.map((id, i) => {
          const t = TRACK_BY_ID.get(id)
          if (!t) return null
          const realIndex = queueIndex + 1 + i
          return (
            <div
              key={`${id}-${realIndex}`}
              className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-ink-20"
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => playContext(queue, realIndex)}
              >
                <span className="block truncate text-sm text-ink-90 group-hover:text-ink-100">
                  {t.title}
                </span>
                <span className="block truncate text-xs text-ink-60">{t.artist}</span>
              </button>
              <span className="text-xs tabular-nums text-ink-50">{formatDuration(t.duration)}</span>
              <button
                className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100"
                onClick={() => removeFromQueue(realIndex)}
                aria-label="Убрать из очереди"
              >
                <IconTrash width={15} height={15} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
