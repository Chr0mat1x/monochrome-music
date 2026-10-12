import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../lib/format'
import { engine } from '../lib/audioEngine'
import { useStore } from '../store/useStore'
import { Cover } from './Cover'
import { Equalizer, Visualizer } from './Visualizer'
import {
  IconExpand,
  IconHeart,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconVolume,
  IconVolumeMute,
} from './Icons'
import { QueuePanel } from './QueuePanel'
import { NowPlaying } from './NowPlaying'
import { SleepTimer } from './SleepTimer'
import { SourceBadge } from './TrackRow'

function usePlaybackPosition(playing: boolean, trackId: string | null) {
  const [pos, setPos] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const tick = () => {
      setPos(engine.getPosition())
      raf.current = requestAnimationFrame(tick)
    }
    if (playing) raf.current = requestAnimationFrame(tick)
    else setPos(engine.getPosition())
    return () => cancelAnimationFrame(raf.current)
  }, [playing, trackId])
  return pos
}

export function Player() {
  const track = useStore((s) => s.currentTrack)
  const playing = useStore((s) => s.playing)
  const loading = useStore((s) => s.loading)
  const currentTrackId = track?.id ?? null
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
  const upgrading = useStore((s) => s.upgrading)
  const playbackNote = useStore((s) => s.playbackNote)
  const liked = useStore((s) => (track ? s.liked.some((t) => t.id === track.id) : false))
  const toggleLike = useStore((s) => s.toggleLike)
  const [muted, setMuted] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)

  const pos = usePlaybackPosition(playing, currentTrackId)
  const duration = track?.duration ?? 0
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight') {
        engine.seek(engine.getPosition() + 5)
      } else if (e.key === 'ArrowLeft') {
        engine.seek(engine.getPosition() - 5)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setVolume(Math.min(1, useStore.getState().volume + 0.05))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setVolume(Math.max(0, useStore.getState().volume - 0.05))
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь') {
        const m = !muted
        setMuted(m)
        setVolume(m ? 0 : 0.8)
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ы') {
        toggleShuffle()
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к') {
        cycleRepeat()
      } else if (e.code === 'KeyN') {
        next()
      } else if (e.code === 'KeyB') {
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, next, prev, muted, setVolume, toggleShuffle, cycleRepeat])

  const shownPos = scrubbing ?? pos
  const shownProgress = duration ? (shownPos / duration) * 100 : 0

  return (
    <>
      <footer
        className="glass-strong z-40 shrink-0 rounded-2xl px-3 py-2 sm:px-4"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {playbackNote && (
          <div className="mb-2 border border-ink-25 px-3 py-1 text-center text-[11px] text-ink-70">
            {playbackNote}
          </div>
        )}
        {/* compact seek for phones, above the transport row */}
        <input
          type="range"
          className="mono-range mb-1 h-3 w-full sm:hidden"
          min={0}
          max={duration || 1}
          step={0.5}
          value={shownPos}
          style={{ ['--fill' as any]: `${shownProgress}%` }}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing !== null) seek(scrubbing)
            setScrubbing(null)
          }}
          disabled={!track}
          aria-label="Позиция"
        />
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-3">
            {track ? (
              <>
                <button
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md sm:h-14 sm:w-14"
                  onClick={() => setNowPlayingOpen(true)}
                  aria-label="Открыть плеер"
                >
                  <Cover seed={track.id} artwork={track.artwork} tone={track.valence} className="h-full w-full" rounded="rounded-md" />
                  <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                    <IconExpand width={18} height={18} className="text-ink-100" />
                  </span>
                </button>
                <div className="min-w-0">
                  <button
                    className="flex max-w-full items-center gap-2 truncate text-left text-sm font-medium text-ink-95 hover:underline"
                    onClick={() => setNowPlayingOpen(true)}
                  >
                    <span className="truncate">{track.title}</span>
                    <SourceBadge track={track} />
                  </button>
                  <div className="truncate text-xs text-ink-60">
                    {upgrading ? 'Ищем полную версию…' : track.artist}
                  </div>
                </div>
                <button
                  className={`icon-btn ml-1 hidden h-8 w-8 shrink-0 sm:grid ${liked ? 'text-ink-100' : ''}`}
                  onClick={() => toggleLike(track)}
                  aria-label="В избранное"
                >
                  <IconHeart filled={liked} width={17} height={17} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3 text-ink-50">
                <div className="grid h-14 w-14 place-items-center rounded-md border border-ink-25">
                  <Equalizer active={false} />
                </div>
                <div className="text-xs">
                  <div className="text-ink-80">Ничего не играет</div>
                  <div>Выберите трек, чтобы начать</div>
                </div>
              </div>
            )}
          </div>

          <div className="order-last col-span-2 flex flex-col items-center gap-1 md:order-none md:col-span-1">
            <div className="flex items-center gap-3 sm:gap-4">
              <button className={`icon-btn h-8 w-8 ${shuffle ? 'text-ink-100' : ''}`} onClick={toggleShuffle} aria-label="Перемешать" title="Перемешать">
                <IconShuffle width={18} height={18} />
              </button>
              <button className="icon-btn h-9 w-9" onClick={() => prev()} aria-label="Предыдущий">
                <IconPrev width={20} height={20} />
              </button>
              <button
                className="grid h-11 w-11 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40"
                onClick={togglePlay}
                disabled={!track}
                aria-label={playing ? 'Пауза' : 'Играть'}
              >
                {loading && track ? (
                  <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-ink-0 border-t-transparent" />
                ) : playing ? (
                  <IconPause width={20} height={20} />
                ) : (
                  <IconPlay width={20} height={20} />
                )}
              </button>
              <button className="icon-btn h-9 w-9" onClick={() => next()} aria-label="Следующий">
                <IconNext width={20} height={20} />
              </button>
              <button
                className={`icon-btn h-8 w-8 ${repeat !== 'off' ? 'text-ink-100' : ''}`}
                onClick={cycleRepeat}
                aria-label="Повтор"
                title={repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор всех' : 'Повтор одного'}
              >
                {repeat === 'one' ? <IconRepeatOne width={18} height={18} /> : <IconRepeat width={18} height={18} />}
              </button>
            </div>

            <div className="hidden w-full max-w-xl items-center gap-2 sm:flex">
              <span className="w-10 text-right text-[11px] tabular-nums text-ink-60">{formatDuration(shownPos)}</span>
              <input
                type="range"
                className="mono-range h-4 flex-1"
                min={0}
                max={duration || 1}
                step={0.5}
                value={shownPos}
                style={{ ['--fill' as any]: `${shownProgress}%` }}
                onChange={(e) => setScrubbing(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrubbing !== null) seek(scrubbing)
                  setScrubbing(null)
                }}
                onKeyUp={() => {
                  if (scrubbing !== null) seek(scrubbing)
                  setScrubbing(null)
                }}
                disabled={!track}
                aria-label="Позиция"
              />
              <span className="w-10 text-[11px] tabular-nums text-ink-60">{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {track?.source === 'youtube' ? (
              <span
                className="hidden font-mono text-[10px] uppercase tracking-widest text-ink-60 lg:block"
                title="Полная версия играет через официальный плеер YouTube — визуализатор недоступен"
              >
                youtube
              </span>
            ) : (
              <div className="hidden h-8 w-24 items-end opacity-70 lg:flex">
                <Visualizer bars={22} mode="bars" className="h-full w-full" />
              </div>
            )}
            <SleepTimer />
            <button
              className={`icon-btn h-8 w-8 ${queueOpen ? 'text-ink-100' : ''}`}
              onClick={() => setQueueOpen((v) => !v)}
              aria-label="Очередь"
              title="Очередь"
            >
              <IconQueue width={18} height={18} />
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              <button
                className="icon-btn h-8 w-8"
                onClick={() => {
                  const m = !muted
                  setMuted(m)
                  setVolume(m ? 0 : 0.8)
                }}
                aria-label="Звук"
              >
                {muted || volume === 0 ? <IconVolumeMute width={18} height={18} /> : <IconVolume width={18} height={18} />}
              </button>
              <input
                type="range"
                className="mono-range h-4 w-24"
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
      </footer>

      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
      {nowPlayingOpen && <NowPlaying onClose={() => setNowPlayingOpen(false)} />}
    </>
  )
}
