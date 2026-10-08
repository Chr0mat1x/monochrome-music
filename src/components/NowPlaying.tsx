import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../data/library'
import { engine } from '../lib/audioEngine'
import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { Visualizer } from './Visualizer'
import {
  IconClose,
  IconHeart,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
} from './Icons'

/** Full-screen immersive player with a large spectrum and mood read-out. */
export function NowPlaying({ onClose }: { onClose: () => void }) {
  const track = useStore((s) => s.currentTrack())
  const playing = useStore((s) => s.playing)
  const togglePlay = useStore((s) => s.togglePlay)
  const next = useStore((s) => s.next)
  const prev = useStore((s) => s.prev)
  const liked = useStore((s) => (track ? s.liked.includes(track.id) : false))
  const toggleLike = useStore((s) => s.toggleLike)
  const shuffle = useStore((s) => s.shuffle)
  const toggleShuffle = useStore((s) => s.toggleShuffle)
  const repeat = useStore((s) => s.repeat)
  const cycleRepeat = useStore((s) => s.cycleRepeat)
  const seek = useStore((s) => s.seek)

  const [pos, setPos] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const raf = useRef(0)
  const trackId = track?.id ?? null

  useEffect(() => {
    const tick = () => {
      setPos(engine.getPosition())
      raf.current = requestAnimationFrame(tick)
    }
    if (playing) raf.current = requestAnimationFrame(tick)
    else setPos(engine.getPosition())
    return () => cancelAnimationFrame(raf.current)
  }, [playing, trackId])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (!track) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-0 grain animate-fade-up">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-[0.07]">
        <Visualizer bars={64} mode="mirror" className="h-full w-full" />
      </div>

      <div className="flex items-center justify-between px-5 py-4">
        <button className="icon-btn h-9 w-9" onClick={onClose} aria-label="Закрыть">
          <IconClose width={20} height={20} />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
          Сейчас играет
        </span>
        <button
          className={`icon-btn h-9 w-9 ${liked ? 'text-ink-100' : ''}`}
          onClick={() => toggleLike(track.id)}
          aria-label="В избранное"
        >
          <IconHeart filled={liked} width={20} height={20} />
        </button>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="w-full max-w-sm">
          <Cover
            seed={track.id}
            tone={track.valence}
            rounded="rounded-xl"
            className="aspect-square w-full shadow-2xl shadow-black"
          />
        </div>

        <div className="w-full max-w-md text-center">
          <h2 className="truncate text-3xl font-black tracking-tight text-ink-100">{track.title}</h2>
          <p className="mt-1 text-sm text-ink-60">
            {track.artist} · {track.album} · {track.year}
          </p>
        </div>

        <div className="flex w-full max-w-md items-center gap-3">
          <span className="w-10 text-right text-xs tabular-nums text-ink-50">
            {formatDuration(scrub ?? pos)}
          </span>
          <input
            type="range"
            className="mono-range h-4 flex-1"
            min={0}
            max={track.duration}
            step={0.5}
            value={scrub ?? pos}
            style={{ ['--fill' as any]: `${((scrub ?? pos) / track.duration) * 100}%` }}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (scrub !== null) seek(scrub)
              setScrub(null)
            }}
            aria-label="Позиция"
          />
          <span className="w-10 text-xs tabular-nums text-ink-50">
            {formatDuration(track.duration)}
          </span>
        </div>

        <div className="flex items-center gap-5">
          <button
            className={`icon-btn h-10 w-10 ${shuffle ? 'text-ink-100' : ''}`}
            onClick={toggleShuffle}
            aria-label="Перемешать"
          >
            <IconShuffle width={20} height={20} />
          </button>
          <button className="icon-btn h-11 w-11" onClick={() => prev()} aria-label="Предыдущий">
            <IconPrev width={26} height={26} />
          </button>
          <button
            className="grid h-16 w-16 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105 active:scale-95"
            onClick={togglePlay}
            aria-label={playing ? 'Пауза' : 'Играть'}
          >
            {playing ? <IconPause width={26} height={26} /> : <IconPlay width={26} height={26} />}
          </button>
          <button className="icon-btn h-11 w-11" onClick={() => next()} aria-label="Следующий">
            <IconNext width={26} height={26} />
          </button>
          <button
            className={`icon-btn h-10 w-10 ${repeat !== 'off' ? 'text-ink-100' : ''}`}
            onClick={cycleRepeat}
            aria-label="Повтор"
          >
            {repeat === 'one' ? <IconRepeatOne width={20} height={20} /> : <IconRepeat width={20} height={20} />}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <span className="chip">{track.genre}</span>
          <span className="chip">{track.bpm} BPM</span>
          <span className="chip">
            {track.key >= 0 ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][track.key] : ''} {track.mode}
          </span>
          {track.mood.map((m) => (
            <span key={m} className="chip">
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
