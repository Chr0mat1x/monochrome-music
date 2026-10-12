import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../lib/format'
import { engine } from '../lib/audioEngine'
import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { Visualizer } from './Visualizer'
import { SourceBadge } from './TrackRow'
import {
  IconChevron,
  IconHeart,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconVolume,
  IconVolumeMute,
} from './Icons'

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const track = useStore((s) => s.currentTrack)
  const playing = useStore((s) => s.playing)
  const togglePlay = useStore((s) => s.togglePlay)
  const next = useStore((s) => s.next)
  const prev = useStore((s) => s.prev)
  const seek = useStore((s) => s.seek)
  const volume = useStore((s) => s.volume)
  const setVolume = useStore((s) => s.setVolume)
  const shuffle = useStore((s) => s.shuffle)
  const toggleShuffle = useStore((s) => s.toggleShuffle)
  const repeat = useStore((s) => s.repeat)
  const cycleRepeat = useStore((s) => s.cycleRepeat)
  const liked = useStore((s) => (track ? s.liked.some((t) => t.id === track.id) : false))
  const toggleLike = useStore((s) => s.toggleLike)
  const [pos, setPos] = useState(0)
  const [muted, setMuted] = useState(false)
  const raf = useRef(0)

  useEffect(() => {
    const tick = () => {
      setPos(engine.getPosition())
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (!track) return null

  const duration = track.duration || engine.getDuration() || 0
  const progress = duration ? (pos / duration) * 100 : 0

  return (
    <div className="glass-strong fixed inset-0 z-[60] flex animate-fade-up flex-col">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <Cover seed={track.id} artwork={track.artwork} tone={track.valence} rounded="rounded-none" className="h-full w-full" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-0/70 via-ink-0/90 to-ink-0" />

        <div
          className="relative z-10 flex items-center justify-between px-5 pb-4"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
        <button className="icon-btn h-9 w-9" onClick={onClose} aria-label="Свернуть">
          <IconChevron width={24} height={24} className="rotate-90" />
        </button>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-60">Сейчас играет</span>
        <span className="w-9" />
      </div>

      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6"
        style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="w-full max-w-[min(24rem,46dvh)]">
          <Cover seed={track.id} artwork={track.artwork} tone={track.valence} rounded="rounded-xl" className="aspect-square w-full shadow-2xl shadow-black" alt={track.title} />
        </div>

        <div className="h-16 w-full max-w-md opacity-80">
          <Visualizer bars={40} mode="mirror" className="h-full w-full" />
        </div>

        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-2">
            <h2 className="truncate text-2xl font-black tracking-tight text-ink-100">{track.title}</h2>
            <SourceBadge track={track} />
          </div>
          <p className="mt-1 truncate text-sm text-ink-60">{track.artist} · {track.album}</p>
        </div>

        <div className="w-full max-w-md">
          <input
            type="range"
            className="mono-range h-4 w-full"
            min={0}
            max={duration || 1}
            step={0.5}
            value={pos}
            style={{ ['--fill' as any]: `${progress}%` }}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Позиция"
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-60">
            <span>{formatDuration(pos)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <button className={`icon-btn h-10 w-10 ${shuffle ? 'text-ink-100' : ''}`} onClick={toggleShuffle} aria-label="Перемешать">
            <IconShuffle width={20} height={20} />
          </button>
          <button className="icon-btn h-11 w-11" onClick={prev} aria-label="Предыдущий">
            <IconPrev width={24} height={24} />
          </button>
          <button
            className="grid h-16 w-16 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 active:scale-95"
            onClick={togglePlay}
            aria-label={playing ? 'Пауза' : 'Играть'}
          >
            {playing ? <IconPause width={26} height={26} /> : <IconPlay width={26} height={26} />}
          </button>
          <button className="icon-btn h-11 w-11" onClick={() => next()} aria-label="Следующий">
            <IconNext width={24} height={24} />
          </button>
          <button className={`icon-btn h-10 w-10 ${repeat !== 'off' ? 'text-ink-100' : ''}`} onClick={cycleRepeat} aria-label="Повтор">
            {repeat === 'one' ? <IconRepeatOne width={20} height={20} /> : <IconRepeat width={20} height={20} />}
          </button>
        </div>

        <div className="flex w-full max-w-md items-center gap-4">
          <button
            className={`icon-btn h-9 w-9 ${liked ? 'text-ink-100' : ''}`}
            onClick={() => toggleLike(track)}
            aria-label="В избранное"
          >
            <IconHeart filled={liked} width={22} height={22} />
          </button>
          <button
            className="icon-btn h-9 w-9"
            onClick={() => {
              const m = !muted
              setMuted(m)
              setVolume(m ? 0 : 0.8)
            }}
            aria-label="Звук"
          >
            {muted || volume === 0 ? <IconVolumeMute width={20} height={20} /> : <IconVolume width={20} height={20} />}
          </button>
          <input
            type="range"
            className="mono-range h-4 flex-1"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            style={{ ['--fill' as any]: `${(muted ? 0 : volume) * 100}%` }}
            onChange={(e) => {
              setMuted(false)
              setVolume(Number(e.target.value))
            }}
            aria-label="Громкость"
          />
        </div>
      </div>
    </div>
  )
}
